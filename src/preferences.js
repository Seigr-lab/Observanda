import {defaultDashboard,validDashboard,upgradeDashboard} from './web/dashboard-model.js';
import path from 'node:path';
import {mkdir,readFile,open} from 'node:fs/promises';
import {withWriterLease} from './writer-lease.js';
import {randomUUID} from 'node:crypto';
import {DEFAULT_INTERFACE,validInterface} from './web/interface-ui.js';
import {assertRegular,atomicWrite,serialize,digest} from './storage.js';
import {AppError} from './errors.js';
import {validLanguage} from './web/i18n/runtime.js';

export const defaultPreferences=()=>({formatVersion:1,language:'en',workspace:null,recent:[],interface:structuredClone(DEFAULT_INTERFACE),dashboard:defaultDashboard()});
const validPath=p=>typeof p==='string'&&p.length<=4096&&path.isAbsolute(p)&&!/[\x00-\x1f]/.test(p);
const validCatalogue=id=>id===undefined||typeof id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);
export async function preferencesSnapshot(file){
 let raw=null;
 if(file)try{const stat=await assertRegular(file);if(stat.size>1048576)throw new AppError('PREFERENCES_FORMAT');raw=await readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(!raw)return {value:defaultPreferences(),etag:'none',raw:null};
 let value;try{value=JSON.parse(raw.toString('utf8'));}catch{throw new AppError('PREFERENCES_FORMAT');}
 if(!value||Array.isArray(value)||value.formatVersion!==1||Object.keys(value).some(key=>!['formatVersion','workspace','recent','interface','dashboard','language'].includes(key))||value.language!==undefined&&!validLanguage(value.language)||(value.workspace!==null&&!validPath(value.workspace))||value.interface!==undefined&&!validInterface(value.interface)||value.recent!==undefined&&(!Array.isArray(value.recent)||value.recent.length>30||value.recent.some(item=>!item||!validPath(item.path)||typeof item.title!=='string'||item.title.length>160||typeof item.label!=='string'||item.label.length>60)))throw new AppError('PREFERENCES_FORMAT');
 if(value.recent?.some(item=>!validCatalogue(item.catalogueId)))throw new AppError('PREFERENCES_FORMAT');
 const dashboard=value.dashboard===undefined?defaultDashboard():upgradeDashboard(value.dashboard);if(!dashboard)throw new AppError('PREFERENCES_FORMAT');
 return {value:{...defaultPreferences(),...value,dashboard},etag:digest(raw),raw};
}
export async function readPreferences(file){return (await preferencesSnapshot(file)).value;}
export async function readPreference(file){return (await readPreferences(file)).workspace;}
const writes=new Map();
async function withPreferenceLock(file,operation){
 if(!file)return operation({value:defaultPreferences(),etag:'none',raw:null});
 const previous=writes.get(file)??Promise.resolve();
 const task=previous.catch(()=>{}).then(async()=>{
  await mkdir(path.dirname(file),{recursive:true,mode:0o700});await assertRegular(path.dirname(file),{directory:true});
  return withWriterLease(file+'.lock',async()=>operation(await preferencesSnapshot(file)));
 });
 writes.set(file,task);try{return await task;}finally{if(writes.get(file)===task)writes.delete(file);}
}
async function updatePreferences(file,change){if(!file)return;await withPreferenceLock(file,async({value})=>{await atomicWrite(file,serialize(change(value)));});}
export async function rememberLocation(file,root,details={title:'',label:'Workspace'},{replacedPaths=[]}={}){
 if(!validPath(root)||typeof details.title!=='string'||details.title.length>160||typeof details.label!=='string'||details.label.length>60)throw new AppError('INVALID');
 if(!validCatalogue(details.catalogueId)||!Array.isArray(replacedPaths)||replacedPaths.some(p=>!validPath(p)))throw new AppError('INVALID');
 await updatePreferences(file,value=>({...value,workspace:root,recent:[{path:root,title:details.title,label:details.label,...(details.catalogueId?{catalogueId:details.catalogueId}:{})},...value.recent.filter(item=>item.path!==root&&!replacedPaths.includes(item.path))].slice(0,30)}));
}
export async function rememberCatalogueIdentity(file,root,catalogueId){
 if(!validPath(root)||!catalogueId||!validCatalogue(catalogueId))throw new AppError('INVALID');
 await updatePreferences(file,value=>({...value,recent:value.recent.map(item=>item.path===root?{...item,catalogueId}:item)}));
}
export async function forgetWorkspace(file,root){
 if(!validPath(root))throw new AppError('INVALID');
 await updatePreferences(file,value=>({...value,workspace:value.workspace===root?null:value.workspace,recent:value.recent.filter(item=>item.path!==root)}));
}
export async function rememberLanguage(file,language){if(!validLanguage(language))throw new AppError('INVALID');await updatePreferences(file,value=>({...value,language}));}
export async function rememberInterface(file,settings){if(!validInterface(settings))throw new AppError('INVALID');await updatePreferences(file,value=>({...value,interface:settings}));}
export async function resetPreferences(file,expectedEtag){
 return withPreferenceLock(file,async({etag,raw})=>{
  if(typeof expectedEtag!=='string'||expectedEtag!==etag)throw new AppError('PREFERENCES_CHANGED');
  let backup=null;
  if(file&&raw){
   backup=file+'.before-reset-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID();
   const handle=await open(backup,'wx',0o600);try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}
  }
  const value=defaultPreferences();if(file)await atomicWrite(file,serialize(value));
  return {value,backup};
 });
}

// The dashboard etag is independent of location and typography writes.
export const dashboardSnapshot = settings => ({settings:structuredClone(settings),etag:digest(serialize(settings))});
export async function saveDashboard(file,settings,etag){
 if(!validDashboard(settings))throw new AppError('INVALID');
 return withPreferenceLock(file,async({value})=>{
  if(dashboardSnapshot(value.dashboard).etag!==etag)throw new AppError('DASHBOARD_CHANGED');
  if(file)await atomicWrite(file,serialize({...value,dashboard:settings}));
  return dashboardSnapshot(settings);
 });
}

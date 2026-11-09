import {parse} from 'parse5';
import {AppError} from './errors.js';
import {websitePageIdentity} from './website-page-paths.js';

// Discovery settings describe how a published website announces itself:
// its public address, search indexing, the sitemap, a social preview image
// and which pages are language versions of one another. They are only
// declarations written into the published files. Nothing here is fetched,
// and authored HTML policy is unchanged.
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const images=/\.(?:png|jpe?g|webp|gif)$/i;
export const maxTranslationGroups=500,maxGroupPages=40,maxAltLength=300;

export function normalizeBaseUrl(value){
 if(value===null||value==='')return null;
 if(typeof value!=='string'||value.length>2048)throw new AppError('INVALID');
 let url;try{url=new URL(value.trim());}catch{throw new AppError('INVALID');}
 if(!['https:','http:'].includes(url.protocol)||!url.hostname||url.username||url.password||url.search||url.hash||url.port==='0')throw new AppError('INVALID');
 if(!url.pathname.endsWith('/'))url.pathname+='/';
 return url.href;
}
export function emptyDiscovery(){return {baseUrl:null,indexing:true,sitemap:true,socialImage:null,socialImageAlt:'',translations:[]};}
export function validateDiscovery(value){
 if(value===undefined)return;
 const bad=()=>{throw new AppError('FORMAT');};
 if(!value||typeof value!=='object'||Array.isArray(value))bad();
 const keys=['baseUrl','indexing','sitemap','socialImage','socialImageAlt','translations'];
 if(Object.keys(value).some(key=>!keys.includes(key)))bad();
 if(value.baseUrl!==null){try{if(normalizeBaseUrl(value.baseUrl)!==value.baseUrl)bad();}catch{bad();}}
 if(typeof value.indexing!=='boolean'||typeof value.sitemap!=='boolean')bad();
 if(value.socialImage!==null&&(typeof value.socialImage!=='string'||!images.test(value.socialImage)))bad();
 if(typeof value.socialImageAlt!=='string'||value.socialImageAlt.length>maxAltLength)bad();
 if(!Array.isArray(value.translations)||value.translations.length>maxTranslationGroups)bad();
 const seen=new Set();
 for(const group of value.translations){
  if(!group||typeof group!=='object'||!Array.isArray(group.pages)||group.pages.length<2||group.pages.length>maxGroupPages||!hex(group.source)||!group.pages.includes(group.source))bad();
  if(!Array.isArray(group.outdated)||group.outdated.some(id=>!group.pages.includes(id)||id===group.source))bad();
  for(const id of group.pages){if(!hex(id)||seen.has(id))bad();seen.add(id);}
 }
}
// Pages deleted after a group was formed leave the group; a group needs two
// remaining pages to remain meaningful.
export function activeTranslations(manifest){
 const present=new Set(manifest.pages.filter(page=>!page.archived).map(page=>websitePageIdentity(manifest.id,page)));
 return (manifest.discovery?.translations??[]).map(group=>({...group,pages:group.pages.filter(id=>present.has(id)),outdated:group.outdated.filter(id=>present.has(id))}))
  .filter(group=>group.pages.length>1&&group.pages.includes(group.source));
}
export function pageLanguage(html){
 const document=parse(html),root=document.childNodes.find(node=>node.tagName==='html');
 return root?.attrs?.find(attr=>attr.name==='lang')?.value?.trim()??'';
}
function settingsOf(manifest){return {...emptyDiscovery(),...(manifest.discovery??{})};}
function pageView(manifest,page){return {pageId:websitePageIdentity(manifest.id,page),path:page.path,title:page.title??'',...(page.draft?{draft:true}:{})};}

async function readView(store,manifest,path,signal){
 const settings=settingsOf(manifest),pages=manifest.pages.filter(page=>!page.archived);
 const owner=pages.find(page=>page.path===path);if(!owner)throw new AppError('NOT_FOUND');
 const id=websitePageIdentity(manifest.id,owner),group=activeTranslations(manifest).find(row=>row.pages.includes(id));
 const byId=new Map(pages.map(page=>[websitePageIdentity(manifest.id,page),page])),files=new Map(manifest.files.map(file=>[file.name,file]));
 const members=[];
 for(const member of group?.pages??[]){
  const page=byId.get(member),file=files.get(page.path);
  members.push({...pageView(manifest,page),language:file?pageLanguage(await store.readText(file,{signal})):'',source:member===group.source,outdated:group.outdated.includes(member)});
 }
 const pictures=manifest.files.filter(file=>!file.draft&&images.test(file.name)&&!file.sourceId).map(file=>file.name).sort().slice(0,500);
 return {revision:manifest.revision,path,pageId:id,settings:{baseUrl:settings.baseUrl,indexing:settings.indexing,sitemap:settings.sitemap,socialImage:settings.socialImage,socialImageAlt:settings.socialImageAlt},
  pages:pages.map(page=>pageView(manifest,page)),group:members,pictures};
}
function applyTranslation(manifest,translations,path,{of,status}){
 const pages=manifest.pages.filter(page=>!page.archived),identity=page=>websitePageIdentity(manifest.id,page);
 const owner=pages.find(page=>page.path===path);if(!owner)throw new AppError('NOT_FOUND');
 const id=identity(owner);
 // Leave the current group first. A remaining group keeps its source page
 // unless this page was the source, in which case its first page becomes it.
 let groups=translations.map(group=>{
  if(!group.pages.includes(id))return group;
  const remaining=group.pages.filter(member=>member!==id);
  const source=group.source===id?remaining[0]:group.source;
  return {pages:remaining,source,outdated:group.outdated.filter(member=>member!==id&&member!==source)};
 }).filter(group=>group.pages.length>1);
 if(of===null)return groups;
 if(typeof of!=='string'||!['current','outdated'].includes(status))throw new AppError('INVALID');
 const target=pages.find(page=>identity(page)===of);if(!target||of===id)throw new AppError('INVALID');
 const existing=groups.find(group=>group.pages.includes(of));
 if(existing){
  if(existing.pages.length>=40)throw new AppError('LIMIT');
  existing.pages=[...existing.pages,id];if(status==='outdated')existing.outdated=[...existing.outdated,id];
 }else groups=[...groups,{pages:[of,id],source:of,outdated:status==='outdated'?[id]:[]}];
 if(groups.length>maxTranslationGroups)throw new AppError('LIMIT');
 return groups;
}
export function websiteDiscovery(store,siteId,{expectedRevision,path='index.html',settings,translation,signal},write=false){
 if(!hex(expectedRevision)||typeof path!=='string')throw new AppError('INVALID');
 return store.scope(async()=>{
  const manifest=await store.current(siteId,expectedRevision);
  if(!write)return readView(store,manifest,path,signal);
  const current=settingsOf(manifest),next={...current,translations:activeTranslations(manifest)};
  if(settings!==undefined){
   if(!settings||typeof settings!=='object')throw new AppError('INVALID');
   const {baseUrl,indexing,sitemap,socialImage,socialImageAlt}=settings;
   next.baseUrl=normalizeBaseUrl(baseUrl??null);
   if(typeof indexing!=='boolean'||typeof sitemap!=='boolean'||typeof socialImageAlt!=='string'||socialImageAlt.length>maxAltLength)throw new AppError('INVALID');
   Object.assign(next,{indexing,sitemap,socialImageAlt:socialImageAlt.trim()});
   if(socialImage===null||socialImage==='')next.socialImage=null;
   else{
    const file=manifest.files.find(row=>row.name===socialImage);
    if(!file||file.draft||file.sourceId||!images.test(file.name))throw new AppError('INVALID');
    next.socialImage=file.name;
   }
  }
  if(translation!==undefined){
   if(!translation||typeof translation!=='object')throw new AppError('INVALID');
   next.translations=applyTranslation(manifest,next.translations,path,translation);
  }
  const unchanged=JSON.stringify(next)===JSON.stringify(settingsOf(manifest));
  const plain=JSON.stringify({...next,translations:[]})===JSON.stringify(emptyDiscovery())&&!next.translations.length;
  const updated={...manifest};
  if(plain)delete updated.discovery;else updated.discovery=next;
  validateDiscovery(updated.discovery);
  const saved=unchanged?manifest:await store.commit(updated,{signal});
  return {...await store.present(saved,path,{signal}),discovery:await readView(store,saved,path,signal)};
 },{write,signal});
}

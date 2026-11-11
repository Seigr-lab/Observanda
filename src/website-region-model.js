import path from 'node:path';
import {AppError} from './errors.js';

// Site regions place one component in a page slot for a whole site, a folder or
// a single page. The site slot is the default; a folder override applies to the
// pages below it (the deepest folder wins) and a page override applies to one
// page. An override whose component is null leaves the slot empty there.
export const REGION_SLOTS=['header','sidebar','secondary-sidebar','footer'];
export const regionElement=slot=>slot==='header'?'header':slot==='footer'?'footer':'aside';
export const DEFAULT_REGION_SETTINGS=Object.freeze({side:'left',width:260,sticky:false,background:null,color:null,padding:0,mobile:'expanded',mobileTitle:''});
const defaults=slot=>({...DEFAULT_REGION_SETTINGS,side:slot==='secondary-sidebar'?'right':'left'});
const SETTING_KEYS=Object.keys(DEFAULT_REGION_SETTINGS);
const fail=()=>{throw new AppError('INVALID');};
const bad=()=>{throw new AppError('FORMAT');};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const colour=value=>value===null||typeof value==='string'&&/^#[a-f0-9]{6}$/i.test(value);
const plainText=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
const folderPath=value=>typeof value==='string'&&value.length<=1024&&(value===''||/^[^/\\]+(?:\/[^/\\]+)*$/.test(value))&&!value.split('/').some(part=>part==='.'||part==='..');
const pagePath=value=>typeof value==='string'&&value.length<=1024&&value.endsWith('.html')&&folderPath(value);

export function emptyRegions(){return {slots:{},overrides:[]};}
export function regionsOf(manifest){return manifest.regions??emptyRegions();}

// Accepts a complete settings object or a partial change applied to the slot's
// current settings. Unknown keys and out-of-range values are refused.
export function regionSettings(slot,value,base=defaults(slot)){
 if(!REGION_SLOTS.includes(slot)||!object(value)||Object.keys(value).some(key=>!SETTING_KEYS.includes(key)))fail();
 const next={...base,...value};
 if(!['left','right'].includes(next.side)||!Number.isInteger(next.width)||next.width<180||next.width>480||typeof next.sticky!=='boolean'||
  !colour(next.background)||!colour(next.color)||!Number.isInteger(next.padding)||next.padding<0||next.padding>80||
  !['expanded','collapsed'].includes(next.mobile)||!plainText(next.mobileTitle,160)||next.mobile==='collapsed'&&!next.mobileTitle.trim())fail();
 return next;
}

export function checkRegions(manifest){
 if(manifest.regions===undefined)return;
 const regions=manifest.regions,components=new Set((manifest.components??[]).map(row=>row.id));
 if(!object(regions)||Object.keys(regions).some(key=>!['slots','overrides'].includes(key))||!object(regions.slots)||!Array.isArray(regions.overrides)||regions.overrides.length>5000)bad();
 for(const [slot,entry] of Object.entries(regions.slots)){
  if(!REGION_SLOTS.includes(slot)||!object(entry)||Object.keys(entry).some(key=>!['component','settings'].includes(key))||!uuid(entry.component)||!components.has(entry.component))bad();
  try{if(JSON.stringify(regionSettings(slot,entry.settings,defaults(slot)))!==JSON.stringify(entry.settings))bad();}catch{bad();}
 }
 const seen=new Set();
 for(const row of regions.overrides){
  if(!object(row)||Object.keys(row).sort().join()!=='component,path,scope,slot'||!['page','folder'].includes(row.scope)||!REGION_SLOTS.includes(row.slot)||
   !(row.scope==='page'?pagePath(row.path):folderPath(row.path)&&row.path!=='')||!(row.component===null||uuid(row.component)&&components.has(row.component)))bad();
  const key=row.scope+'\u0000'+row.path+'\u0000'+row.slot;if(seen.has(key))bad();seen.add(key);
 }
}

// The component that fills each slot on a page, with the slot's presentation.
export function resolveRegions(manifest,page){
 const regions=regionsOf(manifest),result=[];
 if(!regions.overrides.length&&!Object.keys(regions.slots).length)return result;
 const folder=path.posix.dirname(page)==='.'?'':path.posix.dirname(page);
 for(const slot of REGION_SLOTS){
  const site=regions.slots[slot];
  let chosen=site?site.component:null,depth=-1;
  for(const row of regions.overrides){
   if(row.slot!==slot)continue;
   if(row.scope==='page'&&row.path===page){chosen=row.component;depth=Infinity;}
   else if(row.scope==='folder'&&depth!==Infinity&&(folder===row.path||folder.startsWith(row.path+'/'))){
    const level=row.path.split('/').length;if(level>depth){depth=level;chosen=row.component;}
   }
  }
  if(chosen)result.push({slot,component:chosen,settings:site?.settings??defaults(slot)});
 }
 return result;
}

// Returns the next regions value after one author change.
export function changeRegions(manifest,{slot,scope='site',path:target='',component,settings}){
 if(!REGION_SLOTS.includes(slot)||!['site','folder','page'].includes(scope))fail();
 const current=regionsOf(manifest),components=new Map((manifest.components??[]).map(row=>[row.id,row]));
 const next={slots:{...current.slots},overrides:current.overrides.filter(row=>!(row.scope===scope&&row.path===target&&row.slot===slot))};
 if(component!==undefined&&component!==null&&!components.has(component))throw new AppError('NOT_FOUND');
 if(scope==='site'){
  if(target!=='')fail();
  if(component===null){if(settings!==undefined)fail();delete next.slots[slot];}
  else{
   const prior=current.slots[slot],chosen=component??prior?.component;if(!chosen)fail();
   next.slots[slot]={component:chosen,settings:settings===undefined?prior?.settings??defaults(slot):regionSettings(slot,settings,prior?.settings??defaults(slot))};
  }
 }else{
  if(settings!==undefined||(scope==='page'?!pagePath(target):!folderPath(target)||target===''))fail();
  // undefined removes the override so the page or folder follows the site again.
  if(component!==undefined)next.overrides.push({scope,path:target,slot,component});
 }
 return next;
}

// A public page can only show a public component.
export function checkRegionVisibility(manifest,pages){
 const components=new Map((manifest.components??[]).map(row=>[row.id,row]));
 for(const page of pages)for(const region of resolveRegions(manifest,page.path)){
  if(components.get(region.component)?.draft&&!page.draft)throw new AppError('WEBSITE_PUBLIC_COMPONENT');
 }
}

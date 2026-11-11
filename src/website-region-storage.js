import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {validateWebsiteHTML} from './website-file-policy.js';
import {componentContext} from './website-component-storage.js';
import {checkComponentInstances} from './website-file-component.js';
import {REGION_SLOTS,changeRegions,checkRegionVisibility,regionsOf,resolveRegions} from './website-region-model.js';
import {REGION_SCRIPT,REGION_STYLESHEET,regionStylesheet,writePageRegions} from './website-region-markup.js';
import {PUBLIC_REGIONS_SCRIPT} from './public-regions.js';
import {operationTotal,operationAdvance} from './operation-progress.js';

const fail=()=>{throw new AppError('INVALID');};
const revision=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

// Give a page the regions its site resolves for it. Used when any page is saved
// or created, so every way of writing a page leaves its regions current.
export function placeSiteRegions(manifest,html,page){
 const resolved=resolveRegions(manifest,page.path),current=(page.instances??[]).some(row=>row.region);
 if(!resolved.length&&!current&&!html.includes('data-website-region')&&!html.includes(REGION_STYLESHEET)&&!html.includes(REGION_SCRIPT))return {html,instances:page.instances};
 const placed=writePageRegions(html,page,resolved,componentContext(manifest),randomUUID);
 return {html:placed.html,instances:placed.instances.length?placed.instances:undefined};
}

// The managed region stylesheet and phone script, present while any page shows a region.
export const REGION_FILES=[REGION_STYLESHEET,REGION_SCRIPT];
export async function regionFiles(store,id,manifest,{signal}={}){
 if(!manifest.pages.some(page=>page.instances?.some(row=>row.region)))return [];
 return [await store.siteFile(id,REGION_STYLESHEET,regionStylesheet(regionsOf(manifest).slots),{signal}),await store.siteFile(id,REGION_SCRIPT,PUBLIC_REGIONS_SCRIPT,{signal})];
}

function summary(manifest,path){
 const regions=regionsOf(manifest),components=new Map((manifest.components??[]).map(row=>[row.id,row]));
 const name=id=>id?components.get(id)?.name??null:null;
 return {
  slots:REGION_SLOTS.map(slot=>({slot,component:regions.slots[slot]?.component??null,name:name(regions.slots[slot]?.component),settings:regions.slots[slot]?.settings??null})),
  overrides:regions.overrides.map(row=>({...row,name:name(row.component)})),
  page:resolveRegions(manifest,path).map(({slot,component})=>({slot,component,name:name(component)})),
  components:[...components.values()].map(row=>({id:row.id,name:row.name,draft:Boolean(row.draft)}))
 };
}

// Rewrites the pages whose resolved regions differ between two site states
// (the saved `manifest` and `next`, with its new regions and components) and
// returns `next` with those pages, their files and the managed region files.
export async function placeChangedRegions(store,id,manifest,next,{signal,stage}={}){
 checkRegionVisibility(next,manifest.pages);
 const context=componentContext(next),scripts=new Set([...await store.scripts(manifest.files),REGION_SCRIPT]),files=new Map(next.files.map(file=>[file.name,file])),pages=[];
 operationTotal(manifest.pages.length);
 for(const page of manifest.pages){
  signal?.throwIfAborted();
  const before=resolveRegions(manifest,page.path),after=resolveRegions(next,page.path);
  if(same(before,after)){pages.push(page);operationAdvance(1,stage);continue;}
  const text=await store.readText(files.get(page.path),{signal});
  checkComponentInstances(text,page,componentContext(manifest));
  const placed=writePageRegions(text,page,after,context,randomUUID);
  const pictures=new Set(),recordings=new Set();validateWebsiteHTML(placed.html,{file:page.path,scripts,pictures,recordings});
  const changed={...page,pictures:[...pictures],recordings:[...recordings]};
  if(placed.instances.length)changed.instances=placed.instances;else delete changed.instances;
  checkComponentInstances(placed.html,changed,context);
  files.set(page.path,await store.siteFile(id,page.path,placed.html,{draft:page.draft,signal}));pages.push(changed);
  operationAdvance(1,stage);
 }
 const candidate={...next,pages};
 for(const name of REGION_FILES)files.delete(name);
 for(const file of await regionFiles(store,id,candidate,{signal}))files.set(file.name,file);
 candidate.files=[...files.values()];
 return candidate;
}
export function regionOperation(store,operation,id,options={}){
 const {expectedRevision,path='index.html',signal}=options;
 if(!revision(expectedRevision)||!['list','assign'].includes(operation))fail();
 return store.scope(async()=>{
  const manifest=await store.current(id,expectedRevision);
  if(!manifest.pages.some(page=>page.path===path))throw new AppError('NOT_FOUND');
  if(operation==='list')return {revision:expectedRevision,...summary(manifest,path)};
  const {slot,scope='site',target='',component,settings}=options;
  if(!REGION_SLOTS.includes(slot))fail();
  if(scope==='page'&&!manifest.pages.some(page=>page.path===target))throw new AppError('NOT_FOUND');
  const regions=changeRegions(manifest,{slot,scope,path:target,component,settings}),next={...manifest,regions};
  if(!Object.keys(regions.slots).length&&!regions.overrides.length)delete next.regions;
  const candidate=await placeChangedRegions(store,id,manifest,next,{signal,stage:'regionSave'});
  await store.assertSources(candidate);
  return store.present(await store.commit(candidate,{signal}),path,{signal});
 },{write:operation!=='list',signal});
}

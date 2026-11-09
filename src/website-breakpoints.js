import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {defaultBreakpoints,managedLayoutBlocks,rewriteLayoutRanges,validBreakpoints} from './web/website-breakpoint-model.js';
import {componentContext} from './website-component-storage.js';
import {checkComponentInstances,pageComponentDocument,rewriteComponentInstances} from './website-file-component.js';
import {componentDependencies} from './website-component-schema.js';

const fail=code=>{throw new AppError(code);};
const identity=range=>[range.id,range.min,range.max];
function needsRewrite(before,after){
 const old=new Set(before.map(r=>r.id));
 return JSON.stringify(before.map(identity))!==JSON.stringify(after.filter(r=>old.has(r.id)).map(identity));
}
export async function projectWebsiteBreakpoints(store,manifest,ranges,{apply=false,includeDraft=false,signal}={}){
  const before=manifest.breakpoints??defaultBreakpoints();
  const files=[],sample=[];let changed=0,manual=0;
  const rewrite=needsRewrite(before,ranges),sheets=new Set([manifest.cssPath,'draft-styles.css',...manifest.pages.map(p=>p.stylePath).filter(Boolean)]);
  for(const file of manifest.files){
   signal?.throwIfAborted();
   if(!rewrite||!sheets.has(file.name)||file.sourceId||file.feedAsset||file.tokenSheet||file.tokenFont||file.hasResponsiveLayout===false){files.push(file);continue;}
   const css=await store.readText(file,{signal});let blocks;
   const visible=includeDraft||!file.draft;
   try{blocks=managedLayoutBlocks(css);}catch{if(visible)manual++;files.push(file);continue;}
   const {css:updated,manual:preserved}=rewriteLayoutRanges(css,before,ranges,blocks);
   if(preserved&&visible)manual++;
   if(updated===css){files.push({...file,hasResponsiveLayout:blocks.size>0});continue;}
   if(visible){changed++;if(sample.length<32)sample.push(file.name);}
   files.push(apply?{...file,...await store.siteFile(manifest.id,file.name,updated,{draft:file.draft,signal})}:file);
  }
  const original=manifest.components??[],affected=new Set();
  const components=original.map(main=>{
   if(!rewrite||!main.css?.includes('/* Observanda layout '))return main;
   const {css}=rewriteLayoutRanges(main.css,before,ranges,managedLayoutBlocks(main.css));
   if(css===main.css)return main;
   affected.add(main.id);
   if(includeDraft||!main.draft){changed++;if(sample.length<32)sample.push(main.name);}
   return {...main,css};
  });
  if(apply&&affected.size){
   const current=componentContext(manifest),next={...current,components:new Map(components.map(c=>[c.id,c]))};
   const parents=componentDependencies(next.components);
   for(const id of affected)for(const parent of parents.get(id)??[])affected.add(parent);
   const changedPages=new Map(manifest.pages.filter(p=>p.instances?.some(r=>affected.has(r.component))).map(p=>[p.path,p]));
   for(const [index,file] of files.entries()){
    const page=changedPages.get(file.name);if(!page)continue;
    const html=await store.readText(file,{signal});checkComponentInstances(html,page,current);
    const updated=rewriteComponentInstances(html,pageComponentDocument(html),null,page,next,{affected});
    files[index]=await store.siteFile(manifest.id,page.path,updated,{draft:page.draft,signal});
   }
  }
  return {files,sample,changed,manual,...(manifest.components?{components}:{})};
}
export async function websiteBreakpoints(store,id,{expectedRevision,path='index.html',ranges,reviewId,signal},apply=false){
 if(!/^[a-f0-9]{64}$/.test(expectedRevision??'')||!validBreakpoints(ranges))fail('INVALID');
 return store.scope(async()=>{
  const manifest=await store.current(id,expectedRevision);
  const page=manifest.pages.find(p=>p.path===path&&!p.archived);if(!page)fail('NOT_FOUND');
  // Pin intent to the current file-backed revision. A stale review can never
  // remove layout overrides introduced after the author inspected this change.
  const pin=digest(JSON.stringify(['website-breakpoints',id,expectedRevision,ranges]));
  if(apply&&reviewId!==pin)fail('CONFLICT');
  const {changed,manual,files,sample,components}=await projectWebsiteBreakpoints(store,manifest,ranges,{apply,includeDraft:!!page.draft,signal});
  if(!apply)return {revision:manifest.revision,reviewId:pin,changed,manual,files:sample};
  const next={...manifest,breakpoints:ranges,files,...(components?{components}:{})};await store.assertSources(next);
  return store.present(await store.commit(next,{signal}),path,{signal});
 },{write:apply,signal});
}

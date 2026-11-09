import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {defaultBreakpoints,managedLayoutBlocks,rewriteLayoutRanges,validBreakpoints} from './web/website-breakpoint-model.js';

const fail=code=>{throw new AppError(code);};
const identity=range=>[range.id,range.min,range.max];
function needsRewrite(before,after){
 const old=new Set(before.map(r=>r.id));
 return JSON.stringify(before.map(identity))!==JSON.stringify(after.filter(r=>old.has(r.id)).map(identity));
}
export async function projectWebsiteBreakpoints(store,manifest,ranges,{apply=false,signal}={}){
  const before=manifest.breakpoints??defaultBreakpoints();
  const files=[],sample=[];let changed=0,manual=0;
  const rewrite=needsRewrite(before,ranges),sheets=new Set([manifest.cssPath,'draft-styles.css',...manifest.pages.map(p=>p.stylePath).filter(Boolean)]);
  for(const file of manifest.files){
   signal?.throwIfAborted();
   if(!rewrite||!sheets.has(file.name)||file.sourceId||file.feedAsset||file.tokenSheet||file.tokenFont||file.hasResponsiveLayout===false){files.push(file);continue;}
   const css=await store.readText(file,{signal});let blocks;
   try{blocks=managedLayoutBlocks(css);}catch{manual++;files.push(file);continue;}
   const {css:updated,manual:preserved}=rewriteLayoutRanges(css,before,ranges,blocks);
   if(preserved)manual++;
   if(updated===css){files.push({...file,hasResponsiveLayout:blocks.size>0});continue;}
   changed++;if(sample.length<32)sample.push(file.name);
   files.push(apply?{...file,...await store.siteFile(manifest.id,file.name,updated,{draft:file.draft,signal})}:file);
  }
  return {files,sample,changed,manual};
}
export async function websiteBreakpoints(store,id,{expectedRevision,path='index.html',ranges,reviewId,signal},apply=false){
 if(!/^[a-f0-9]{64}$/.test(expectedRevision??'')||!validBreakpoints(ranges))fail('INVALID');
 return store.scope(async()=>{
  const manifest=await store.current(id,expectedRevision);
  if(!manifest.pages.some(p=>p.path===path&&!p.archived))fail('NOT_FOUND');
  // Pin intent to the current file-backed revision. A stale review can never
  // remove layout overrides introduced after the author inspected this change.
  const pin=digest(JSON.stringify(['website-breakpoints',id,expectedRevision,ranges]));
  if(apply&&reviewId!==pin)fail('CONFLICT');
  const {changed,manual,files,sample}=await projectWebsiteBreakpoints(store,manifest,ranges,{apply,signal});
  if(!apply)return {revision:manifest.revision,reviewId:pin,changed,manual,files:sample};
  const next={...manifest,breakpoints:ranges,files};await store.assertSources(next);
  return store.present(await store.commit(next,{signal}),path,{signal});
 },{write:apply,signal});
}

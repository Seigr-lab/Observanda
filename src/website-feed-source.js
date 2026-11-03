import {createHash} from 'node:crypto';
import {parseFragment} from 'parse5';
import {AppError} from './errors.js';
import {websiteFileName,validateWebsiteHTML,validateWebsiteCSS} from './website-file-policy.js';
import {replaceSourceTags} from './website-source-tags.js';
import {indexedWebsiteRow} from './website-file-library.js';
import {websiteSearchFields} from './website-file-library-fields.js';

const root='.observanda/website-files',hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const directory=id=>{if(!hex(id))throw new AppError('INVALID');return root+'/sources/'+id;};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const members=source=>source?[source.html,source.css,...source.assets,...(source.pdfParts?[source.pdfParts]:[])]:[];
const filesOf=source=>members(source).map(file=>file.blob);
const table=prefix=>{if(!/^[0-9a-f]{2}$/.test(prefix))throw new AppError('INVALID');return root+'/feed-index/'+prefix+'.json';};
export async function feedRowShard(store,prefix,signal){return await store.control(table(prefix),{missing:true,signal})??{};}

async function rowFor(store,source,base,html,context,signal){
 const parent=await indexedWebsiteRow(store,base,{signal});
 return {...parent,...context,id:source.id,revision:source.revision,title:source.title,media:source.assets.some(asset=>/^(image|audio|video)\//.test(asset.contentType)),...websiteSearchFields(parseFragment(html))};
}
function checkedOverlay(value,id){
 if(value&&(!hex(value.baseRevision)||value.source?.id!==id||!hex(value.source.revision)||value.source.target!=='website'||typeof value.source.visible!=='boolean'||(value.source.visible?value.row?.revision!==value.source.revision:value.row!==null)))throw new AppError('FORMAT');
 return value;
}
export async function readFeedSource(store,id,revision,{signal,pending=false,includeWithdrawn=false}={}){
 signal?.throwIfAborted();const base=await store.source(id,{pending});if(!base?.visible||base.target!=='website')throw new AppError('NOT_FOUND');
 const overlay=checkedOverlay(await store.control(directory(id)+'/feed.json',{missing:true,signal}),id);
 const effective=overlay?.baseRevision===base.revision?{...overlay.source,feedRow:overlay.row}:{...base,feedRow:await indexedWebsiteRow(store,base,{signal})};
 if(!effective.visible&&!includeWithdrawn)throw new AppError('NOT_FOUND');
 if(revision&&effective.revision!==revision)throw new AppError('CONFLICT');
 return effective;
}

// Keep old file references until all affected pages commit. The journal makes
// cleanup idempotent even if a crash occurs after replacing the live head.
async function replaceOverlay(store,base,overlay,signal){
 const dir=directory(base.id),head=dir+'/feed.json',journal=dir+'/feed-retire.json';
 const previous=checkedOverlay(await store.control(head,{missing:true,signal}),base.id);
 const retired=new Set(await store.control(journal,{missing:true,signal})??[]);
 for(const name of filesOf(previous?.source))retired.add(name);
 if(retired.size)await store.writeControl(journal,[...retired],{signal});
 if(overlay)await store.writeControl(head,overlay,{signal});else if(previous)await store.remove(head);
 if(overlay||previous||retired.size){
  const prefix=base.id.slice(0,2),rows=await feedRowShard(store,prefix,signal);
  if(overlay)rows[base.id]={baseRevision:base.revision,row:overlay.row};else delete rows[base.id];
  await store.writeControl(table(prefix),rows,{signal});
 }
 const retained=new Set([...filesOf(base),...filesOf(overlay?.source)]);
 return {retired:retired.size?{id:base.id,blobs:retired}:null,retained};
}
export async function releasePreviousFeedSource(store,retired,retained,signal){
 if(!retired)return;const dir=directory(retired.id),prefix=dir+'/files/';
 for(const name of retired.blobs){
  signal?.throwIfAborted();if(!name.startsWith(prefix)||!/^[a-f0-9]{64}\.[a-z0-9]{1,12}$/.test(name.slice(prefix.length)))throw new AppError('FORMAT');
  if(!retained.has(name))await store.remove(name);
 }
 await store.remove(dir+'/feed-retire.json');
}

// A permission write already rendered both consumers from the qualified
// original. An ordinary tag write has to retain the newer live prose.
export async function synchronizeFeedSource(store,base,{tags,previous,context,row,liveOutput,signal}={}){
 if(base.target!=='website')return {live:base,retired:null,retained:new Set(filesOf(base))};
 if(liveOutput&&base.visible)return writeLiveFeedSource(store,base,{...liveOutput,context,signal});
 if(!previous&&!tags)return {live:{...base,feedRow:row??await indexedWebsiteRow(store,base,{signal})},retired:null,retained:new Set(filesOf(base))};
 const dir=directory(base.id);
 let overlay=null;
 if(tags&&base.visible){
  const old=checkedOverlay(await store.control(dir+'/feed.json',{missing:true,signal}),base.id);
  if(old&&(old.baseRevision===previous?.revision||old.baseRevision===base.revision)&&!old.source.visible)overlay={...old,baseRevision:base.revision};
  else if(old&&(old.baseRevision===previous?.revision||old.baseRevision===base.revision)){
   const html=replaceSourceTags(await store.readText(old.source.html,{signal}),tags),source={...old.source,provenance:base.provenance,html:await store.descriptor('fragment.html',html,{owner:dir,signal})};
   delete source.revision;source.revision=hash(source);
   overlay={baseRevision:base.revision,source,row:await rowFor(store,source,base,html,context,signal)};
  }
 }
 const retired=await replaceOverlay(store,base,overlay,signal);
 const live=overlay?{...overlay.source,feedRow:overlay.row}:{...base,feedRow:row??await indexedWebsiteRow(store,base,{signal})};
 return {live,...retired};
}

export async function writeLiveFeedSource(store,base,{title,html,css,assets,provenance,context,signal}){
 if(!base?.visible||base.target!=='website'||!provenance||base.provenance.workspaceId!==provenance.workspaceId||base.provenance.recordId!==provenance.recordId||base.provenance.notebookId!==provenance.notebookId||base.provenance.projectId!==provenance.projectId)throw new AppError('CONFLICT');
 validateWebsiteHTML('<!doctype html><html><head><title>Content</title></head><body>'+html+'</body></html>');validateWebsiteCSS(css);
 const owner=directory(base.id),prior=checkedOverlay(await store.control(owner+'/feed.json',{missing:true,signal}),base.id),stored=new Map();
 for(const asset of [...base.assets,...(prior?.source.assets??[])])stored.set(asset.name,asset);
 const files=[];
 for(const asset of assets){
  signal?.throwIfAborted();websiteFileName(asset.path);if(!/^assets\/[a-f0-9]{64}\.[a-z0-9]{1,12}$/.test(asset.path))throw new AppError('INVALID');
  const expected=asset.path.slice(7,71),known=stored.get(asset.path);
  const descriptor=known?.sha256===expected&&known.contentType===asset.contentType?known:await store.descriptor(asset.path,asset,{owner,signal});
  if(descriptor.sha256!==expected)throw new AppError('MEDIA_INVALID');files.push(descriptor);
 }
 const source={id:base.id,title,target:'website',visible:true,provenance,html:await store.descriptor('fragment.html',html,{owner,signal}),css:await store.descriptor('source.css',css,{owner,signal}),assets:files};
 source.revision=hash(source);
 const row=await rowFor(store,source,base,html,context,signal);
 const retired=await replaceOverlay(store,base,{baseRevision:base.revision,source,row},signal);
 return {live:{...source,feedRow:row},...retired};
}

// Removing a research owner ends its live membership. The separately saved
// ordinary placement remains owned by its website.
export async function removeLiveFeedSource(store,base,{signal}={}){
 if(!base||base.target!=='website')throw new AppError('CONFLICT');
 const owner=directory(base.id),source={id:base.id,target:'website',visible:false,title:'',provenance:base.provenance,assets:[],
  html:await store.descriptor('fragment.html','',{owner,signal}),css:await store.descriptor('source.css','',{owner,signal})};
 source.revision=hash(source);const retired=await replaceOverlay(store,base,{baseRevision:base.revision,source,row:null},signal);
 return {live:{...source,feedRow:null},...retired};
}

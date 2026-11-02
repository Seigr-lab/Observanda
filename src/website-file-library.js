import {parseFragment} from 'parse5';
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';

const root='.observanda/website-files',index=root+'/picker',generation=index+'/generation.json';
const views=new WeakMap(),validId=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
const shardFile=id=>index+'/'+id.slice(0,2)+'.json';
const text=value=>value.normalize('NFKC').toLowerCase();
const scanLimit=4096,olderLimit=40;

// Only text from the already permitted website fragment is used. Never open
// its source record, attachments or a research catalogue to build a preview.
function excerpt(html,title){
 const parts=[];let length=0;
 function visit(node){
  if(length>=240||['script','style','template','noscript'].includes(node.tagName)||node.attrs?.some(a=>a.name==='hidden'||a.name==='aria-hidden'&&a.value==='true'))return;
  if(node.nodeName==='#text'){const part=node.value.slice(0,1000).replace(/\s+/gu,' ').trim();if(part&&part!==title){parts.push(part);length+=part.length+1;}return;}
  for(const child of node.childNodes??[]){visit(child);if(length>=240)break;}
 }
 visit(parseFragment(html));return [...parts.join(' ')].slice(0,200).join('');
}
function describe(source,preview=''){
 const media=source.assets.some(f=>/^(?:image|audio|video)\//.test(f.contentType));
 const {recordId,notebookId}=source.provenance??{};
 return {id:source.id,revision:source.revision,title:source.title,media,preview,...(recordId?{recordId,notebookId}:{})};
}
async function shard(store,id){return await store.control(shardFile(id),{missing:true})??{};}
export async function indexWebsiteSource(store,source,html,signal){
 const entries=await shard(store,source.id);
 // A tombstone also distinguishes a processed private/PDF source from one
 // written before the compact index existed. Never retain its title or text.
 entries[source.id]=source.visible&&source.target==='website'?describe(source,excerpt(html,source.title)):null;
 await store.writeControl(shardFile(source.id),entries,{signal});
 await store.writeControl(generation,randomUUID(),{signal});
}
async function version(store){return store.control(generation,{missing:true,limit:128});}
async function ids(store,scope,signal){
 const result=[];
 await scope.member(store.absolute(root+'/sources/sentinel'),async directory=>{
  if(!directory)return;
  for await(const entry of directory.entries()){
   signal?.throwIfAborted();if(entry.directory&&validId(entry.name))result.push(entry.name);
  }
 },{missing:true});
 return result.sort();
}
function afterIndex(names,after){
 if(after===null)return 0;
 let lo=0,hi=names.length;
 while(lo<hi){const mid=Math.floor((lo+hi)/2);if(names[mid]<=after)lo=mid+1;else hi=mid;}
 return lo;
}
export async function searchWebsiteLibrary(store,scope,{search='',filter='all',after=null,limit=20,signal}={}){
 if(typeof search!=='string'||search.length>160||!['all','media','text'].includes(filter)||after!==null&&!validId(after)||!Number.isInteger(limit)||limit<1||limit>40)throw new AppError('INVALID');
 const epoch=await version(store),vault=store.workspace.vault;
 let view=views.get(vault);
 if(!view||view.epoch!==epoch||view.root!==store.workspace.root){
  // Cache only directory identifiers. Protected text stays on disk across
  // requests, and permission changes invalidate the name census across processes.
  view={epoch,root:store.workspace.root,names:await ids(store,scope,signal)};views.set(vault,view);
 }
 const pending=await store.pendingSources(),terms=text(search).trim().split(/\s+/u).filter(Boolean);
 const items=[];let at=afterIndex(view.names,after),visited=0,older=0,group=null,metadata;
 for(;at<view.names.length&&visited<scanLimit&&older<olderLimit&&items.length<limit;at++,visited++){
  signal?.throwIfAborted();const id=view.names[at];if(pending.has(id))continue;
  if(group!==id.slice(0,2)){group=id.slice(0,2);metadata=await shard(store,id);}
  let item=metadata[id];
  if(item===undefined){
   // Earlier workspaces have file descriptors without compact summaries.
   // Read only those descriptors, never a fragment or asset during search.
   older++;const source=await store.source(id,{pending:true});item=source?.visible&&source.target==='website'?describe(source):null;
  }
  if(!item)continue;
  if(item.id!==id||!validId(item.revision)||typeof item.title!=='string'||typeof item.media!=='boolean')throw new AppError('FORMAT');
  if(filter!=='all'&&(filter==='media')!==item.media)continue;
  const haystack=text([item.title,item.id,item.recordId??'',item.notebookId??''].join(' '));
  if(terms.every(term=>haystack.includes(term)))items.push(item);
 }
 // A completed permission change advances the epoch. An in-flight change
 // fences its ID before touching any original or file-backed projection.
 const fenced=await store.pendingSources();
 if(await version(store)!==epoch)throw new AppError('WEBSITE_CHANGED');
 return {items:items.filter(item=>!fenced.has(item.id)),next:at<view.names.length?view.names[at-1]:null,generation:epoch};
}
export async function validateWebsiteLibraryRows(store,{items,generation:prior,signal}={}){
 if(!Array.isArray(items)||items.length>40||items.some(r=>!validId(r?.id)||!validId(r.revision)))throw new AppError('INVALID');
 const epoch=await version(store),pending=await store.pendingSources(),accepted=[];
 for(const row of items){
  signal?.throwIfAborted();if(pending.has(row.id))continue;
  if(prior!==epoch||epoch===null){
   const source=await store.source(row.id,{pending:true});
   if(!source?.visible||source.target!=='website'||source.revision!==row.revision)continue;
  }
  accepted.push(row.id);
 }
 const fenced=await store.pendingSources();
 if(await version(store)!==epoch)throw new AppError('WEBSITE_CHANGED');
 return {accepted:accepted.filter(id=>!fenced.has(id)),generation:epoch};
}
export async function previewWebsiteSource(store,id,revision,signal){
 const epoch=await version(store),source=await store.source(id);
 if(!source?.visible||source.target!=='website')throw new AppError('NOT_FOUND');
 if(source.revision!==revision)throw new AppError('CONFLICT');
 const row=(await shard(store,id))[id];
 const preview=row?.revision===revision?row.preview:excerpt(await store.readText(source.html,{signal}),source.title);
 if((await store.pendingSources()).has(id)||await version(store)!==epoch)throw new AppError('WEBSITE_CHANGED');
 return {id,revision,preview};
}

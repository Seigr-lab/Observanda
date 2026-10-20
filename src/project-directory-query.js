import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {ownerDirectorySortKey} from './owner-directory-model.js';
const normalize=value=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
const signature=view=>digest(serialize({registry:view.revision,legacy:view.legacy??[]}));
const label=(entry,index)=>index==='template'?entry.summary?.templateName:entry.summary?.title??entry.projectId;
const key=(entry,index)=>ownerDirectorySortKey(label(entry,index),entry.projectId);
// Only historical inline headings are merged in memory. Native owners remain
// in their authenticated index; ordinary lists seek directly to a bounded page.
async function* ordered(view,index,legacy){
 let position=0;for await(const row of view.entries({index})){
  while(position<legacy.length&&key(legacy[position],index)<row.key)yield legacy[position++];
  yield row.entry;
 }while(position<legacy.length)yield legacy[position++];
}
export async function projectDirectoryChoices(registry,input,{signal}={}){
 if(!input||Object.keys(input).sort().join()!=='exclude,kind,limit,offset,query,revision'||!['parents','templates','book-parents','record-parents'].includes(input.kind)||input.exclude!==null&&!researchId(input.exclude)||typeof input.query!=='string'||input.query.length>160||!Number.isSafeInteger(input.offset)||input.offset<0||!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>50||input.revision!==null&&typeof input.revision!=='string')throw new AppError('INVALID');
 return registry.inspect(async view=>{
  signal?.throwIfAborted();const revision=input.kind==='book-parents'?view.revision:signature(view);if(input.revision!==null&&input.revision!==revision)throw new AppError('CONFLICT');
  const index=input.kind==='templates'?'template':'label',query=normalize(input.query.trim()),legacy=(view.legacy??[]).filter(entry=>index!=='template'||entry.summary?.templateName).sort((a,b)=>key(a,index)<key(b,index)?-1:1),projects=[];
  const present=async entry=>({projectId:entry.projectId,parentId:entry.parentId,summary:entry.summary??null,...(input.kind==='record-parents'?{legacy:entry.legacy===true,ancestors:(await view.ancestors(entry.projectId)).slice(1).reverse().map(parent=>parent.summary?.title??parent.projectId)}:{})});
  if(!query&&!input.exclude&&!legacy.length){const page=await view.page({index,offset:input.offset,limit:input.limit,signal});for(const row of page.items)projects.push(await present(row.entry));return {revision,total:page.total,projects};}
  let total=0;const unfiltered=!query&&!input.exclude;
  const knownTotal=unfiltered?(await view.page({index,limit:1})).total+legacy.length:null;
  for await(const entry of ordered(view,index,legacy)){
   signal?.throwIfAborted();
   if(entry.projectId===input.exclude)continue;
   let ancestry;
   if(input.kind==='parents'&&input.exclude){ancestry=await view.ancestors(entry.projectId);if(ancestry.some(parent=>parent.projectId===input.exclude))continue;}
   if(query){if(input.kind==='record-parents')ancestry??=await view.ancestors(entry.projectId);if(!normalize([entry.summary?.title,label(entry,index),entry.projectId,...(input.kind==='record-parents'?ancestry??[]:[]).slice(1).map(parent=>parent.summary?.title??parent.projectId)].join(' ')).includes(query))continue;}
   if(total++>=input.offset&&projects.length<input.limit)projects.push(await present(entry));
   if(unfiltered&&projects.length===input.limit)break;
  }
  return {revision,total:knownTotal??total,projects};
 },{legacy:input.kind!=='book-parents'});
}

export async function projectDirectoryPage(registry,input,{signal}={}){
 if(!input||!['limit,offset,revision','limit,offset,parentId,revision'].includes(Object.keys(input).sort().join())||!Number.isSafeInteger(input.offset)||input.offset<0||!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100||input.revision!==null&&typeof input.revision!=='string'||input.parentId!==undefined&&input.parentId!==null&&!researchId(input.parentId))throw new AppError('INVALID');
 return registry.inspect(async view=>{
  signal?.throwIfAborted();const revision=signature(view);if(input.revision!==null&&input.revision!==revision)throw new AppError('CONFLICT');
  const ancestors=input.parentId?(await view.ancestors(input.parentId)).reverse():[],page=await view.page({index:input.parentId===undefined?'label':'parent',offset:input.offset,limit:input.limit,signal,...(input.parentId===undefined?{}:{prefix:(input.parentId??'root')+':'})});
  return {revision,total:page.total,projects:page.items.map(row=>row.entry),...(input.parentId===undefined?{}:{ancestors})};
 },{legacy:true});
}

import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {ownerDirectorySortKey} from './owner-directory-model.js';
import {queryResultWindow} from './query-result-window.js';
import {projectChoiceAncestry} from './project-choice-ancestry.js';
import {withProjectChoiceWork} from './project-choice-work.js';
import {queryCallbackSource} from './query-callback-source.js';
import {validLanguage} from './web/i18n/runtime.js';
const normalize=value=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
const signature=view=>digest(serialize({registry:view.revision,legacy:view.legacy??[]}));
const label=(entry,index)=>index==='template'?entry.summary?.templateName:entry.summary?.title??entry.projectId;
const key=(entry,index)=>ownerDirectorySortKey(label(entry,index),entry.projectId);
// Only historical inline headings are merged in memory. Native owners remain
// in their authenticated index; ordinary lists seek directly to a bounded page.
// A record destination shows its project path, so record parents are listed in
// path order: a depth-first walk that visits each project's children ordered by
// title in the interface language. Every page of the result is then in path
// order across the whole list. The walk carries each branch's search summary
// (the same one project-choice-ancestry.js keeps), so no ancestor is read again.
const collators=new Map();
const collator=locale=>{if(!collators.has(locale))collators.set(locale,new Intl.Collator(locale,{numeric:true,sensitivity:'base'}));return collators.get(locale);};
async function* pathOrdered(view,legacy,{locale,query,normalize,signal,check=()=>{}}){
 const width=Math.max(0,query.length-1),compare=collator(locale);
 const title=entry=>entry.summary?.title??entry.projectId;
 const children=async parentId=>{
  const found=[];
  for await(const row of view.entries({index:'parent',prefix:(parentId??'root')+':'})){check();signal?.throwIfAborted();found.push(row.entry);}
  for(const entry of legacy)if((entry.parentId??null)===parentId)found.push(entry);
  return found.sort((a,b)=>compare.compare(title(a),title(b))||(a.projectId<b.projectId?-1:a.projectId>b.projectId?1:0));
 };
 const root={prefix:'',matched:false,excluded:false,present:false};
 const stack=[{items:await children(null),position:0,inherited:root}];
 while(stack.length){
  const frame=stack.at(-1);if(frame.position===frame.items.length){stack.pop();continue;}
  const entry=frame.items[frame.position++],inherited=frame.inherited,label=normalize(title(entry));
  yield {entry,inherited};
  const summary={prefix:(label+(label.length<width&&inherited.present?' '+inherited.prefix:'')).slice(0,width),matched:!!query&&label.includes(query)||inherited.matched||!!query&&inherited.present&&((width?label.slice(-width):'')+' '+inherited.prefix).includes(query),excluded:false,present:true};
  stack.push({items:await children(entry.projectId),position:0,inherited:summary});
 }
}
async function* ordered(view,index,legacy){
 let position=0;for await(const row of view.entries({index})){
  while(position<legacy.length&&key(legacy[position],index)<row.key)yield legacy[position++];
  yield row.entry;
 }while(position<legacy.length)yield legacy[position++];
}
export async function projectDirectoryChoices(registry,input,{signal,withWork=withProjectChoiceWork}={}){
 if(!input||!['exclude,kind,limit,offset,query,revision','exclude,kind,limit,locale,offset,query,revision'].includes(Object.keys(input).sort().join())||input.locale!==undefined&&!validLanguage(input.locale)||!['parents','templates','book-parents','record-parents'].includes(input.kind)||input.exclude!==null&&!researchId(input.exclude)||typeof input.query!=='string'||input.query.length>160||!Number.isSafeInteger(input.offset)||input.offset<0||!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>50||input.revision!==null&&typeof input.revision!=='string')throw new AppError('INVALID');
 return registry.inspect(async view=>{
  signal?.throwIfAborted();const revision=input.kind==='book-parents'?view.revision:signature(view);if(input.revision!==null&&input.revision!==revision)throw new AppError('CONFLICT');
  const index=input.kind==='templates'?'template':'label',query=normalize(input.query.trim()),legacy=(view.legacy??[]).filter(entry=>index!=='template'||entry.summary?.templateName).sort((a,b)=>key(a,index)<key(b,index)?-1:1),projects=[];
  const present=async entry=>({projectId:entry.projectId,parentId:entry.parentId,summary:entry.summary??null,...(input.kind==='record-parents'?{legacy:entry.legacy===true,ancestors:(await view.ancestors(entry.projectId)).slice(1).reverse().map(parent=>parent.summary?.title??parent.projectId)}:{})});
  const byPath=input.kind==='record-parents',locale=input.locale??'en';
  if(!byPath&&!query&&!input.exclude&&!legacy.length){const page=await view.page({index,offset:input.offset,limit:input.limit,signal});for(const row of page.items)projects.push(await present(row.entry));return {revision,total:page.total,projects};}
  const needsAncestry=input.kind==='parents'&&input.exclude||input.kind==='record-parents'&&query;
  const source=(check=()=>{})=>queryCallbackSource((emit,sourceSignal)=>{
   if(byPath)return (async()=>{
    let position=0;
    for await(const {entry,inherited} of pathOrdered(view,view.legacy??[],{locale,query,normalize,signal:sourceSignal,check})){
     check();sourceSignal.throwIfAborted();const sequence=String(position++).padStart(16,'0');if(entry.projectId===input.exclude)continue;
     const text=normalize([entry.summary?.title,label(entry,index),entry.projectId].join(' '));
     const matched=!query||text.includes(query)||inherited.matched||inherited.present&&(text.slice(-Math.max(0,query.length-1))+' '+inherited.prefix).includes(query);
     if(matched)await emit({id:entry.projectId,title:sequence,entry});
    }
   })();
   const produce=async work=>{
   const ancestors=projectChoiceAncestry(view,work,{query:input.kind==='record-parents'?query:'',exclude:input.kind==='parents'?input.exclude:null,normalize,signal:sourceSignal,check});
   for await(const entry of ordered(view,index,legacy)){
    check();sourceSignal.throwIfAborted();if(entry.projectId===input.exclude)continue;let excluded=false;
    const text=normalize([entry.summary?.title,label(entry,index),entry.projectId].join(' '));let matched=!query||text.includes(query);
    if(needsAncestry){const inherited=await ancestors(entry.parentId);excluded=inherited.excluded;if(input.kind==='record-parents')matched||=inherited.matched||inherited.present&&(text.slice(-Math.max(0,query.length-1))+' '+inherited.prefix).includes(query);}
    if(!excluded&&matched)await emit({id:entry.projectId,title:key(entry,index),entry});
   }
   };return needsAncestry?withWork(registry.workspace,produce,{signal:sourceSignal}):produce(null);
  },{signal,check});
  const cached=await queryResultWindow({workspace:registry.workspace,ownerId:registry.workspaceId,snapshotId:revision,queryHash:digest(JSON.stringify(['project-choices',input.kind,input.exclude,query,...(byPath?[locale]:[])])),order:(a,b)=>a.title<b.title?-1:a.title>b.title?1:0,point:value=>({id:value.id,title:value.title}),offset:input.offset,limit:input.limit,reuse:input.revision!==null,signal},source);
  if(cached){for(const row of cached.records)projects.push(await present(row.entry));return {revision,total:cached.total,projects};}
  let total=0;const unfiltered=!byPath&&!query&&!input.exclude;
  const knownTotal=unfiltered?(await view.page({index,limit:1})).total+legacy.length:null;
  for await(const {entry} of source().rows){
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

import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {authoredPageVersion,renderPageVersion} from './website-version-document.js';
import {archivedBlobs,currentFileBlobs,maxNamed,maxVersions,readVersionIndex,retiredLimit} from './website-version-retention.js';
import {governedResources,readVersionJSON} from './website-version-snapshots.js';
import {pageStylesheet} from './website-page-style.js';
import {parse} from 'parse5';

const validRevision=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const invalid=()=>{throw new AppError('INVALID');};
const summaries=index=>index.entries.map(({refs,snapshot,identity,...row})=>row);
export async function versionContext(store,id,expectedRevision,version,manifest){
 if(!validRevision(expectedRevision)||!researchId(version))invalid();
 const current=manifest??await store.current(id,expectedRevision),index=await readVersionIndex(store,current);
 const entry=index.entries.find(e=>e.id===version);if(!entry)throw new AppError('NOT_FOUND');
 const saved=await readVersionJSON(store,id,entry.snapshot);
 if(saved?.format!==1||!Array.isArray(saved.pages)||!Array.isArray(saved.assets)||!saved.settings)throw new AppError('FORMAT');
 const held=archivedBlobs(index);
 for(const blob of currentFileBlobs(current))held.add(blob);
 return {current,entry,saved,held,governed:governedResources(current),files:new Map(current.files.map(f=>[f.name,f])),assets:new Map(saved.assets.map(f=>[f.name,f]))};
}
function readableText(html){
 const nodes=[parse(html)],pieces=[];
 while(nodes.length){
  const n=nodes.pop();
  if(n.nodeName==='#text'){const text=n.value.trim();if(text)pieces.push(text);continue;}
  if(['style','script','template'].includes(n.tagName)||n.attrs?.some(a=>a.name==='hidden'))continue;
  for(let i=(n.childNodes?.length??0)-1;i>=0;i--)nodes.push(n.childNodes[i]);
 }
 return pieces.join('\n');
}
const textWindow=16384;
function changeWindow(before,after,offset){
 if(before===null)return {before:null,after:after.slice(0,textWindow),offset:0,total:after.length,first:null,next:null};
 const common=Math.min(before.length,after.length),total=Math.max(before.length,after.length);
 let first=0;while(first<common&&before[first]===after[first])first++;
 const from=Math.min(offset??Math.max(0,first===total?0:first-140),total);
 return {before:before.slice(from,from+textWindow),after:after.slice(from,from+textWindow),first:first<total?first:null,offset:from,total,next:from+textWindow<total?from+textWindow:null};
}
// Only authored text, the current projection, and explicitly acknowledged
// omissions may enter a comparison. No historical source snapshot is read.
export async function versionPage(store,context,page,signal){
 const {saved,current,files,held,governed}=context,former=saved.pages.find(p=>p.path===page);
 const owner=current.pages.find(p=>p.path===page),file=files.get(page),raw=file?await store.readText(file,{signal}):'';
 if(!former)return {status:'currentOnly',raw,owner};
 if(former.unavailable||!held.has(former.document?.file.blob))return {status:'unavailable',raw,owner,former};
 let version;
 if(former.document.kind==='template'){
  version=await readVersionJSON(store,current.id,former.document.file);
  if(former.stamps){
   if(former.stamps.length!==version.slots.length)throw new AppError('FORMAT');
   version.slots=version.slots.map((slot,i)=>({...slot,stamp:former.stamps[i]}));
  }
 }
 else if(former.document.kind==='html')version=authoredPageVersion(await store.readText(former.document.file,{signal}),page,governed);
 else throw new AppError('FORMAT');
 const result=renderPageVersion(version,raw,page,governed);
 if(!result.available)return {status:'unavailable',raw,owner,former};
 const status=former.draft&&owner&&!owner.draft?'private':result.currentOnly?'newSources':'ready';
 return {status,raw,owner,former,...result};
}
export function websiteVersions(store,id,operation,options){
 const {expectedRevision,version,path='index.html',label,offset=0,signal}=options;
 if(!validRevision(expectedRevision))invalid();
 const write=operation==='name'||operation==='release';
 return store.scope(async()=>{
  const current=await store.current(id,expectedRevision);
  if(operation==='list'){
   const index=await readVersionIndex(store,current);
   await store.current(id,expectedRevision);
   return {revision:current.revision,items:summaries(index),maxNamed,maxVersions,retiredLimit};
  }
  if(write){
   if(operation==='name'&&(typeof label!=='string'||!label.trim()||label.trim().length>120)||operation==='release'&&!researchId(version))invalid();
   const next=await store.commit(current,{signal,versioning:operation==='name'?{label}:{release:version}});
   return store.present(next,path,{signal});
  }
  const {query='',textOffset,area='text'}=options;
  if(!['compare','contents'].includes(operation)||!Number.isSafeInteger(offset)||offset<0||typeof query!=='string'||query.length>160||!['text','html','css'].includes(area)||textOffset!==undefined&&(!Number.isSafeInteger(textOffset)||textOffset<0))invalid();
  const context=await versionContext(store,id,expectedRevision,version,current);
  const allPages=new Set([...context.saved.pages,...current.pages].map(p=>p.path));
  const term=query.toLocaleLowerCase(),pages=[...allPages].filter(name=>name.toLocaleLowerCase().includes(term)).sort();
  if(operation==='contents'){
   const list=options.kind==='component'?context.saved.settings.components.map(c=>({id:c.id,name:c.name})).filter(c=>c.name.toLocaleLowerCase().includes(term)):pages.map(name=>({id:name,name}));
   await store.current(id,expectedRevision);
   return {revision:expectedRevision,version,items:list.slice(offset,offset+40),total:list.length,next:offset+40<list.length?offset+40:null};
  }
  if(!allPages.has(path))throw new AppError('NOT_FOUND');
  const row=await versionPage(store,context,path,signal);
  const style=pageStylesheet(context.saved.settings,row.former),selected=context.assets.get(style);
  const currentName=pageStylesheet(current,row.owner),now=context.files.get(currentName);
  const priorCSS=area==='css'&&selected&&context.held.has(selected.blob)?await store.readText(selected,{signal}):null;
  const activeCSS=area==='css'&&now?await store.readText(now,{signal}):'';
  await store.current(id,expectedRevision);
  const before=area==='css'?priorCSS:row.html??null,after=area==='css'?activeCSS:row.raw;
  const difference=changeWindow(before===null?null:area==='text'?readableText(before):before,area==='text'?readableText(after):after,textOffset);
  return {revision:expectedRevision,version,path,status:row.status,unavailable:row.unavailable??0,updated:row.updated??0,currentOnly:row.currentOnly??0,area,difference};
 },{write,signal});
}

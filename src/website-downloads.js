import path from 'node:path';
import {AppError} from './errors.js';
import {websiteFileName} from './website-file-policy.js';
import {fileReferences} from './website-page-dependencies.js';
import {pendingDownloadName} from './web/website-download-link.js';

// Files an author offers to visitors, such as a paper, a dataset export or an
// archive. They are the author's own uploads, never lab book material: research
// reaches a website only through its source projection. A download is
// delivered only while a page included in the publication links to it, so a
// file linked from a private draft stays private.
export const websiteDownloadLimit=128*1024*1024;
const folder='downloads/';
const isDownload=file=>file.download===true&&file.name.startsWith(folder);

export function downloadFileName(original,taken){
 const base=path.posix.basename(String(original??'').replaceAll('\\','/')).normalize('NFC');
 const dot=base.lastIndexOf('.'),extension=dot>0?base.slice(dot+1).toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,12):'';
 let stem=(dot>0?base.slice(0,dot):base).replace(/[^\p{L}\p{N}_-]+/gu,'-').replace(/-+/g,'-').replace(/^[-_]+|[-_]+$/g,'').slice(0,100)||'download';
 if(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(stem))stem+='-file';
 const name=suffix=>folder+stem+suffix+(extension?'.'+extension:'');
 let candidate=name(''),n=2;while(taken.has(candidate.toLowerCase()))candidate=name('-'+n++);
 websiteFileName(candidate);return candidate;
}

async function referencedDownloads(store,manifest,pages,signal){
 const projection=new Map((manifest.publicPageFiles??[]).map(({file})=>[file.name,file.references])),files=new Map(manifest.files.map(file=>[file.name,file])),names=new Set();
 for(const page of pages){
  const file=files.get(page.path);if(!file)continue;
  const references=projection.get(page.path)??await fileReferences(store,file,signal);
  for(const reference of references??[])if(reference.name.startsWith(folder))names.add(reference.name);
 }
 return names;
}
export function publicDownloadNames(store,manifest,signal){return referencedDownloads(store,manifest,manifest.pages.filter(page=>!page.draft),signal);}

export function listWebsiteDownloads(store,id,{expectedRevision,signal}={}){return store.scope(async()=>{
 const manifest=await store.current(id,expectedRevision),downloads=manifest.files.filter(isDownload);
 const [used,published]=await Promise.all([referencedDownloads(store,manifest,manifest.pages,signal),publicDownloadNames(store,manifest,signal)]);
 return {revision:manifest.revision,items:downloads.map(file=>({name:file.name,size:file.size,contentType:file.contentType,used:used.has(file.name),published:published.has(file.name)}))};
},{signal});}

// Adds the uploaded file, then saves the edited page that links to it against
// the new revision, within one write scope, so unsaved writing is kept.
export function saveWebsiteDownload(store,id,{expectedRevision,path:page,html,css,historyKey,name,bytes,signal}){return store.scope(async()=>{
 if(!Buffer.isBuffer(bytes)||!bytes.length)throw new AppError('INVALID');if(bytes.length>websiteDownloadLimit)throw new AppError('LIMIT');
 if(typeof html!=='string'||typeof css!=='string'||!html.includes(folder+pendingDownloadName))throw new AppError('INVALID');
 const manifest=await store.current(id,expectedRevision),file=downloadFileName(name,new Set(manifest.files.map(item=>item.name.toLowerCase())));
 const descriptor={...await store.siteFile(id,file,bytes,{signal}),download:true};
 const added=await store.commit({...manifest,files:[...manifest.files,descriptor]},{signal});
 const linked=html.replaceAll(folder+pendingDownloadName,file);
 try{return {...await store.save(id,{expectedRevision:added.revision,path:page,html:linked,css,historyKey,signal}),download:file};}
 catch(error){
  // A page that cannot be saved leaves no unreferenced upload behind.
  const current=await store.current(id).catch(()=>null);
  if(current?.revision===added.revision)await store.commit({...current,files:current.files.filter(item=>item.name!==file)},{signal}).catch(()=>{});
  throw error;
 }
},{write:true,signal});}

// A four-byte header length, the JSON page save, then the file bytes.
export async function readDownloadUpload(request,{signal}={}){
 const chunks=[];let size=0;const ceiling=4+40*1024*1024+websiteDownloadLimit;
 for await(const chunk of request){signal?.throwIfAborted();size+=chunk.length;if(size>ceiling)throw new AppError('LIMIT');chunks.push(chunk);}
 const body=Buffer.concat(chunks,size);if(body.length<4)throw new AppError('INVALID');
 const length=body.readUInt32BE(0);if(!length||length>40*1024*1024||4+length>body.length)throw new AppError('INVALID');
 let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body.subarray(4,4+length)));}catch{throw new AppError('INVALID');}
 const allowed=new Set(['siteId','expectedRevision','path','historyKey','html','css','name']);
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(key=>!allowed.has(key))||typeof data.name!=='string')throw new AppError('INVALID');
 const bytes=body.subarray(4+length);if(bytes.length>websiteDownloadLimit)throw new AppError('LIMIT');
 return {data,bytes:Buffer.from(bytes)};
}

export function removeWebsiteDownload(store,id,{expectedRevision,name,signal}){return store.scope(async()=>{
 const manifest=await store.current(id,expectedRevision),file=manifest.files.find(item=>item.name===name&&isDownload(item));
 if(!file)throw new AppError('NOT_FOUND');
 if((await referencedDownloads(store,manifest,manifest.pages,signal)).has(name))throw new AppError('CONFLICT');
 const saved=await store.commit({...manifest,files:manifest.files.filter(item=>item!==file)},{signal});
 return {revision:saved.revision};
},{write:true,signal});}

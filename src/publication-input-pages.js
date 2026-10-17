// Custom-page originals belong to the retained publication input. The source
// manifest keeps labels and authenticated teasers, never page bodies/sections.
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {validWebsitePage} from './web/website-item-validation.js';
import {publicationExcerpt} from './web/publication-card.js';
const invalid=()=>{throw new AppError('INVALID');},damaged=()=>{throw new AppError('JOB_DAMAGED');};
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys;
const file=(job,id)=>'.observanda/release-inputs/'+job+'/'+id+'.json';
function labels(metadata,fail){
 if(!metadata||!researchId(metadata.id)||!Array.isArray(metadata.pages))fail();
 const result=new Map();
 for(const page of metadata.pages){
  if(!exact(page,'body,id,sections,share,title')||!validWebsitePage(page,{formatVersion:metadata.formatVersion??21})||page.body!==''||!Array.isArray(page.sections)||page.sections.length||result.has(page.id))fail();
  result.set(page.id,{id:page.id,title:page.title,share:page.share});
 }
 return result;
}
function knownIds(metadata,records=[]){
 const result=new Set();
 // These are already admitted metadata values. Only identifiers are copied;
 // traversal never accumulates their prose or collection members.
 const visit=value=>{
  if(typeof value==='string'){if(researchId(value))result.add(value);return;}
  if(Array.isArray(value)){for(const item of value)visit(item);return;}
  if(value&&typeof value==='object')for(const item of Object.values(value))visit(item);
 };
 visit(metadata);for(const row of records)if(researchId(row?.id))result.add(row.id);return result;
}
function validRef(value){
 return exact(value,'bytes,excerpt,fileId,hasBody,id,sha256')&&researchId(value.id)&&researchId(value.fileId)&&hash(value.sha256)&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&typeof value.excerpt==='string'&&value.excerpt.length<=240&&typeof value.hasBody==='boolean'&&(value.hasBody||value.excerpt==='');
}
function matches(page,label){return page.id===label.id&&page.title===label.title&&page.share===label.share;}
async function exists(workspace,path){
 if(typeof workspace.readMetadata!=='function')return false;
 try{return await workspace.readMetadata(path,0)!==null;}
 catch(error){if(error.code==='LIMIT')return true;throw error;}
}
// Use the workspace supplied by withPublicationCapture: its writeMetadata
// queues at most 32 files / 256 KiB per commit and owns interrupted cleanup.
export async function retainPublicationPages(workspace,jobId,metadata,pages,{signal,excludeIds=[]}={}){
 if(!researchId(jobId)||!Array.isArray(excludeIds)||excludeIds.some(id=>!researchId(id))||!pages||typeof pages[Symbol.asyncIterator]!=='function'&&typeof pages[Symbol.iterator]!=='function')invalid();
 const expected=labels(metadata,invalid),reserved=knownIds(metadata),seen=new Set(),retained=new Map(),formatVersion=metadata.formatVersion??21;
 for(const id of excludeIds)reserved.add(id);
 for await(const page of pages){
  signal?.throwIfAborted();const label=expected.get(page?.id);
  if(!label||!validWebsitePage(page,{formatVersion})||!matches(page,label)||seen.has(page.id))invalid();seen.add(page.id);
  if(!page.share)continue;
  // Serialize this original once before awaiting storage. Only its reference
  // survives the iteration; neither skipped private content nor prior bodies
  // are copied into the manifest.
  const raw=serialize(page),ref={id:page.id,fileId:null,sha256:digest(raw),bytes:Buffer.byteLength(raw),excerpt:publicationExcerpt(page.body),hasBody:Boolean(page.body)};
  do{signal?.throwIfAborted();ref.fileId=randomUUID();}while(reserved.has(ref.fileId)||await exists(workspace,file(jobId,ref.fileId)));
  reserved.add(ref.fileId);await workspace.writeMetadata(file(jobId,ref.fileId),raw);retained.set(ref.id,ref);
 }
 signal?.throwIfAborted();const refs=[];
 for(const label of expected.values())if(label.share){const ref=retained.get(label.id);if(!ref)invalid();refs.push(ref);}
 return refs;
}
// Whole-source admission runs once when a retained v4 source is opened.
// Older manifests retain their exact inline custom-page representation.
export function validatePublicationPages(source){
 if([1,2,3].includes(source?.version))return;
 if(source?.version!==4||!researchId(source.id)||!Array.isArray(source.pageInputs))damaged();
 const expected=labels(source.metadata,damaged),reserved=knownIds(source.metadata,Array.isArray(source.records)?source.records:[]),seen=new Set();
 for(const ref of source.pageInputs){
  if(!validRef(ref)||seen.has(ref.id)||reserved.has(ref.fileId))damaged();const label=expected.get(ref.id);if(!label?.share)damaged();seen.add(ref.id);reserved.add(ref.fileId);
 }
 for(const label of expected.values())if(label.share!==seen.has(label.id))damaged();
}
export async function readPublicationPage(workspace,source,pageId,{signal}={}){
 signal?.throwIfAborted();if(!researchId(pageId))throw new AppError('INVALID');
 if([1,2,3].includes(source?.version)){
  const pages=source.version===1?source.book?.pages:source.metadata?.pages,page=Array.isArray(pages)?pages.find(value=>value.id===pageId):null;if(!page)damaged();return page;
 }
 if(source?.version!==4||!researchId(source.id)||!Array.isArray(source.metadata?.pages)||!Array.isArray(source.pageInputs))damaged();
 // The complete mapping was checked on source admission. Recheck the selected
 // references and label directly without revalidating every other page.
 let label=null,ref=null;
 for(const value of source.metadata.pages)if(value?.id===pageId){if(label)damaged();label=value;}
 for(const value of source.pageInputs)if(value?.id===pageId){if(ref)damaged();ref=value;}
 if(!label||!exact(label,'body,id,sections,share,title')||!validWebsitePage(label,{formatVersion:source.metadata.formatVersion??21})||label.body!==''||label.sections.length||!label.share||!validRef(ref))damaged();
 let raw;try{raw=await workspace.readMetadata(file(source.id,ref.fileId),ref.bytes);}catch(error){if(['LIMIT','ENOENT'].includes(error.code))damaged();throw error;}
 signal?.throwIfAborted();if(typeof raw!=='string'||Buffer.byteLength(raw)!==ref.bytes||digest(raw)!==ref.sha256)damaged();
 let page;try{page=JSON.parse(raw);}catch{damaged();}
 if(!validWebsitePage(page,{formatVersion:source.metadata.formatVersion??21})||!matches(page,label)||publicationExcerpt(page.body)!==ref.excerpt||Boolean(page.body)!==ref.hasBody)damaged();return page;
}

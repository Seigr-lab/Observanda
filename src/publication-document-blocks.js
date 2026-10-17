// Publication metadata uses the existing retained value/index nodes, owned by
// one capture or output attempt. No global block inventory grows with a site.
import {AsyncLocalStorage} from 'node:async_hooks';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {RecordValueTree} from './record-value-tree.js';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export const publicationDocumentHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const publicationDocumentFailure=()=>{throw new AppError('JOB_DAMAGED');};
export function validPublicationDocumentOwner(value){
 return !!value&&Object.keys(value).sort().join()==='attemptId,jobId,kind,websiteId,workspaceId'&&['source','output'].includes(value.kind)&&uuid(value.workspaceId)&&(value.websiteId===null||uuid(value.websiteId))&&uuid(value.jobId)&&(value.kind==='source'?value.attemptId===null:uuid(value.attemptId));
}
export function publicationDocumentPrefix(owner){
 if(!validPublicationDocumentOwner(owner))throw new AppError('INVALID');
 return owner.kind==='source'?'.observanda/release-inputs/'+owner.jobId:'.observanda/release-outputs/'+owner.jobId+'/'+owner.attemptId;
}
export function publicationDocumentBlockName(kind,hash){
 if(!['value','index'].includes(kind)||!publicationDocumentHash(hash))throw new AppError('INVALID');
 return 'pd-'+(kind==='value'?'v':'i')+'-'+hash+'.json';
}
export const isPublicationDocumentBlockName=name=>typeof name==='string'&&/^pd-[vi]-[a-f0-9]{64}\.json$/.test(name);
export function publicationDocumentBlockPath(owner,kind,hash){return publicationDocumentPrefix(owner)+'/'+publicationDocumentBlockName(kind,hash);}
export function isPublicationDocumentBlockPath(owner,file){
 const prefix=publicationDocumentPrefix(owner)+'/';return typeof file==='string'&&file.startsWith(prefix)&&isPublicationDocumentBlockName(file.slice(prefix.length));
}
// Copy plain JSON before the first await. Callers retain ownership of their
// values, and cannot alter an admitted node while its writer is awaiting I/O.
export function ownPublicationJSON(value,ancestors=new Set()){
 if(value===null||typeof value==='string'||typeof value==='boolean')return value;
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(!value||typeof value!=='object'||ancestors.has(value)||Object.getOwnPropertySymbols(value).length||!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new AppError('INVALID');
 ancestors.add(value);
 try{
  const result=Array.isArray(value)?[]:Object.create(null),keys=Object.keys(value);
  if(Array.isArray(value)&&(keys.length!==value.length||keys.some((key,index)=>key!==String(index))))throw new AppError('INVALID');
  for(const key of keys){const property=Object.getOwnPropertyDescriptor(value,key);if(!Object.hasOwn(property,'value'))throw new AppError('INVALID');Object.defineProperty(result,key,{value:ownPublicationJSON(property.value,ancestors),enumerable:true,writable:true,configurable:true});}
  return result;
 }finally{ancestors.delete(value);}
}
export class PublicationDocumentBlocks{
 constructor(workspace,owner,{write,signal,readOnly=false}={}){
  if(!validPublicationDocumentOwner(owner))throw new AppError('INVALID');
  this.workspace=workspace;this.owner=Object.freeze({...owner});this.prefix=publicationDocumentPrefix(owner);this.writer=write??((file,text)=>workspace.writeMetadata(file,text));this.signal=signal;this.readOnly=readOnly;this.signals=new AsyncLocalStorage();this.cache=new Map();this.cacheBytes=0;
 }
 tree(){return new RecordValueTree(this);}
 check(){this.signal?.throwIfAborted();this.signals.getStore()?.throwIfAborted();}
 withSignal(signal,operation){return signal?this.signals.run(signal,operation):operation();}
 // Reuse frequently visited small branches within one fixed byte budget.
 keep(key,text){
  if(this.cache.has(key))return;const bytes=Buffer.byteLength(text);
  while(this.cache.size>=1024||this.cacheBytes+bytes>1024*1024){const first=this.cache.keys().next().value;if(first===undefined)break;this.cacheBytes-=Buffer.byteLength(this.cache.get(first));this.cache.delete(first);}
  this.cache.set(key,text);this.cacheBytes+=bytes;
 }
 decode(text,hash){
  if(typeof text!=='string'||Buffer.byteLength(text)>65536||digest(text)!==hash)publicationDocumentFailure();
  let value;try{value=JSON.parse(text);}catch{publicationDocumentFailure();}
  if(serialize(value)!==text)publicationDocumentFailure();return value;
 }
 cached(name){
  const text=this.cache.get(name);if(text!==undefined){this.cache.delete(name);this.cache.set(name,text);}return text;
 }
 async read(kind,hash){
  this.check();const name=publicationDocumentBlockName(kind,hash),cached=this.cached(name),text=cached??await this.workspace.readMetadata(this.prefix+'/'+name,65536);this.check();
  const value=this.decode(text,hash);if(cached===undefined)this.keep(name,text);return value;
 }
 async put(kind,value){
  this.check();if(this.readOnly)throw new AppError('INVALID');
  const text=serialize(value);if(Buffer.byteLength(text)>65536)throw new AppError('LIMIT');
  const hash=digest(text),name=publicationDocumentBlockName(kind,hash),file=this.prefix+'/'+name;
  if(this.cached(name)!==undefined)return hash;
  const prior=await this.workspace.readMetadata(file,65536);this.check();
  if(prior!==null&&prior!==undefined){this.decode(prior,hash);if(prior!==text)publicationDocumentFailure();}
  else{await this.writer(file,text);this.check();}
  this.keep(name,text);return hash;
 }
}

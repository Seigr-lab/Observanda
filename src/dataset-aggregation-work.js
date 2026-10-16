// Immutable intermediate grouping state. Only the small checkpoint publishes
// a root; interrupted writes leave the preceding checkpoint usable. The job's
// lease fences every bounded batch, including the checkpoint itself.
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {digest,serialize} from './storage-format.js';
import {revisionText} from './web/revision-model.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
import {withWorkspaceMetadataBatch} from './metadata-batch.js';
import {RetainedJsonValue} from './retained-json-value.js';

const fail=()=>{throw new AppError('MATERIAL_MISSING');};
const natural=n=>Number.isSafeInteger(n)&&n>=0;
export const aggregationWorkFile=id=>{
 if(!researchId(id))throw new AppError('INVALID');
 return '.observanda/materials/aggregation-work/'+id+'.json';
};
export class AggregationWork{
 constructor(materials,command,{jobId,writePage,signal}){
  this.workspace=materials.workspace;this.sequences=materials.sequences;this.file=aggregationWorkFile(jobId);
  this.commandHash=digest(revisionText(command));this.signal=signal;
  this.write=writePage??(fn=>this.workspace.withLock(()=>withWorkspaceMetadataBatch(this.workspace,fn)));
  this.pending=new Map();this.bytes=0;this.edits=0;this.root=null;this.saved=null;this.cache=new Map();this.cacheBytes=0;
  this.values=new Map();this.valueBytes=0;
  this.largeValues=new RetainedJsonValue(this.sequences,this.write,{namespace:'aggregation-work-chunks',signal});
  this.tree=new RetainedTableIndex({read:(kind,id)=>this.read(kind,id),put:(kind,value)=>this.stage(kind,value)},{namespace:'aggregation-work-nodes',allowSparseBranches:true});
 }
 async open(total){
  if(!natural(total))fail();
  const raw=await this.workspace.readMetadata(this.file,1048576);
  if(raw===null)return this;
  let value;try{value=JSON.parse(raw);}catch{fail();}
  if(value?.commandHash!==this.commandHash)throw new AppError('MATERIAL_CHANGED');
  if(value.version!==3||!validTableRef(value.root)||!['input','median','members','rows'].includes(value.phase)||
   !natural(value.groups)||!natural(value.order)||value.groups>value.order||value.order>total||Boolean(value.groups)!==Boolean(value.order)||
   (value.phase!=='input'&&value.order!==total)||Boolean(value.order)!==Boolean(value.last)||Boolean(value.order)!==Boolean(value.root)||
   value.last&&(!natural(value.last.page)||!natural(value.last.row)))fail();
  this.root=value.root;this.saved=value;return this;
 }
 async read(kind,id){
  const pending=this.pending.get(kind+'/'+id);
  if(pending)return pending.value;
  const cached=this.cache.get(kind+'/'+id);if(cached)return cached.value;
  const value=await this.sequences.read(kind,id);if(value!==null)this.remember(kind+'/'+id,value);return value;
 }
 remember(key,value){
  if(this.cache.has(key))return;const bytes=Buffer.byteLength(serialize(value));
  if(bytes>1048576)return;
  while(this.cache.size>=128||this.cacheBytes+bytes>1048576){const first=this.cache.keys().next().value;this.cacheBytes-=this.cache.get(first).bytes;this.cache.delete(first);}
  this.cache.set(key,{value:structuredClone(value),bytes});this.cacheBytes+=bytes;
 }
 async flushObjects(){
  if(!this.pending.size)return;
  const batch=[...this.pending.values()];
  await this.write(async()=>{this.signal?.throwIfAborted();for(const {kind,value} of batch)await this.sequences.put(kind,value);});
  this.pending.clear();this.bytes=0;
 }
 async stage(kind,value){
  this.signal?.throwIfAborted();let raw=serialize(value);
  if(kind==='aggregation-work-values'&&Buffer.byteLength(raw)>262144){await this.flushObjects();value={format:2,value:await this.largeValues.put(value)};raw=serialize(value);}
  const id=digest(raw),bytes=Buffer.byteLength(raw),key=kind+'/'+id;
  if(this.pending.has(key))return id;
  if(this.pending.size&&(this.pending.size>=32||this.bytes+bytes>262144))await this.flushObjects();
  const stored=JSON.parse(raw);this.pending.set(key,{kind,value:stored});this.bytes+=bytes;this.remember(key,stored);return id;
 }
 async get(key){
  this.signal?.throwIfAborted();
  if(this.values.has(key))return structuredClone(this.values.get(key).value);
  const row=await this.tree.find({root:this.root},digest(key));if(!row)return undefined;
  let page=await this.read('aggregation-work-values',row.revision);
  if(page?.format===2)page=await this.largeValues.read(page.value);
  if(page?.format!==1||!Array.isArray(page.items)||!page.items.length||page.items.length>64||!page.items.every(item=>item&&typeof item.key==='string'&&Object.hasOwn(item,'value'))||new Set(page.items.map(item=>item.key)).size!==page.items.length)fail();
  const item=page.items.find(item=>item.key===key);if(!item)fail();return structuredClone(item.value);
 }
 async put(key,value){
  this.signal?.throwIfAborted();const bytes=Buffer.byteLength(serialize({key,value})),previous=this.values.get(key);
  if(previous){this.valueBytes-=previous.bytes;this.values.delete(key);}
  if(this.values.size&&(this.values.size>=64||this.valueBytes+bytes>262144))await this.flush();
  this.values.set(key,{value:structuredClone(value),bytes});this.valueBytes+=bytes;
  if(this.values.size===64||this.valueBytes>=262144)await this.flush();
 }
 async removeMany(keys){
  for(const key of keys){
   this.signal?.throwIfAborted();const pending=this.values.get(key);if(pending){this.valueBytes-=pending.bytes;this.values.delete(key);}
   this.root=await this.tree.remove(this.root,digest(key));
  }
  this.edits+=keys.length;if(this.edits>=64)await this.flush();
 }
 async flush(){
  if(this.values.size){
   const items=[...this.values].map(([key,item])=>({key,value:item.value})),revision=await this.stage('aggregation-work-values',{format:1,items});
   for(const {key} of items)this.root=await this.tree.change(this.root,digest(key),revision);
   this.values.clear();this.valueBytes=0;
  }
  await this.tree.flush(this.root);await this.flushObjects();this.edits=0;
 }
 async save(state){
  await this.flush();this.signal?.throwIfAborted();
  const value={version:3,commandHash:this.commandHash,root:this.root,...state};
  await this.write(async()=>{this.signal?.throwIfAborted();await this.workspace.writeMetadata(this.file,serialize(value));});
  this.saved=value;
 }
}

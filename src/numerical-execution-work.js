// One command-bound numerical ledger and authenticated work root. A reservation
// reaches durable storage before CPU work; its settled cursor and staged values
// publish together under the existing job lease/writer transaction.
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {revisionText} from './web/revision-model.js';
import {researchId} from './web/research-reference.js';
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {RetainedJsonValue} from './retained-json-value.js';
import {withWorkspaceMetadataBatch} from './metadata-batch.js';
import {DatasetResourceError} from './web/dataset-resource-policy.js';
import {NumericalExecutionBudget,createNumericalExecutionState,validateNumericalExecutionState,reserveNumericalExecution,settleNumericalExecution,recoverNumericalExecution} from './numerical-execution-budget.js';
const fail=()=>{throw new AppError('MATERIAL_MISSING');};
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export const numericalExecutionWorkFile=id=>{if(!researchId(id))throw new AppError('INVALID');return '.observanda/materials/numerical-work/'+id+'.json';};
export class NumericalExecutionWork{
 constructor(materials,command,{jobId,writePage,signal,check,validCursor,scratch}={}){
  this.materials=materials;this.workspace=materials.workspace;this.sequences=materials.sequences;this.identity=digest(revisionText(command));this.policy=command.spectrum.executionPolicy;this.signal=signal;this.check=check;this.validCursor=validCursor;this.scratch=scratch;this.file=scratch?null:numericalExecutionWorkFile(jobId);this.write=writePage??(operation=>this.workspace.withLock(()=>withWorkspaceMetadataBatch(this.workspace,operation)));this.active=false;this.pending=null;this.cache=new Map();this.cacheBytes=0;
  this.saved={version:1,kind:'spectrum',commandHash:this.identity,ledger:createNumericalExecutionState(this.identity,this.policy),cursor:null,root:null};this.exists=false;
  if(!scratch){this.tree=new RetainedTableIndex(this.sequences,{namespace:'numerical-work-nodes',allowSparseBranches:true});this.large=new RetainedJsonValue(this.sequences,operation=>operation(),{namespace:'numerical-work-chunks'});}
 }
 validate(value){
  if(!exact(value,['version','kind','commandHash','ledger','cursor','root'])||value.version!==1||value.kind!=='spectrum'||!validTableRef(value.root)||!this.validCursor(value.cursor))fail();
  if(value.commandHash!==this.identity)throw new AppError('MATERIAL_CHANGED');try{validateNumericalExecutionState(value.ledger,{identity:this.identity,policy:this.policy});}catch{fail();}return value;
 }
 async read(){const raw=await this.workspace.readMetadata(this.file,1048576);if(raw===null)return null;let value;try{value=JSON.parse(raw);}catch{fail();}return this.validate(value);}
 async open(){
  this.signal?.throwIfAborted();await this.check?.();if(this.file){const retained=await this.read();if(retained){this.saved=retained;this.exists=true;}}
  if(this.saved.ledger.reservation)await this.publish({...this.saved,ledger:recoverNumericalExecution(this.saved.ledger)});return this;
 }
 get cursor(){return structuredClone(this.saved.cursor);}
 get ledger(){return structuredClone(this.saved.ledger);}
 async value(key){
  if(typeof key!=='string'||!key||key.length>300)throw new AppError('INVALID');
  if(this.pending?.has(key))return structuredClone(this.pending.get(key));
  if(this.scratch)return this.scratch.get(key);
  const entry=await this.tree.find({root:this.saved.root},digest(key));if(!entry)return undefined;let page=this.cache.get(entry.revision)?.value;if(!page){page=await this.sequences.read('numerical-work-values',entry.revision);this.remember(entry.revision,page);}
  if(exact(page,['version','value'])&&page.version===2)page=await this.large.read(page.value);
  if(!exact(page,['version','items'])||page.version!==1||!Array.isArray(page.items)||!page.items.length||page.items.length>32||page.items.some(item=>!exact(item,['key','value'])||typeof item.key!=='string')||new Set(page.items.map(item=>item.key)).size!==page.items.length)fail();const item=page.items.find(item=>item.key===key);if(!item)fail();return structuredClone(item.value);
 }
 remember(id,value){if(value===null||this.cache.has(id))return;const bytes=Buffer.byteLength(serialize(value));if(bytes>1048576)return;while(this.cache.size>=32||this.cacheBytes+bytes>1048576){const first=this.cache.keys().next().value;this.cacheBytes-=this.cache.get(first).bytes;this.cache.delete(first);}this.cache.set(id,{value,bytes});this.cacheBytes+=bytes;}
 async get(key){this.signal?.throwIfAborted();return this.value(key);}
 async getMany(keys){this.signal?.throwIfAborted();if(!Array.isArray(keys)||keys.length>32||new Set(keys).size!==keys.length||keys.some(key=>typeof key!=='string'||!key||key.length>300))throw new AppError('INVALID');if(this.scratch){const missing=keys.filter(key=>!this.pending?.has(key)),stored=missing.length?await this.scratch.getMany(missing):new Map();this.signal?.throwIfAborted();if(!(stored instanceof Map))fail();const result=new Map();for(const key of keys)if(this.pending?.has(key))result.set(key,structuredClone(this.pending.get(key)));else if(stored.has(key))result.set(key,stored.get(key));return result;}const result=new Map();for(const key of keys){const value=await this.get(key);if(value!==undefined)result.set(key,value);}return result;}
 async put(key,value){
  this.signal?.throwIfAborted();if(!this.active||typeof key!=='string'||!key||key.length>300||value===undefined||!this.pending.has(key)&&this.pending.size>=32)throw new AppError('INVALID');this.pending.set(key,structuredClone(value));
 }
 async putMany(entries){if(!Array.isArray(entries)||entries.length>32||new Set(entries.map(entry=>entry[0])).size!==entries.length)throw new AppError('INVALID');for(const [key,value]of entries)await this.put(key,value);}
 async store(root,entries){
  const changes=[];let items=[],bytes=0;
  const flush=async()=>{if(!items.length)return;let value={version:1,items};if(Buffer.byteLength(serialize(value))>262144)value={version:2,value:await this.large.put(value)};const revision=await this.sequences.put('numerical-work-values',value);for(const item of items)changes.push({id:digest(item.key),revision});items=[];bytes=0;};
  for(const [key,value]of entries){const item={key,value},size=Buffer.byteLength(serialize(item));if(items.length&&(items.length===32||bytes+size>262144))await flush();items.push(item);bytes+=size;}await flush();changes.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);root=await this.tree.changeMany(root,changes);await this.tree.flush(root);return root;
 }
 async publish(value,entries=[]){
  this.validate(value);
  if(this.scratch){for(let offset=0;offset<entries.length;offset+=32)await this.scratch.putMany(entries.slice(offset,offset+32));this.saved=structuredClone(value);return;}
  const expected=revisionText(this.saved),existed=this.exists;
  await this.write(async()=>{const current=await this.read();if(existed?current===null||revisionText(current)!==expected:current!==null)throw new AppError('MATERIAL_CHANGED');const root=await this.store(value.root,entries),next={...value,root};await this.workspace.writeMetadata(this.file,serialize(next));value=next;});this.saved=structuredClone(value);this.exists=true;
 }
 async slice(before,operation){
  this.signal?.throwIfAborted();if(this.active||typeof operation!=='function'||revisionText(before)!==revisionText(this.saved.cursor))throw new AppError('MATERIAL_CHANGED');await this.check?.();
  const ledger=this.saved.ledger,operations=Math.min(this.policy.slice.maxOperations,this.policy.total.maxOperations-ledger.consumed.operations),activeMilliseconds=Math.min(this.policy.slice.maxActiveMilliseconds,Math.floor(this.policy.total.maxActiveMilliseconds-ledger.consumed.activeMilliseconds));if(operations<1||activeMilliseconds<1)throw new DatasetResourceError();
  await this.publish({...this.saved,ledger:reserveNumericalExecution(ledger,{id:randomUUID(),operations,activeMilliseconds})});const reserved=this.saved,budget=new NumericalExecutionBudget(reserved.ledger,{identity:this.identity,policy:this.policy,signal:this.signal,check:this.check});this.pending=new Map();this.active=true;
  try{const cursor=await operation({budget,work:this});if(!this.validCursor(cursor))fail();await budget.check();const settled=settleNumericalExecution(reserved.ledger,budget.finish()),entries=[...this.pending];this.active=false;this.pending=null;await this.publish({...reserved,ledger:settled,cursor},entries);return this.cursor;}
  catch(error){this.active=false;this.pending=null;const usage=budget.finish();try{if(this.saved.ledger.reservation?.id===usage.id)await this.publish({...reserved,ledger:settleNumericalExecution(reserved.ledger,usage)});}catch{/* A lost lease leaves the persisted reservation for conservative recovery. */}throw error;}
 }
}

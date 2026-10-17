// Immutable configuration nodes use the catalogue key and authenticated state
// slots. References bind their owner; identical nodes may share physical bytes.
import {RecordValueTree} from './record-value-tree.js';
import {digest,serialize} from './storage-format.js';
import {writeCatalogueRows} from './catalogue-writes.js';
import {revisionId} from './web/revision-model.js';
import {AppError} from './errors.js';
import {retainRecordOwnerResource} from './record-owner-resources.js';
export const CONFIGURATION_BLOCK_PREFIX='configuration-block:';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export const configurationBlockSlot=(kind,revision)=>{if(!['value','index'].includes(kind)||!revisionId(revision))fail();return CONFIGURATION_BLOCK_PREFIX+kind+':'+revision;};
export const configurationBlockResource=(kind,revision)=>({kind:'state',key:configurationBlockSlot(kind,revision),revision});
function dependencies(kind,node){
 const result=[],add=(kind,hash)=>{if(revisionId(hash))result.push(configurationBlockResource(kind,hash));};
 if(kind==='index'){for(const child of node.children??[])add('index',child.hash);for(const row of node.entries??[])add('value',row.revision);}
 else if(['item','property'].includes(node.type))add('value',node.value);
 else if(node.root)add('index',node.root.hash);
 else if(node.type==='inline'&&node.value?.configurationRow===1)add('value',node.value.source);
 return result;
}
export class ConfigurationValueBlocks{
 constructor(store,{readOnly=false,temporary=false,write=null,signal}={}){
  if(write!==null&&typeof write!=='function')throw new AppError('INVALID');
  this.store=store;this.readOnly=readOnly;this.temporary=temporary;this.write=write;this.signal=signal;this.pending=new Map();this.pendingBytes=0;this.cache=new Map();this.cacheBytes=0;
 }
 slot(kind,revision){return configurationBlockSlot(kind,revision);}
 decode(slot,payload,revision){const value=this.store.decode('state',slot,payload),text=serialize(value);if(Buffer.byteLength(text)>65536||digest(text)!==revision)fail();return value;}
 keep(slot,value,bytes){
  if(this.cache.has(slot))return;
  if(!this.temporary)while(this.cache.size>=256||this.cacheBytes+bytes>4*1024*1024){const first=this.cache.keys().next().value;if(first===undefined)break;this.cacheBytes-=this.cache.get(first).bytes;this.cache.delete(first);}
  this.cache.set(slot,{value:structuredClone(value),bytes});this.cacheBytes+=bytes;
 }
 async put(kind,value){
  this.signal?.throwIfAborted();const text=serialize(value),bytes=Buffer.byteLength(text);if(bytes>65536)throw new AppError('INVALID');const revision=digest(text),slot=this.slot(kind,revision);
  if(this.readOnly){this.keep(slot,value,bytes);return revision;}
  if(this.pending.has(slot)||this.cache.has(slot))return revision;
  this.pending.set(slot,{kind,value:structuredClone(value),revision,bytes});this.pendingBytes+=bytes;
  if(this.pending.size>=32||this.pendingBytes>=256*1024)await this.flush();return revision;
 }
 async flush(){
  this.signal?.throwIfAborted();if(this.readOnly||!this.pending.size)return;const batch=[...this.pending];
  const persist=async store=>{
   const found=new Map((await store.db.all('SELECT slot,payload FROM state WHERE slot=ANY($1::text[])',batch.map(([slot])=>slot))).map(row=>[row.slot,row.payload])),rows=[];
   for(const [slot,{kind,value,revision}] of batch){
    this.signal?.throwIfAborted();if(found.has(slot)){const prior=store.decode('state',slot,found.get(slot));if(digest(serialize(prior))!==revision)fail();}
    await retainRecordOwnerResource(store,{kind:'state',key:slot,revision},{present:found.has(slot),dependencies:dependencies(kind,value)});
    if(!found.has(slot))rows.push([slot,store.encode('state',slot,value)]);
   }
   await writeCatalogueRows(store.db,'state',rows,{create:true});
  };
  if(this.write)await this.write(persist);else await persist(this.store);
  for(const [slot,{value,bytes}] of batch)this.keep(slot,value,bytes);this.pending.clear();this.pendingBytes=0;
 }
 async read(kind,revision){
  this.signal?.throwIfAborted();const slot=this.slot(kind,revision),cached=this.pending.get(slot)??this.cache.get(slot);if(cached)return structuredClone(cached.value);
  const load=()=>this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot),row=this.store.readCache?await this.store.readCache.row(slot,load):await load();
  const value=this.decode(slot,row?.payload,revision);this.keep(slot,value,Buffer.byteLength(serialize(value)));return value;
 }
 async prefetch(kind,revisions){if(!Array.isArray(revisions)||revisions.length>32)throw new AppError('INVALID');for(const revision of revisions)await this.read(kind,revision);}
 tree(){return new RecordValueTree(this);}
}

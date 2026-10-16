import {withProjectRecordBlockOwner} from './project-retired-records.js';
// Record blocks keep notebook-key isolation. The outer catalogue envelope
// supports normal archive transport; its ciphertext contains a separately
// authenticated notebook envelope. Rekeying must replace both envelopes.
import {AppError} from './errors.js';
import {seal,unseal} from './encryption.js';
import {digest,serialize} from './storage-format.js';
import {writeCatalogueRows} from './catalogue-writes.js';
import {RecordValueTree} from './record-value-tree.js';
import {operationStage,operationAdvance} from './operation-progress.js';
import {validAttemptIndex} from './record-attempt-index.js';
import {validMethodIndex} from './record-method-index.js';

const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export const RECORD_BLOCK_PREFIX='record-block:';
export const blockedRecord=value=>value?.format==='observanda-record-blocks';
export function validBlockedRecord(value){
 if(!blockedRecord(value)||!uuid(value.id)||!uuid(value.notebookId)||!hash(value.root))return false;
 const keys=Object.keys(value).sort().join();
 if(value.version===1)return keys==='format,id,notebookId,root,version';
 if(value.version===2)return keys==='attemptIndex,format,id,notebookId,root,version'&&validAttemptIndex(value.attemptIndex);
 return value.version===3&&keys===(Object.hasOwn(value,'attemptIndex')?'attemptIndex,':'')+'format,id,methodIndex,notebookId,root,version'&&validMethodIndex(value.methodIndex)&&(!Object.hasOwn(value,'attemptIndex')||validAttemptIndex(value.attemptIndex));
}
export class RecordBlockStore{
 constructor(store,scopeId,generation,key){
  if(!uuid(scopeId)||!Number.isSafeInteger(generation)||generation<1||!Buffer.isBuffer(key)||key.length!==32)throw new AppError('INVALID');
  this.store=store;this.scopeId=scopeId;this.generation=generation;this.key=key;this.pending=new Map();this.pendingBytes=0;this.cache=new Map();this.cacheBytes=0;
 }
 slot(kind,version){if(!['value','index'].includes(kind)||!hash(version))fail();return RECORD_BLOCK_PREFIX+this.scopeId+':'+this.generation+':'+kind+':'+version;}
 aad(slot){return this.store.aad('record-block',slot);}
 encode(slot,node){return {format:1,content:seal(Buffer.from(serialize(node)),this.key,this.aad(slot)).toString('base64')};}
 decode(slot,value,version){
  if(!value||Object.keys(value).sort().join()!=='content,format'||value.format!==1||typeof value.content!=='string'||value.content.length>128*1024)fail();
  const bytes=Buffer.from(value.content,'base64');if(bytes.toString('base64')!==value.content)fail();
  const decoded=unseal(bytes,this.key,this.aad(slot));if(decoded.length>65536||digest(decoded)!==version)fail();
  try{const node=JSON.parse(decoded.toString('utf8'));if(serialize(node)!==decoded.toString('utf8'))fail();return node;}catch(error){if(error instanceof AppError)throw error;fail();}
 }
 keep(slot,node,bytes){
  if(this.cache.has(slot))return;while(this.cache.size>=64||this.cacheBytes+bytes>1024*1024){const first=this.cache.keys().next().value;if(first===undefined)return;this.cacheBytes-=this.cache.get(first).bytes;this.cache.delete(first);}
  this.cache.set(slot,{node:structuredClone(node),bytes});this.cacheBytes+=bytes;
 }
 async put(kind,node){
  if(this.retiredSource)throw new AppError('PROJECT_RELOCATED',[{projectId:this.store.workspace.projectId}]);
  const encoded=serialize(node),bytes=Buffer.byteLength(encoded);if(bytes>65536)throw new AppError('INVALID');
  const version=digest(encoded),slot=this.slot(kind,version);
  if(this.pending.has(slot)||this.cache.has(slot))return version;
  this.pending.set(slot,{node:structuredClone(node),version,bytes});this.pendingBytes+=bytes;
  if(this.pending.size>=32||this.pendingBytes>=256*1024)await this.flush();return version;
 }
 async flush(){
  if(!this.pending.size)return;await withProjectRecordBlockOwner(this.store,this.scopeId,this.generation,async()=>{},{mutable:true});const batch=[...this.pending],found=new Map((await this.store.db.all('SELECT slot,payload FROM state WHERE slot=ANY($1::text[])',batch.map(([slot])=>slot))).map(row=>[row.slot,row.payload])),rows=[];
  for(const [slot,{node,version}] of batch){
   if(found.has(slot))this.decode(slot,this.store.decode('state',slot,found.get(slot)),version);
   else rows.push([slot,this.store.encode('state',slot,this.encode(slot,node))]);
  }
  await writeCatalogueRows(this.store.db,'state',rows,{create:true});
  operationAdvance(batch.length,'write-record-blocks');
  for(const [slot,{node,bytes}] of batch)this.keep(slot,node,bytes);this.pending.clear();this.pendingBytes=0;
 }
 async read(kind,version){
  const slot=this.slot(kind,version),pending=this.pending.get(slot),cached=this.cache.get(slot);
  if(pending||cached)return structuredClone((pending??cached).node);
  // Reuse ciphertext only inside the reader's fixed database snapshot. Every
  // block owner still authenticates with its own notebook key and identity.
  const load=()=>this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot);
  const row=this.store.readCache?await this.store.readCache.row(slot,load):await load(),node=this.decode(slot,this.store.decode('state',slot,row?.payload),version);
  this.keep(slot,node,Buffer.byteLength(serialize(node)));return node;
 }
 async prefetch(kind,versions){
  // A tree leaf has at most 32 children. Transport only small ciphertexts;
  // larger values keep the existing single-object read and authentication.
  if(!Array.isArray(versions)||versions.length>32)throw new AppError('INVALID');
  const wanted=new Map(versions.map(version=>[this.slot(kind,version),version]));
  const missing=[...wanted.keys()].filter(slot=>!this.pending.has(slot)&&!this.cache.has(slot));if(!missing.length)return;
  const shared=this.store.readCache;let rows;
  if(shared){
   await shared.prefetch(this.store.db,missing,{maxPayloadBytes:16384});rows=[];
   for(const slot of missing){const row=await shared.row(slot,async()=>null);if(row)rows.push({slot,...row});}
  }else rows=await this.store.db.all('SELECT slot,payload FROM state WHERE slot=ANY($1::text[]) AND octet_length(payload)<=16384',missing);
  for(const row of rows){
   if(!wanted.has(row.slot))fail();
   const node=this.decode(row.slot,this.store.decode('state',row.slot,row.payload),wanted.get(row.slot));
   this.keep(row.slot,node,Buffer.byteLength(serialize(node)));
  }
 }
 async retain(record){return operationStage('write-record-blocks',{unit:'blocks'},async()=>{const root=await new RecordValueTree(this).retain(record);await this.flush();return {format:'observanda-record-blocks',version:1,id:record.id,notebookId:record.notebookId,root};});}
 tree(){return new RecordValueTree(this);}
}
export async function rekeyRecordBlock(from,to,slot,value){
 const match=/^record-block:([a-f0-9-]{36}):([1-9][0-9]*):(value|index):([a-f0-9]{64})$/.exec(slot);if(!match)fail();
 const [,scopeId,generationText,,version]=match,generation=Number(generationText),sourceKey=await from.scopeKey(scopeId,generation);let targetKey;
 try{targetKey=await to.scopeKey(scopeId,generation);const source=new RecordBlockStore(from,scopeId,generation,sourceKey),target=new RecordBlockStore(to,scopeId,generation,targetKey);return target.encode(slot,source.decode(slot,value,version));}
 finally{sourceKey.fill(0);targetKey?.fill(0);}
}

export async function withRecordBlockStore(store,scopeId,generation,consume){
 return withProjectRecordBlockOwner(store,scopeId,generation,async owner=>{
  const key=await owner.scopeKey(scopeId,generation);
  try{const blocks=new RecordBlockStore(owner,scopeId,generation,key);blocks.retiredSource=owner!==store;return await consume(blocks,owner);}finally{key.fill(0);}
 });
}

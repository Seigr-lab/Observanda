// Raw encodings may be reused only inside one fixed catalogue audit. This is
// not a record-validation receipt: metadata and historical transformations
// retain their own admission and identity checks.
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
const audits=new AsyncLocalStorage(),originals=new WeakMap();
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const namespace=store=>store.aad('record-encoding','');
function sameOwner(audit,store){
 const workspace=store.workspace;
 return audit?.active&&store.db===audit.db&&store.readCache===audit.cache&&workspace===audit.workspace&&workspace.root===audit.root&&workspace.projectId===audit.projectId&&workspace.labBookId===audit.labBookId&&workspace.vault===audit.vault&&workspace.vault?.key===audit.key&&namespace(store)===audit.namespace;
}
// Called only by catalogue verification after it checks transaction isolation.
// The scratch owner stores encrypted receipts and bounds memory independently
// of the number of records or retained snapshots in the audit.
export async function withRecordEncodingAudit(store,receipts,operation){
 const workspace=store.workspace,audit={active:true,db:store.db,cache:store.readCache,workspace,root:workspace.root,projectId:workspace.projectId,labBookId:workspace.labBookId,vault:workspace.vault,key:workspace.vault?.key,namespace:namespace(store),receipts};
 try{return await audits.run(audit,operation);}
 finally{audit.active=false;audit.receipts=null;audit.key=null;}
}
// Admission is private to withRecordDocument's authenticated stored envelope.
// Derived, mutable and decomposed legacy documents never acquire provenance.
export async function withStoredRecordEncoding(document,store,id,revision,row,manifest,operation){
 const audit=audits.getStore();
 if(document.mutable||manifest.format!=='observanda-record-blocks'||!sameOwner(audit,store))return operation();
 const original={audit,store,root:document.root,tree:document.tree,blocks:document.blocks,json:document.tree.json,storage:document.tree.storage,scopeId:row.scope_id,generation:row.generation,revision};
 if(original.root!==manifest.root)fail();
 original.receipt='record-encoding:'+digest(serialize(['raw-record-json-v1',audit.namespace,manifest.version,id,revision,row.scope_id,row.generation,original.root]));
 originals.set(document,original);
 try{return await operation();}finally{originals.delete(document);}
}
function admitted(document,original,audit){
 return !!original&&!!audit&&original.audit===audit&&sameOwner(audit,original.store)&&!document.mutable&&document.root===original.root&&document.tree===original.tree&&document.blocks===original.blocks&&document.tree.json===original.json&&document.tree.storage===original.storage&&document.blocks.scopeId===original.scopeId&&document.blocks.generation===original.generation;
}
function validReceipt(value,revision){
 return value&&Object.keys(value).sort().join()==='bytes,contentRevision,memberBytes,revision,version'&&value.version===1&&value.revision===revision&&hash(value.contentRevision)&&natural(value.bytes)&&value.bytes>0&&natural(value.memberBytes)&&value.memberBytes>=value.bytes;
}
async function measure(document,{signal}={}){
 signal?.throwIfAborted();const {tree,root}=document,storage=createHash('sha256'),canonical=createHash('sha256');let bytes=0,lines=1;
 for await(const text of tree.json(root,{signal})){
  signal?.throwIfAborted();storage.update(text);bytes+=Buffer.byteLength(text);for(const c of text)if(c==='\n')lines++;
  if(!natural(bytes)||!natural(lines))fail();
 }
 storage.update('\n');
 for await(const text of tree.json(root,{canonical:true,signal})){signal?.throwIfAborted();canonical.update(text);}
 signal?.throwIfAborted();const memberBytes=bytes+4*lines;if(!natural(bytes+1)||!natural(memberBytes))fail();
 return {revision:storage.digest('hex'),contentRevision:canonical.digest('hex'),bytes:bytes+1,memberBytes};
}
export async function recordDocumentEncoding(document,{signal}={}){
 signal?.throwIfAborted();const audit=audits.getStore(),original=originals.get(document);
 if(!admitted(document,original,audit))return measure(document,{signal});
 const {receipts}=audit,cached=await receipts.get(original.receipt);signal?.throwIfAborted();
 if(!admitted(document,original,audit))return measure(document,{signal});
 if(cached!==undefined){if(!validReceipt(cached,original.revision))fail();const {version,...encoding}=cached;void version;return encoding;}
 const encoding=await measure(document,{signal});if(encoding.revision!==original.revision)fail();
 signal?.throwIfAborted();if(!admitted(document,original,audit))return encoding;
 try{
  await receipts.put(original.receipt,{version:1,...encoding});signal?.throwIfAborted();
  if(!admitted(document,original,audit))await receipts.remove(original.receipt);
 }catch(error){await receipts.remove(original.receipt).catch(()=>{});throw error;}
 return encoding;
}

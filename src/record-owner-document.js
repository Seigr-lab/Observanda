// Copy only reachable selected-document nodes. Each flush owns a short target
// writer transaction; no source scope scan or sibling original is transported.
import {RecordBlockStore} from './record-block-store.js';
import {RecordDocument} from './record-document.js';
import {copyRecordValue} from './record-document-copy.js';
import {RecordAttemptIndex} from './record-attempt-index.js';
import {RecordMethodIndex} from './record-method-index.js';
import {RecordResultIndex} from './record-result-index.js';
import {AppError} from './errors.js';
class TransferBlocks extends RecordBlockStore{
 constructor(workspace,scopeId,generation,key,write,signal){
  const owner={workspace,aad:(table,id)=>'Observanda/research-catalogue/v1/'+workspace.vault.id+'/'+table+'/'+id};
  super(owner,scopeId,generation,key);this.workspace=workspace;this.write=write;this.signal=signal;
 }
 async flush(){
  this.signal?.throwIfAborted();if(!this.pending.size)return;const batch=[...this.pending];
  await this.write(async store=>{
   const blocks=new RecordBlockStore(store,this.scopeId,this.generation,this.key);
   for(const [slot,{node,version}] of batch){this.signal?.throwIfAborted();const kind=slot.split(':').at(-2);if(await blocks.put(kind,node)!==version)throw new AppError('CATALOGUE_DAMAGED');}
   await blocks.flush();
  });
  for(const [slot,{node,bytes}] of batch)this.keep(slot,node,bytes);this.pending.clear();this.pendingBytes=0;
 }
 async read(kind,version){
  this.signal?.throwIfAborted();const slot=this.slot(kind,version),saved=this.pending.get(slot)??this.cache.get(slot);if(saved)return structuredClone(saved.node);
  const node=await this.workspace.catalogue(store=>new RecordBlockStore(store,this.scopeId,this.generation,this.key).read(kind,version));this.keep(slot,node,Buffer.byteLength(JSON.stringify(node)));return node;
 }
 async prefetch(kind,versions){for(const version of versions)await this.read(kind,version);}
}
export async function copyRecordOwnerDocument(source,target,{write,signal,notebookId=source.blocks.scopeId,generation=source.blocks.generation,transform}={}){
 if(typeof write!=='function')throw new AppError('INVALID');signal?.throwIfAborted();
 const key=await write(store=>store.scopeKey(notebookId,generation,{create:true}));
 try{
  const blocks=new TransferBlocks(target,notebookId,generation,key,write,signal),empty=new RecordDocument(blocks,null,{mutable:true});
  let document=new RecordDocument(blocks,await copyRecordValue(source,empty,source.root,{signal}),{mutable:true});
  if(transform)document=await transform(document);
  const encoding=await document.encoding({signal}),attemptIndex=await RecordAttemptIndex.retain(document),methodIndex=await RecordMethodIndex.retain(document,{signal}),resultIndex=await RecordResultIndex.retain(document,{signal});await blocks.flush();
  return {notebookId,generation,root:document.root,encoding,attemptIndex,methodIndex,resultIndex};
 }finally{key.fill(0);}
}
export async function withRecordOwnerDocument(store,value,operation,{write=null,signal}={}){
 if(write!==null&&typeof write!=='function')throw new AppError('INVALID');signal?.throwIfAborted();
 const key=await store.scopeKey(value.notebookId,value.generation);
 try{const blocks=write?new TransferBlocks(store.workspace,value.notebookId,value.generation,key,write,signal):new RecordBlockStore(store,value.notebookId,value.generation,key);return await operation(new RecordDocument(blocks,value.root,{mutable:true,attemptIndex:value.attemptIndex??null,methodIndex:value.methodIndex??null,resultIndex:value.resultIndex??null}));}
 finally{key.fill(0);}
}

export async function copyRecordOwnerValue(source,target,{write,signal,notebookId=source.blocks.scopeId,generation=source.blocks.generation}={}){
 if(typeof write!=='function')throw new AppError('INVALID');signal?.throwIfAborted();const key=await write(store=>store.scopeKey(notebookId,generation,{create:true}));
 try{const blocks=new TransferBlocks(target,notebookId,generation,key,write,signal),empty=new RecordDocument(blocks,null,{mutable:true}),root=await copyRecordValue(source,empty,source.root,{signal});await blocks.flush();return {notebookId,generation,root};}
 finally{key.fill(0);}
}
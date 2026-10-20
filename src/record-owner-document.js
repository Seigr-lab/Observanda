// Copy only reachable selected-document nodes. Each flush owns a short target
// writer transaction; no source scope scan or sibling original is transported.
import {RecordBlockStore} from './record-block-store.js';
import {RecordDocument} from './record-document.js';
import {copyRecordValue} from './record-document-copy.js';
import {RecordAttemptIndex} from './record-attempt-index.js';
import {RecordMethodIndex} from './record-method-index.js';
import {RecordResultIndex} from './record-result-index.js';
import {AppError} from './errors.js';
import {requireNestedAttemptCollections,catalogueFormat,catalogueRequiresNestedAttemptCollections} from './catalogue-format.js';
class TransferBlocks extends RecordBlockStore{
 constructor(workspace,scopeId,generation,key,write,signal,reader){
  const owner={workspace,aad:(table,id)=>'Observanda/research-catalogue/v1/'+workspace.vault.id+'/'+table+'/'+id};
  super(owner,scopeId,generation,key);this.workspace=workspace;this.write=write;this.signal=signal;this.reader=new RecordBlockStore(reader,scopeId,generation,key);
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
  const node=await this.reader.read(kind,version);this.keep(slot,node,Buffer.byteLength(JSON.stringify(node)));return node;
 }
 async prefetch(kind,versions){this.signal?.throwIfAborted();await this.reader.prefetch(kind,versions.filter(version=>!this.pending.has(this.slot(kind,version))&&!this.cache.has(this.slot(kind,version))))}
}
// Immutable blocks committed by short writer batches become visible to the
// next read. Reuse this connection without holding a writer or a stale snapshot.
async function withTransferReader(target,operation){
 const db=await target.openCatalogue();
 try{await db.run('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');const result=await operation(target.catalogueStore(db));await db.run('COMMIT');return result;}
 finally{await db.close();}
}
export async function copyRecordOwnerDocument(source,target,{write,signal,notebookId=source.blocks.scopeId,generation=source.blocks.generation,transform}={}){
 if(typeof write!=='function')throw new AppError('INVALID');signal?.throwIfAborted();
 const key=await write(store=>store.scopeKey(notebookId,generation,{create:true}));
 try{return await withTransferReader(target,async reader=>{
  const blocks=new TransferBlocks(target,notebookId,generation,key,write,signal,reader),empty=new RecordDocument(blocks,null,{mutable:true});
  let document=new RecordDocument(blocks,await copyRecordValue(source,empty,source.root,{signal}),{mutable:true});
  if(transform)document=await transform(document);
  if(await document.reference(['attempt'],{signal}))await write(store=>requireNestedAttemptCollections(store.db));
  const encoding=await document.encoding({signal}),attemptIndex=await RecordAttemptIndex.retain(document),methodIndex=await RecordMethodIndex.retain(document,{signal}),resultIndex=await RecordResultIndex.retain(document,{signal});await blocks.flush();
  return {notebookId,generation,root:document.root,encoding,attemptIndex,methodIndex,resultIndex};
 });}finally{key.fill(0);}
}
export async function withRecordOwnerDocument(store,value,operation,{write=null,signal}={}){
 if(write!==null&&typeof write!=='function')throw new AppError('INVALID');signal?.throwIfAborted();
 if(value.attemptIndex?.version>=3&&!catalogueRequiresNestedAttemptCollections(await catalogueFormat(store.db)))throw new AppError('CATALOGUE_DAMAGED');
 const key=await store.scopeKey(value.notebookId,value.generation);
 try{const blocks=write?new TransferBlocks(store.workspace,value.notebookId,value.generation,key,write,signal,store):new RecordBlockStore(store,value.notebookId,value.generation,key);return await operation(new RecordDocument(blocks,value.root,{mutable:true,attemptIndex:value.attemptIndex??null,methodIndex:value.methodIndex??null,resultIndex:value.resultIndex??null}));}
 finally{key.fill(0);}
}

export async function copyRecordOwnerValue(source,target,{write,signal,notebookId=source.blocks.scopeId,generation=source.blocks.generation}={}){
 if(typeof write!=='function')throw new AppError('INVALID');signal?.throwIfAborted();const key=await write(store=>store.scopeKey(notebookId,generation,{create:true}));
 try{return await withTransferReader(target,async reader=>{
  const blocks=new TransferBlocks(target,notebookId,generation,key,write,signal,reader),copied=new Set();
  // Checkpoints bind the exact immutable tree, including its split boundaries.
  // Rebuilding equal JSON would change appended/keyed container roots. Copy
  // authenticated reachable blocks child-first, under the destination key.
  const remember=slot=>{if(copied.size>=64)copied.delete(copied.values().next().value);copied.add(slot);};
  const value=async revision=>{
   signal?.throwIfAborted();const slot='value:'+revision;if(copied.has(slot))return;
   const node=await source.tree.node(revision);
   if(['item','property'].includes(node.type))await value(node.value);
   else if(node.root)await index(node.root);
   if(await blocks.put('value',node)!==revision)throw new AppError('CATALOGUE_DAMAGED');remember(slot);
  };
  const index=async ref=>{
   signal?.throwIfAborted();const slot='index:'+ref.hash;if(copied.has(slot))return;
   const node=await source.tree.index.node(ref);
   for(const child of node.children??[])await index(child);
   for(const entry of node.entries??[])await value(entry.revision);
   if(await blocks.put('index',node)!==ref.hash)throw new AppError('CATALOGUE_DAMAGED');remember(slot);
  };
  await value(source.root);await blocks.flush();return {notebookId,generation,root:source.root};
 });}
 finally{key.fill(0);}
}
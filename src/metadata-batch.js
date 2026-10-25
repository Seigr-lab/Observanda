// Coalesce shared metadata-index branches inside one writer transaction.
// Flush at 256 index edits or 4 MiB of serialized branches. At most 32
// encrypted object rows (256 KiB) are pending independently of those branches.
import {AsyncLocalStorage} from 'node:async_hooks';
import {ObjectIndex} from './object-index.js';
import {AppError} from './errors.js';
import {hasCatalogue} from './postgres.js';
import {writeCatalogueRows} from './catalogue-writes.js';
import {CatalogueReadCache} from './catalogue-read-cache.js';
import {withCatalogueCacheBoundary} from './catalogue-context.js';
const batches=new AsyncLocalStorage();
// Call inside the workspace's writer lock. Legacy file workspaces keep their
// existing write path; only PostgreSQL has shared index branches to coalesce.
export async function withWorkspaceMetadataBatch(workspace,operation,{prefetchIds=[],signal}={}){
 if(!await hasCatalogue(workspace.root))return operation();
 return workspace.catalogue(store=>withMetadataBatch(store,operation,{prefetchIds,signal}));
}
export function metadataBatchIndex(store){
 const batch=batches.getStore();
 return batch?.store.db===store.db&&batch.store.workspace.root===store.workspace.root?batch:null;
}
class MetadataBatchIndex extends ObjectIndex{
 encryptionKey(key){return this.objectReads.encryptionKey(key);}
 constructor(store){super(store,{cacheReads:true,cacheSize:16384});this.current=null;this.edits=0;this.objects=new Map();this.newObjects=new Set();this.objectBytes=0;this.objectReads=new CatalogueReadCache();}
 async objectRow(id){
  if(this.objects.has(id)){const payload=this.objects.get(id);return payload===null?undefined:{payload};}
  return this.objectReads.row(id,()=>this.store.db.get('SELECT payload FROM objects WHERE id=$1',id));
 }
 async stageObject(id,payload,{create=false}={}){
  // A creation must reach a plain INSERT before a later deletion can erase it.
  // This preserves detection of a stray row absent from the authenticated tree.
  if(payload===null&&this.newObjects.has(id)||create&&this.objects.get(id)===null)await this.flushObjects();
  this.objectReads.replace(id,payload);
  const size=payload?.length??0,previous=this.objects.get(id)?.length??0;
  if(this.objects.size>=32||this.objectBytes-previous+size>256*1024)await this.flushObjects();
  if(size>256*1024){await writeCatalogueRows(this.store.db,'objects',[[id,payload]],{create});return;}
  if(create)this.newObjects.add(id);
  this.objectBytes-=this.objects.get(id)?.length??0;this.objects.set(id,payload);this.objectBytes+=size;
 }
 async flushObjects(){if(this.objects.size){
  await writeCatalogueRows(this.store.db,'objects',[...this.objects].filter(([id])=>this.newObjects.has(id)),{create:true});
  await writeCatalogueRows(this.store.db,'objects',[...this.objects].filter(([id])=>!this.newObjects.has(id)));
  this.objects.clear();this.newObjects.clear();this.objectBytes=0;
 }}
 async head(){return this.current??=await super.head();}
 async update(head,id,revision){
  if(head!==this.current||typeof id!=='string'||!id||revision!==null&&!/^[a-f0-9]{64}$/.test(revision))throw new AppError('INVALID');
  if(head.legacy){
   await super.update(head,id,revision);this.current=await super.head();return;
  }
  this.current={formatVersion:2,root:await this.change(head.root,id,revision)};
  if(++this.edits===256||this.pendingBytes>=4*1024*1024)await this.save();
 }
 async save(){await this.flushObjects();if(this.edits){await this.persist(this.current.root);this.edits=0;}}
 async checkCounts(head){await this.save();return super.checkCounts(head);}
 clear(){this.current=null;this.cache.clear();this.cacheBytes=0;this.cachedVersions.clear();this.pending.clear();this.pendingBytes=0;this.writes.clear();this.objects.clear();this.newObjects.clear();this.objectBytes=0;this.objectReads.clear();}
}
export async function withMetadataBatch(store,operation,{prefetchIds=[],signal}={}){
 const invoke=async()=>{if(prefetchIds.length){const index=metadataBatchIndex(store);await index.prefetchKeys(await index.head(),prefetchIds,{signal});}return operation();};
 const prior=metadataBatchIndex(store);if(prior)return invoke();
 const batch=new MetadataBatchIndex(store);
 try{
  return await batches.run(batch,async()=>{const result=await invoke();await batch.save();return result;});
 }finally{batch.clear();}
}

// An explicit transaction boundary for owners with durable batch cursors. Flush
// buffered rows and roots, suspend this cache while the owner commits, then
// reload identities on subsequent writes instead of retaining pre-commit roots.
export async function withFlushedMetadataBatch(store,operation){
 if(typeof operation!=='function')throw new AppError('INVALID');const batch=metadataBatchIndex(store);
 if(batch){await batch.save();batch.clear();}
 return withCatalogueCacheBoundary(store,()=>batch?batches.run(null,operation):operation());
}

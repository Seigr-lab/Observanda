// Workspace-owned website values use immutable bounded nodes. Their state slot
// binds the website and node identity into the existing catalogue encryption AAD.
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {writeCatalogueRows} from './catalogue-writes.js';
import {RecordValueTree} from './record-value-tree.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {WEBSITE_DOCUMENT_PREFIX} from './website-document-registry.js';
import {CatalogueReadCache} from './catalogue-read-cache.js';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export async function withWebsiteDocumentReads(store,operation){
 if(store.websiteBlockCache||store.readCache)return operation();
 // Writers share immutable block ciphertext only. Mutable heads, receipts and
 // catalogue metadata must continue to read their current transaction values.
 const cache=store.websiteBlockCache=new CatalogueReadCache();
 try{return await operation();}finally{cache.clear();delete store.websiteBlockCache;}
}
export class WebsiteDocumentBlockStore{
 constructor(store,websiteId,{readOnly=false}={}){if(!researchId(websiteId))throw new AppError('INVALID');this.store=store;this.websiteId=websiteId;this.readOnly=readOnly;this.temporary=new Map();this.temporaryBytes=0;this.pending=new Map();this.pendingBytes=0;this.cache=new Map();this.cacheBytes=0;}
 slot(kind,revision){if(!['value','index'].includes(kind)||!revisionId(revision))damaged();return WEBSITE_DOCUMENT_PREFIX+'block:'+this.websiteId+':'+kind+':'+revision;}
 decode(slot,payload,revision){const value=this.store.decode('state',slot,payload),raw=serialize(value);if(Buffer.byteLength(raw)>65536||digest(raw)!==revision)damaged();return value;}
 keep(slot,value,bytes){
  if(this.cache.has(slot))return;
  while(this.cache.size>=64||this.cacheBytes+bytes>1024*1024){const first=this.cache.keys().next().value;if(first===undefined)return;this.cacheBytes-=this.cache.get(first).bytes;this.cache.delete(first);}
  this.cache.set(slot,{value:structuredClone(value),bytes});this.cacheBytes+=bytes;
 }
 async put(kind,value){
  const raw=serialize(value),bytes=Buffer.byteLength(raw);if(bytes>65536)throw new AppError('INVALID');
  const revision=digest(raw),slot=this.slot(kind,revision);
  if(this.readOnly){
   if(this.temporary.has(slot))return revision;
   while(this.temporary.size>=256||this.temporaryBytes+bytes>4*1024*1024){const first=this.temporary.keys().next().value;if(first===undefined)break;this.temporaryBytes-=this.temporary.get(first).bytes;this.temporary.delete(first);}
   this.temporary.set(slot,{value:structuredClone(value),bytes});this.temporaryBytes+=bytes;return revision;
  }
  if(this.pending.has(slot)||this.cache.has(slot))return revision;
  this.pending.set(slot,{value:structuredClone(value),revision,bytes});this.pendingBytes+=bytes;
  if(this.pending.size>=32||this.pendingBytes>=256*1024)await this.flush();return revision;
 }
 async flush(){
  if(this.readOnly||!this.pending.size)return;const batch=[...this.pending],found=new Map((await this.store.db.all('SELECT slot,payload FROM state WHERE slot=ANY($1::text[])',batch.map(([slot])=>slot))).map(row=>[row.slot,row.payload])),rows=[];
  for(const [slot,{value,revision}] of batch){if(found.has(slot))this.decode(slot,found.get(slot),revision);else rows.push([slot,this.store.encode('state',slot,value)]);}
  await writeCatalogueRows(this.store.db,'state',rows,{create:true});
  for(const [slot,{value,bytes}] of batch)this.keep(slot,value,bytes);this.pending.clear();this.pendingBytes=0;
 }
 async read(kind,revision){
  const slot=this.slot(kind,revision),saved=this.temporary.get(slot)??this.pending.get(slot)??this.cache.get(slot);if(saved){if(this.cache.has(slot)){this.cache.delete(slot);this.cache.set(slot,saved);}return structuredClone(saved.value);}
  const cache=this.store.websiteBlockCache??this.store.readCache,load=()=>this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot),row=cache?await cache.row(slot,load):await load(),value=this.decode(slot,row?.payload,revision);this.keep(slot,value,Buffer.byteLength(serialize(value)));return value;
 }
 async prefetch(kind,revisions){
  if(!Array.isArray(revisions)||revisions.length>32)throw new AppError('INVALID');
  const wanted=new Map(revisions.map(revision=>[this.slot(kind,revision),revision]));
  // The catalogue's bounded ciphertext cache belongs to this transaction.
  // Fresh document readers still decrypt and hash-check every shared payload.
  const cache=this.store.websiteBlockCache??this.store.readCache;
  for(const [slot,revision] of wanted)if(!this.temporary.has(slot)&&!this.pending.has(slot)&&!this.cache.has(slot)&&cache?.rows.has(slot))await this.read(kind,revision);
  const missing=[...wanted.keys()].filter(slot=>!this.temporary.has(slot)&&!this.pending.has(slot)&&!this.cache.has(slot));if(!missing.length)return;
  for(const row of await this.store.db.all('SELECT slot,payload FROM state WHERE slot=ANY($1::text[])',missing)){
   if(!wanted.has(row.slot))damaged();const value=this.decode(row.slot,row.payload,wanted.get(row.slot));cache?.replace(row.slot,row.payload);this.keep(row.slot,value,Buffer.byteLength(serialize(value)));
  }
 }
 tree(){return new RecordValueTree(this);}
}

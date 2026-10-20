// Immutable bounded values and index pages in the existing encrypted state
// table. Directory transactions own publication of the authenticating head.
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {revisionId} from './web/revision-model.js';
import {writeCatalogueRows} from './catalogue-writes.js';
import {OWNER_DIRECTORY_PREFIX} from './owner-directory-model.js';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export class OwnerDirectoryBlocks{
 constructor(store){this.store=store;this.pending=new Map();this.pendingBytes=0;this.cache=new Map();this.cacheBytes=0;}
 slot(kind,revision){if(!['index','row','original'].includes(kind)||!revisionId(revision))damaged();return OWNER_DIRECTORY_PREFIX+'block:'+kind+':'+revision;}
 decode(slot,payload,revision){if(!payload)damaged();const value=this.store.decode('state',slot,payload),raw=serialize(value);if(Buffer.byteLength(raw)>65536||digest(raw)!==revision)damaged();return value;}
 keep(slot,value,bytes){
  if(this.cache.has(slot))return;while(this.cache.size>=128||this.cacheBytes+bytes>1024*1024){const first=this.cache.keys().next().value;if(first===undefined)return;this.cacheBytes-=this.cache.get(first).bytes;this.cache.delete(first);}
  this.cache.set(slot,{value:structuredClone(value),bytes});this.cacheBytes+=bytes;
 }
 async put(kind,value){const raw=serialize(value),bytes=Buffer.byteLength(raw);if(bytes>65536)throw new AppError('INVALID');const revision=digest(raw),slot=this.slot(kind,revision);if(!this.pending.has(slot)&&!this.cache.has(slot)){this.pending.set(slot,{value:structuredClone(value),bytes,revision});this.pendingBytes+=bytes;if(this.pending.size>=32||this.pendingBytes>=256*1024)await this.flush();}return revision;}
 async read(kind,revision){const slot=this.slot(kind,revision),cached=this.pending.get(slot)??this.cache.get(slot);if(cached)return structuredClone(cached.value);const row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot),value=this.decode(slot,row?.payload,revision);this.keep(slot,value,Buffer.byteLength(serialize(value)));return value;}
 async flush(){
  if(!this.pending.size)return;const batch=[...this.pending],found=new Map((await this.store.db.all('SELECT slot,payload FROM state WHERE slot=ANY($1::text[])',batch.map(([slot])=>slot))).map(row=>[row.slot,row.payload])),rows=[];
  for(const [slot,{value,revision}] of batch)if(found.has(slot))this.decode(slot,found.get(slot),revision);else rows.push([slot,this.store.encode('state',slot,value)]);
  await writeCatalogueRows(this.store.db,'state',rows,{create:true});for(const [slot,{value,bytes}] of batch)this.keep(slot,value,bytes);this.pending.clear();this.pendingBytes=0;
 }
}

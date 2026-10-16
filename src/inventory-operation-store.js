// Domain-owned recovery state. Only short local owner transactions write it.
import {ObjectIndex} from './object-index.js';
import {digest,serialize} from './storage-format.js';
import {uuid} from './modules/validation.js';
import {AppError} from './errors.js';
export const inventoryOperationPrefix='inventory-transaction:v1:';
export const inventoryOperationHash=value=>digest(serialize(value));
const kinds=new Set(['intent','decision','status','prepared','receipt','pending','live','current','claim']);
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export class InventoryOperationStore{
 constructor(store){if(!['bom','inventory'].includes(store.domain))throw new AppError('INVALID');this.store=store;}
 key(kind,id){if(!kinds.has(kind)||!uuid(id))throw new AppError('INVALID');return inventoryOperationPrefix+kind+'/'+id;}
 async read(kind,id){const value=await this.store.object(this.key(kind,id));if(value!==null&&(value?.version!==1||value.id!==id))fail();return value;}
 async once(kind,id,value){const old=await this.read(kind,id);if(old){if(serialize(old)!==serialize(value))throw new AppError('MODULE_REPLAY');return old;}if(value?.version!==1||value.id!==id)throw new AppError('INVALID');await this.store.putObject(this.key(kind,id),value);return value;}
 async write(kind,id,value){if(!['status','pending','live','current','claim'].includes(kind)||value?.version!==1||value.id!==id)throw new AppError('INVALID');await this.store.putObject(this.key(kind,id),value);return value;}
 async remove(kind,id){
  if(!['pending','live','claim'].includes(kind)||!this.store.writable)throw new AppError('INVALID');const key=this.key(kind,id),index=new ObjectIndex(this.store),head=await index.head(),entry=await index.find(head,key);await this.store.objectValue(key,entry);if(!entry)return;
  await index.update(head,key,null);await this.store.db.run('DELETE FROM objects WHERE id=$1',key);
 }
 async *entries(kind,{after=null,limit=25}={}){
  if(!kinds.has(kind)||!Number.isSafeInteger(limit)||limit<1||limit>200)throw new AppError('INVALID');const index=new ObjectIndex(this.store),head=await index.head(),prefix=inventoryOperationPrefix+kind+'/';let count=0;
  for await(const entry of index.entries(head,prefix,after===null?null:prefix+after)){if(count++===limit)return;const id=entry.id.slice(prefix.length);yield await this.read(kind,id);}
 }
}
export async function hasInventoryObligations(store){
 if(!['bom','inventory'].includes(store.domain))return false;const index=new ObjectIndex(store),head=await index.head();
 return await index.prefixCount(head,inventoryOperationPrefix+'pending/')>0||await index.prefixCount(head,inventoryOperationPrefix+'live/')>0;
}

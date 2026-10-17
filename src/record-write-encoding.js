// One admitted full-object write owns these measurements until all consumers
// finish. No caller-supplied digest, durable cache or receipt survives the scope.
import {AsyncLocalStorage} from 'node:async_hooks';
import {recordEncoding} from './record-encoding.js';
import {historicalRecordValue,recordRevision} from './research.js';
const prepared=new AsyncLocalStorage();
// Copy only JSON data, without invoking accessors or serialization hooks. Freeze
// our copy, never the caller's record: an await cannot invalidate its identities.
function ownRecord(value,ancestors=new Set()){
 if(value===null||['undefined','string','boolean','number'].includes(typeof value))return value;
 const invalid=()=>{throw Object.assign(new TypeError('Expected JSON data.'),{code:'INVALID'});};
 if(typeof value!=='object'||ancestors.has(value)||Object.getOwnPropertySymbols(value).length)invalid();
 const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
 if(!array&&prototype!==Object.prototype&&prototype!==null)invalid();
 const copy=array?new Array(value.length):Object.create(prototype);ancestors.add(value);
 try{
  const keys=array?null:Object.keys(value),length=array?value.length:keys.length;
  for(let i=0;i<length;i++){
   const key=array?String(i):keys[i];
   const descriptor=Object.getOwnPropertyDescriptor(value,key);
   if(descriptor&&!Object.hasOwn(descriptor,'value'))invalid();
   if(descriptor)Object.defineProperty(copy,key,{value:ownRecord(descriptor.value,ancestors),enumerable:true,writable:true,configurable:true});
  }
  return Object.freeze(copy);
 }finally{ancestors.delete(value);}
}
function freezeDisplay(value){
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freezeDisplay(child);Object.freeze(value);}
 return value;
}
export async function withRecordWriteEncoding(owner,record,metadata,consume){
 record=ownRecord(record);
 const display=freezeDisplay(historicalRecordValue(metadata,record)),encoding=Object.freeze(recordEncoding(record)),contentRevision=recordRevision(display);
 const receipt=Object.freeze({encoding,contentRevision,view:Object.freeze({revision:contentRevision,title:display.title,status:display.status,updatedAt:display.updatedAt})});
 const context={active:true,owner,record,metadata,display,receipt};
 try{return await prepared.run(context,()=>consume(receipt,record));}
 finally{context.active=false;context.owner=context.record=context.metadata=context.display=context.receipt=null;}
}
export function recordWriteEncoding(owner,record,metadata){
 const context=prepared.getStore();
 if(!context?.active||context.owner!==owner||context.record!==record||metadata!==undefined&&context.metadata!==metadata)return null;
 return context.receipt;
}
export function recordWriteDisplay(owner,record,metadata){
 const context=prepared.getStore();return recordWriteEncoding(owner,record,metadata)?context.display:null;
}

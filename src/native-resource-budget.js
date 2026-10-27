import os from 'node:os';
import {AppError} from './errors.js';

const MiB=1024*1024;
export const databaseMemoryReservation=sharedBuffersMiB=>(sharedBuffersMiB+192)*MiB;

// One application service accounts for its managed clusters (including the
// scratch guardian) and converters. Estimates are admission reservations, not
// a promise that a native parser cannot exceed them. Available memory includes
// other applications; no assumption of an idle or exclusively owned host.
export class NativeResourceBudget{
 constructor({memoryBytes=Math.max(512*MiB,Math.min(8192*MiB,Math.floor(os.totalmem()/4))),runtimeLimit=16,reserveBytes=512*MiB,available=()=>process.availableMemory?.()??os.freemem()}={}){
  if(![memoryBytes,runtimeLimit,reserveBytes].every(value=>Number.isSafeInteger(value)&&value>0)||typeof available!=='function')throw new AppError('INVALID');
  Object.assign(this,{memoryBytes,runtimeLimit,reserveBytes,available});this.entries=new Map();this.bytes=0;this.runtimes=0;this.listeners=new Set();this.evictions=new Set();
 }
 canReserve(kind,bytes){return this.bytes+bytes<=this.memoryBytes&&(kind!=='database'||this.runtimes<this.runtimeLimit)&&this.available()>=this.bytes+bytes+this.reserveBytes;}
 reserve(kind,bytes,{key=Symbol(kind)}={}){
  if(!['database','media'].includes(kind)||!Number.isSafeInteger(bytes)||bytes<1)throw new AppError('INVALID');
  let entry=this.entries.get(key);
  if(entry){
   if(entry.kind!==kind||!entry.uncertain||entry.claimed)throw new AppError('WORKLOAD_BUSY');
   if(bytes>entry.bytes){const extra=bytes-entry.bytes;if(!this.canReserve('media',extra))throw new AppError('WORKLOAD_BUSY');this.bytes+=extra;entry.bytes=bytes;}
   // A failed stop still consumes capacity. Authenticated lifecycle recovery
   // takes that reservation over without pretending the old process vanished.
   entry.claimed=true;
  }else{
   if(!this.canReserve(kind,bytes)){for(const evict of this.evictions)evict();throw new AppError('WORKLOAD_BUSY');}
   entry={kind,bytes,key,claimed:true,uncertain:false};this.entries.set(key,entry);this.bytes+=bytes;if(kind==='database')this.runtimes++;
  }
  let ended=false;
  return {uncertain:entry.uncertain,confirmed:()=>{if(!ended)entry.uncertain=false;},release:()=>{if(ended)return;ended=true;this.remove(entry);},uncertainExit:()=>{if(ended)return;ended=true;entry.uncertain=true;entry.claimed=false;}};
 }
 remove(entry){if(this.entries.get(entry.key)!==entry)return;this.entries.delete(entry.key);this.bytes-=entry.bytes;if(entry.kind==='database')this.runtimes--;for(const changed of this.listeners)changed();}
 stopped(key){const entry=this.entries.get(key);if(entry?.uncertain&&!entry.claimed)this.remove(entry);}
 onRelease(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
 onPressure(evict){this.evictions.add(evict);return ()=>this.evictions.delete(evict);}
 stats(){return {managedRuntimes:this.runtimes,runtimeLimit:this.runtimeLimit,converters:this.entries.size-this.runtimes,reservedBytes:this.bytes,memoryLimitBytes:this.memoryBytes,foregroundReserveBytes:this.reserveBytes,uncertainExits:[...this.entries.values()].filter(value=>value.uncertain).length};}
}
export const nativeResources=new NativeResourceBudget();

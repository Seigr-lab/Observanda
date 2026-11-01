import os from 'node:os';
import {AppError} from './errors.js';
import {workloadPriority,validWorkloadPriority} from './workload-priority.js';

const MiB=1024*1024;
export const databaseMemoryReservation=sharedBuffersMiB=>(sharedBuffersMiB+192)*MiB;

// One application service accounts for its managed clusters (including the
// scratch guardian) and converters. Estimates are admission reservations, not
// a promise that a native parser cannot exceed them. Available memory includes
// other applications; no assumption of an idle or exclusively owned host.
export class NativeResourceBudget{
 constructor({memoryBytes=Math.max(512*MiB,Math.min(8192*MiB,Math.floor(os.totalmem()/4))),runtimeLimit=16,reserveBytes=512*MiB,available=()=>process.availableMemory?.()??os.freemem(),interactiveMemoryBytes=Math.floor(memoryBytes/4),interactiveRuntimes=Math.min(2,runtimeLimit-1)}={}){
  if(![memoryBytes,runtimeLimit,reserveBytes].every(value=>Number.isSafeInteger(value)&&value>0)||typeof available!=='function')throw new AppError('INVALID');
  if(![interactiveMemoryBytes,interactiveRuntimes].every(value=>Number.isSafeInteger(value)&&value>=0)||interactiveMemoryBytes>=memoryBytes||interactiveRuntimes>=runtimeLimit)throw new AppError('INVALID');
  Object.assign(this,{memoryBytes,runtimeLimit,reserveBytes,available,interactiveMemoryBytes,interactiveRuntimes});this.entries=new Map();this.bytes=0;this.runtimes=0;this.backgroundBytes=0;this.backgroundRuntimes=0;this.listeners=new Set();this.evictions=new Set();
 }
 canReserve(kind,bytes,{priority=workloadPriority()}={}){return this.bytes+bytes<=this.memoryBytes&&(kind!=='database'||this.runtimes<this.runtimeLimit)&&this.available()>=this.bytes+bytes+this.reserveBytes&&(priority!=='background'||this.backgroundBytes+bytes<=this.memoryBytes-this.interactiveMemoryBytes&&(kind!=='database'||this.backgroundRuntimes<this.runtimeLimit-this.interactiveRuntimes));}
 reserve(kind,bytes,{key=Symbol(kind),priority=workloadPriority()}={}){
  if(!['database','media','buffer'].includes(kind)||!Number.isSafeInteger(bytes)||bytes<1||!validWorkloadPriority(priority))throw new AppError('INVALID');
  let entry=this.entries.get(key);
  if(entry){
   if(entry.kind!==kind||!entry.uncertain||entry.claimed)throw new AppError('WORKLOAD_BUSY');
   if(bytes>entry.bytes){const extra=bytes-entry.bytes;if(!this.canReserve('media',extra,{priority:entry.priority}))throw new AppError('WORKLOAD_BUSY');this.bytes+=extra;if(entry.priority==='background')this.backgroundBytes+=extra;entry.bytes=bytes;}
   // A failed stop still consumes capacity. Authenticated lifecycle recovery
   // takes that reservation over without pretending the old process vanished.
   entry.claimed=true;
  }else{
   if(!this.canReserve(kind,bytes,{priority})){for(const evict of this.evictions)evict();throw new AppError('WORKLOAD_BUSY');}
   entry={kind,bytes,key,priority,claimed:true,uncertain:false};this.entries.set(key,entry);this.bytes+=bytes;if(kind==='database')this.runtimes++;if(priority==='background'){this.backgroundBytes+=bytes;if(kind==='database')this.backgroundRuntimes++;}
  }
  let ended=false;
  return {uncertain:entry.uncertain,confirmed:()=>{if(!ended)entry.uncertain=false;},release:()=>{if(ended)return;ended=true;this.remove(entry);},uncertainExit:()=>{if(ended)return;ended=true;entry.uncertain=true;entry.claimed=false;}};
 }
 remove(entry){if(this.entries.get(entry.key)!==entry)return;this.entries.delete(entry.key);this.bytes-=entry.bytes;if(entry.kind==='database')this.runtimes--;if(entry.priority==='background'){this.backgroundBytes-=entry.bytes;if(entry.kind==='database')this.backgroundRuntimes--;}for(const changed of this.listeners)changed();}
 stopped(key){const entry=this.entries.get(key);if(entry?.uncertain&&!entry.claimed)this.remove(entry);}
 onRelease(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
 onPressure(evict){this.evictions.add(evict);return ()=>this.evictions.delete(evict);}
 stats(){const entries=[...this.entries.values()];return {managedRuntimes:this.runtimes,runtimeLimit:this.runtimeLimit,converters:entries.filter(value=>value.kind==='media').length,buffers:entries.filter(value=>value.kind==='buffer').length,reservedBytes:this.bytes,memoryLimitBytes:this.memoryBytes,foregroundReserveBytes:this.reserveBytes,interactiveMemoryBytes:this.interactiveMemoryBytes,interactiveRuntimes:this.interactiveRuntimes,backgroundBytes:this.backgroundBytes,backgroundRuntimes:this.backgroundRuntimes,uncertainExits:entries.filter(value=>value.uncertain).length};}
}
export const nativeResources=new NativeResourceBudget();

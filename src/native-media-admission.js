import os from 'node:os';
import {AppError} from './errors.js';
import {nativeResources} from './native-resource-budget.js';
import {workloadPriority,validWorkloadPriority,nextWorkIndex} from './workload-priority.js';

const MiB=1024*1024;
// This is a launch reservation, not an OS memory sandbox. OS confinement and
// measured process-tree limits remain separate from admission accounting.
export class NativeMediaAdmission{
 constructor({active=Math.max(1,Math.min(2,Math.floor(os.availableParallelism()/2))),queued=4,memoryBytes=Math.max(256*MiB,Math.min(2048*MiB,Math.floor(os.totalmem()/8))),available=()=>process.availableMemory?.()??os.freemem(),reserveBytes=256*MiB,waitMs=10000,budget=null,kind='media',foregroundSlots=Math.min(1,active-1)}={}){
  if(![active,memoryBytes,reserveBytes,waitMs].every(value=>Number.isSafeInteger(value)&&value>0)||!Number.isSafeInteger(queued)||queued<0||typeof available!=='function')throw new AppError('INVALID');
  if(!['media','buffer'].includes(kind)||!Number.isSafeInteger(foregroundSlots)||foregroundSlots<0||foregroundSlots>=active)throw new AppError('INVALID');Object.assign(this,{limit:active,maxQueued:queued,memoryLimit:memoryBytes,available,reserveBytes,waitMs,budget,kind,foregroundSlots});this.active=0;this.background=0;this.foregroundGrants=0;this.memory=0;this.queue=[];
  budget?.onRelease(()=>this.drain());
 }
 acquire(bytes,{signal,priority=workloadPriority()}={}){
  signal?.throwIfAborted();if(!Number.isSafeInteger(bytes)||bytes<1||!validWorkloadPriority(priority))throw new AppError('INVALID');
  if(bytes>this.memoryLimit)throw new AppError('MEDIA_RESOURCE_LIMIT');
  if(!this.queue.length&&this.canRun(bytes,priority))return Promise.resolve(this.ticket(bytes,priority));
  if(!this.active||this.queue.length>=this.maxQueued)throw new AppError('WORKLOAD_BUSY');
  return new Promise((resolve,reject)=>{
   const entry={bytes,signal,resolve,reject,priority},remove=error=>{const index=this.queue.indexOf(entry);if(index<0)return;this.queue.splice(index,1);this.clear(entry);reject(error);this.drain();};
   entry.abort=()=>remove(signal.reason);entry.timer=setTimeout(()=>remove(new AppError('WORKLOAD_BUSY')),this.waitMs);this.queue.push(entry);signal?.addEventListener('abort',entry.abort,{once:true});if(signal?.aborted)entry.abort();else this.drain();
  });
 }
 canRun(bytes,priority){return this.active<this.limit&&(priority!=='background'||this.background<this.limit-this.foregroundSlots)&&this.memory+bytes<=this.memoryLimit&&this.available()>=this.memory+bytes+this.reserveBytes&&(!this.budget||this.budget.canReserve(this.kind,bytes,{priority}));}
 clear(entry){clearTimeout(entry.timer);entry.signal?.removeEventListener('abort',entry.abort);}
 drain(){for(;;){const index=nextWorkIndex(this.queue,entry=>this.canRun(entry.bytes,entry.priority),this.foregroundGrants);if(index<0)return;const [entry]=this.queue.splice(index,1);this.clear(entry);if(entry.signal?.aborted){entry.reject(entry.signal.reason);continue;}this.foregroundGrants=entry.priority==='foreground'?Math.min(4,this.foregroundGrants+1):0;try{entry.resolve(this.ticket(entry.bytes,entry.priority));}catch(error){entry.reject(error);}}}
 ticket(bytes,priority){const permit=this.budget?.reserve(this.kind,bytes,{priority});this.active++;this.memory+=bytes;if(priority==='background')this.background++;let released=false;return ()=>{if(released)return;released=true;this.active--;this.memory-=bytes;if(priority==='background')this.background--;permit?.release();this.drain();};}
 stats(){return {active:this.active,background:this.background,foregroundSlots:this.foregroundSlots,queued:this.queue.length,reservedBytes:this.memory,activeLimit:this.limit,queueLimit:this.maxQueued,memoryLimitBytes:this.memoryLimit};}
}
export const nativeMediaAdmission=new NativeMediaAdmission({budget:nativeResources});

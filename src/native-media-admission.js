import os from 'node:os';
import {AppError} from './errors.js';

const MiB=1024*1024;
// This is a launch reservation, not an OS memory sandbox. OS confinement and
// measured process-tree limits remain separate from admission accounting.
export class NativeMediaAdmission{
 constructor({active=Math.max(1,Math.min(2,Math.floor(os.availableParallelism()/2))),queued=4,memoryBytes=Math.max(256*MiB,Math.min(2048*MiB,Math.floor(os.totalmem()/8))),available=()=>process.availableMemory?.()??os.freemem(),reserveBytes=256*MiB,waitMs=10000}={}){
  if(![active,memoryBytes,reserveBytes,waitMs].every(value=>Number.isSafeInteger(value)&&value>0)||!Number.isSafeInteger(queued)||queued<0||typeof available!=='function')throw new AppError('INVALID');
  Object.assign(this,{limit:active,maxQueued:queued,memoryLimit:memoryBytes,available,reserveBytes,waitMs});this.active=0;this.memory=0;this.queue=[];
 }
 acquire(bytes,{signal}={}){
  signal?.throwIfAborted();if(!Number.isSafeInteger(bytes)||bytes<1)throw new AppError('INVALID');
  if(bytes>this.memoryLimit)throw new AppError('MEDIA_RESOURCE_LIMIT');
  if(!this.queue.length&&this.canRun(bytes))return Promise.resolve(this.ticket(bytes));
  if(!this.active||this.queue.length>=this.maxQueued)throw new AppError('WORKLOAD_BUSY');
  return new Promise((resolve,reject)=>{
   const entry={bytes,signal,resolve,reject},remove=error=>{const index=this.queue.indexOf(entry);if(index<0)return;this.queue.splice(index,1);this.clear(entry);reject(error);this.drain();};
   entry.abort=()=>remove(signal.reason);entry.timer=setTimeout(()=>remove(new AppError('WORKLOAD_BUSY')),this.waitMs);this.queue.push(entry);signal?.addEventListener('abort',entry.abort,{once:true});if(signal?.aborted)entry.abort();
  });
 }
 canRun(bytes){return this.active<this.limit&&this.memory+bytes<=this.memoryLimit&&this.available()>=this.memory+bytes+this.reserveBytes;}
 clear(entry){clearTimeout(entry.timer);entry.signal?.removeEventListener('abort',entry.abort);}
 drain(){while(this.queue.length&&this.canRun(this.queue[0].bytes)){const entry=this.queue.shift();this.clear(entry);if(entry.signal?.aborted){entry.reject(entry.signal.reason);continue;}entry.resolve(this.ticket(entry.bytes));}}
 ticket(bytes){this.active++;this.memory+=bytes;let released=false;return ()=>{if(released)return;released=true;this.active--;this.memory-=bytes;this.drain();};}
 stats(){return {active:this.active,queued:this.queue.length,reservedBytes:this.memory,activeLimit:this.limit,queueLimit:this.maxQueued,memoryLimitBytes:this.memoryLimit};}
}
export const nativeMediaAdmission=new NativeMediaAdmission();

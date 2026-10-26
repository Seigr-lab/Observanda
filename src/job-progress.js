// Progress is an observation, not a durable domain checkpoint. Keep only the
// latest observation while one lease renewal is in flight; never stall a byte
// stream on a progress write or accumulate promises behind slow storage.
import {AsyncLocalStorage} from 'node:async_hooks';
import {performance} from 'node:perf_hooks';
import {AppError} from './errors.js';
export function validateJobProgress(value){
 if(!value||!Number.isSafeInteger(value.done)||!Number.isSafeInteger(value.total)||value.done<0||value.done>value.total||typeof value.stage!=='string'||value.stage.length>80)throw new AppError('INVALID');
 return value;
}
export class JobProgress{
 constructor(send,{heartbeatMs=10000,progressMs=1000,signal,onError=()=>{}}={}){
  this.send=send;this.heartbeatMs=heartbeatMs;this.progressMs=progressMs;this.signal=signal;this.onError=onError;
  // Source verification can hold a retained read snapshot. Control writes and
  // their lease checks must run in the worker's original, current context.
  this.context=AsyncLocalStorage.snapshot();this.latest=null;this.pending=null;this.timer=null;this.closed=false;this.failure=null;this.last=performance.now();this.sent=false;
  this.schedule();
 }
 report(value){
  this.signal?.throwIfAborted();if(this.failure)throw this.failure;if(this.closed)throw new AppError('JOB_LEASE');
  this.latest={...validateJobProgress(value)};
  if(!this.pending&&(!this.sent||performance.now()-this.last>=this.progressMs))this.start();else this.schedule();
 }
 schedule(){
  clearTimeout(this.timer);this.timer=null;if(this.closed||this.pending||this.failure)return;
  const interval=this.latest?Math.min(this.progressMs,this.heartbeatMs):this.heartbeatMs;
  this.timer=setTimeout(()=>this.start(),Math.max(0,this.last+interval-performance.now()));this.timer.unref();
 }
 start(){
  if(this.pending||this.failure)return this.pending;clearTimeout(this.timer);this.timer=null;
  const value=this.latest;this.latest=null;this.last=performance.now();this.sent=true;
  this.pending=this.context(async()=>{this.signal?.throwIfAborted();return this.send(value??undefined);});
  this.pending.then(()=>{this.pending=null;this.schedule();},error=>{this.pending=null;this.failure=error;this.onError(error);});
  return this.pending;
 }
 async flush(){
  for(;;){if(this.failure)throw this.failure;const pending=this.pending??(this.latest?this.start():null);if(!pending)return;await pending;}
 }
 async finish(){this.closed=true;clearTimeout(this.timer);this.timer=null;await this.flush();}
 async stop(){this.closed=true;this.latest=null;clearTimeout(this.timer);this.timer=null;await this.pending?.catch(()=>{});}
}

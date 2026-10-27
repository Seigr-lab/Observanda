import {AsyncLocalStorage} from 'node:async_hooks';
import {onResponseClose} from './response-close.js';
import {setTimeout as delay} from 'node:timers/promises';
import {AppError} from './errors.js';
import {operationStage} from './operation-progress.js';
import {WriterAdmission} from './writer-admission.js';
const policy=new AsyncLocalStorage();
const writers=new WriterAdmission();
export const writerCapacity=()=>writers.stats();
export const withoutWriterWait=operation=>policy.run(null,operation);
// A durable job owns its cancellation and lease checks independently of the
// HTTP request that started it. Its queue already serializes job writes; poll
// database acquisition here so a lease is checked even behind a long writer.
export function backgroundWriterWait(operation,{signal,check}){
 return policy.run({enabled:()=>true,queue:false,signal,check:async()=>{signal.throwIfAborted();await check();signal.throwIfAborted();},waiting:()=>{},acquired:()=>{}},operation);
}
export async function queuedWriter(root,operation){
 const owner=policy.getStore();if(!owner?.enabled()||owner.queue===false)return operation();
 const release=await owner.admission.acquire(root,{signal:owner.signal,waiting:owner.waiting});
 try{if(owner.signal.aborted)throw new AppError('WRITE_CANCELLED');await owner.check();owner.acquired();return await operation();}
 finally{release();}
}
export async function waitForWriter(acquire){
 const owner=policy.getStore();
 if(!owner?.enabled())return acquire();
 const attempt=async()=>{
  if(owner.signal.aborted)throw new AppError('WRITE_CANCELLED');await owner.check();
  const result=await acquire();
  if(owner.signal.aborted)throw new AppError('WRITE_CANCELLED');await owner.check();
  owner.acquired();return result;
 };
 try{return await attempt();}catch(error){if(error.code!=='LOCKED')throw error;}
 const deadline=performance.now()+(owner.waitMs??Infinity);
 owner.waiting();
 return operationStage('waiting-writer',{},async()=>{
  for(;;){
   if(owner.signal.aborted)throw new AppError('WRITE_CANCELLED');if(performance.now()>=deadline)throw new AppError('WORKLOAD_BUSY');await owner.check();
   await delay(Math.min(100,Math.max(1,deadline-performance.now())));
   if(owner.signal.aborted)throw new AppError('WRITE_CANCELLED');if(performance.now()>=deadline)throw new AppError('WORKLOAD_BUSY');await owner.check();
   try{return await attempt();}catch(error){if(error.code!=='LOCKED')throw error;}
  }
 });
}
export async function requestWriterWait(req,res,operation,{admission=writers,waitMs=30000}={}){
 const timeout=req.socket.timeout;
 const controller=new AbortController(),closed=()=>{if(!res.writableEnded&&req.continueAfterDisconnect!==true)controller.abort();},releaseClose=onResponseClose(res,closed);
 try{return await policy.run({admission,waitMs,enabled:()=>req.waitForWriter===true,signal:controller.signal,check:()=>req.checkWriter(),waiting:()=>{res.setTimeout(0);req.operationActivity?.().waiting();},acquired:()=>req.activity?.running()},operation);}
 finally{releaseClose();if(!req.socket.destroyed)req.socket.setTimeout(timeout??60000);}
}

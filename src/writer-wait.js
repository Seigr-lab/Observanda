import {AsyncLocalStorage} from 'node:async_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {AppError} from './errors.js';
import {operationStage} from './operation-progress.js';
const policy=new AsyncLocalStorage();
const queues=new Map();
export const withoutWriterWait=operation=>policy.run(null,operation);
// A durable job owns its cancellation and lease checks independently of the
// HTTP request that started it. Its queue already serializes job writes; poll
// database acquisition here so a lease is checked even behind a long writer.
export function backgroundWriterWait(operation,{signal,check}){
 return policy.run({enabled:()=>true,queue:false,signal,check:async()=>{signal.throwIfAborted();await check();signal.throwIfAborted();},waiting:()=>{},acquired:()=>{}},operation);
}
export async function queuedWriter(root,operation){
 const owner=policy.getStore();if(!owner?.enabled()||owner.queue===false)return operation();
 const queue=queues.get(root)??{active:false,waiting:[]};queues.set(root,queue);
 let ticket;
 const turn=new Promise((resolve,reject)=>{ticket={resolve,reject};if(!queue.active){queue.active=true;resolve();}else{queue.waiting.push(ticket);owner.waiting();}});
 const cancelled=()=>{const index=queue.waiting.indexOf(ticket);if(index>=0){queue.waiting.splice(index,1);ticket.reject(new AppError('WRITE_CANCELLED'));}};
 owner.signal.addEventListener('abort',cancelled,{once:true});
 try{await turn;}catch(error){owner.signal.removeEventListener('abort',cancelled);throw error;}
 owner.signal.removeEventListener('abort',cancelled);
 try{if(owner.signal.aborted)throw new AppError('WRITE_CANCELLED');await owner.check();owner.acquired();return await operation();}
 finally{const next=queue.waiting.shift();if(next)next.resolve();else{queue.active=false;queues.delete(root);}}
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
 owner.waiting();
 return operationStage('waiting-writer',{},async()=>{
  for(;;){
   if(owner.signal.aborted)throw new AppError('WRITE_CANCELLED');await owner.check();
   await delay(100);
   if(owner.signal.aborted)throw new AppError('WRITE_CANCELLED');await owner.check();
   try{return await attempt();}catch(error){if(error.code!=='LOCKED')throw error;}
  }
 });
}
export async function requestWriterWait(req,res,operation){
 const timeout=req.socket.timeout;
 const controller=new AbortController(),closed=()=>{if(!res.writableEnded&&req.continueAfterDisconnect!==true)controller.abort();};res.once('close',closed);
 try{return await policy.run({enabled:()=>req.waitForWriter===true,signal:controller.signal,check:()=>req.checkWriter(),waiting:()=>{res.setTimeout(0);req.operationActivity?.().waiting();},acquired:()=>req.activity?.running()},operation);}
 finally{res.off('close',closed);if(!req.socket.destroyed)req.socket.setTimeout(timeout??60000);}
}

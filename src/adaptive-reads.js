// Shared admission for independent streaming reads. Writers and publication
// checkpoints stay with their owners; this pool never parallelizes them.
import os from 'node:os';
import {AsyncLocalStorage} from 'node:async_hooks';
import {monitorEventLoopDelay} from 'node:perf_hooks';

const MiB=1024*1024;
function cpuTime(){
 let idle=0,total=0;
 for(const cpu of os.cpus()){idle+=cpu.times.idle;for(const value of Object.values(cpu.times))total+=value;}
 return {idle,total};
}
function hostSampler(){
 let previous,delay;
 return {
  start(){previous=cpuTime();delay=monitorEventLoopDelay({resolution:20});delay.enable();},
  read(){
   const current=cpuTime(),elapsed=current.total-previous.total;
   const busy=elapsed>0?1-(current.idle-previous.idle)/elapsed:0;previous=current;
   const constrained=process.constrainedMemory(),total=Math.min(os.totalmem(),constrained||Infinity);
   const available=Math.min(os.freemem(),process.availableMemory());
   const delayMs=delay.count?delay.percentile(99)/1e6:0;delay.reset();
   return {cores:os.availableParallelism(),total,available,busy,delayMs};
  },
  stop(){delay?.disable();delay=null;}
 };
}
function capacity(sample,maximum){
 const {cores,total,available,busy,delayMs}=sample;
 if(![cores,total,available,busy,delayMs].every(Number.isFinite)||cores<1||total<=0||available<0||busy<0||busy>1||delayMs<0)return {limit:1,pressure:true};
 // Leave memory and at least one CPU available to the interface and other apps.
 // Each admitted stream reserves a conservative 64 MiB, regardless of file size.
 const memory=Math.floor(Math.max(0,available-Math.max(256*MiB,total*0.1))/(64*MiB));
 const cpu=Math.max(1,Math.floor(cores*(1-busy))-1);
 return {limit:Math.max(1,Math.min(maximum,memory,cpu)),pressure:busy>=0.85||delayMs>=50||memory<1};
}
export class AdaptiveReadPool {
 constructor({sampler=hostSampler(),intervalMs=1000,maxConcurrency=8}={}){
  if(!Number.isInteger(maxConcurrency)||maxConcurrency<1||maxConcurrency>32||!Number.isInteger(intervalMs)||intervalMs<1)throw new RangeError('Invalid read budget');
  this.sampler=sampler;this.intervalMs=intervalMs;this.maxConcurrency=maxConcurrency;
  this.limit=1;this.active=0;this.pending=[];this.timer=null;this.started=false;
 }
 refresh(initial=false){
  const next=capacity(this.sampler.read(),this.maxConcurrency);
  this.limit=initial?Math.min(2,next.limit):Math.min(next.limit,next.pressure?Math.max(1,Math.floor(this.limit/2)):this.limit+1);
  this.pump();
 }
 run(operation,{signal}={}){
  signal?.throwIfAborted();
  const context=AsyncLocalStorage.snapshot();
  return new Promise((resolve,reject)=>{
   const entry={operation:()=>context(operation),resolve,reject,signal,abort:null};
   entry.abort=()=>{
    const at=this.pending.indexOf(entry);if(at<0)return;
    this.pending.splice(at,1);reject(signal.reason);this.idle();
   };
   if(!this.started){
    this.sampler.start();this.started=true;this.refresh(true);
    this.timer=setInterval(()=>this.refresh(),this.intervalMs);this.timer.unref();
   }
   this.pending.push(entry);signal?.addEventListener('abort',entry.abort,{once:true});this.pump();
  });
 }
 pump(){
  while(this.active<this.limit&&this.pending.length){
   const entry=this.pending.shift();entry.signal?.removeEventListener('abort',entry.abort);
   if(entry.signal?.aborted){entry.reject(entry.signal.reason);continue;}
   this.active++;
   Promise.resolve().then(entry.operation).then(entry.resolve,entry.reject).finally(()=>{this.active--;this.pump();this.idle();});
  }
 }
 idle(){
  if(!this.started||this.active||this.pending.length)return;
  clearInterval(this.timer);this.timer=null;this.started=false;this.sampler.stop();
 }
}
export const streamingReadPool=new AdaptiveReadPool();

// Bounded look-ahead, source-order results and fail-fast cancellation. Await
// every accepted read before returning or closing its owner's resources.
export async function* adaptiveReadMap(source,operation,{signal,pool=streamingReadPool}={}){
 const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
 const iterator=source[Symbol.asyncIterator]?.()??source[Symbol.iterator](),pending=[];
 let ended=false;
 try{
  for(;;){
   while(!ended&&pending.length<pool.maxConcurrency){
    combined.throwIfAborted();const item=await iterator.next();
    if(item.done){ended=true;break;}
    const result=pool.run(()=>operation(item.value,combined),{signal:combined}).then(value=>({value}),error=>{controller.abort(error);return {error,failed:true};});
    pending.push(result);
   }
   if(!pending.length)break;
   const result=await pending.shift();if(result.failed)throw result.error;
   combined.throwIfAborted();yield result.value;
  }
 }finally{
  controller.abort();await Promise.all(pending);await iterator.return?.();
 }
}
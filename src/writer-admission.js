import {AppError} from './errors.js';

// Only waiting foreground writers occupy this queue. Durable workers keep
// their own leases and cancellation checks. Do not impose an active-owner
// semaphore here: a transaction may legitimately coordinate another owner.
export class WriterAdmission{
 constructor({maxQueued=32,perOwner=8,waitMs=30000}={}){
  if(![maxQueued,perOwner,waitMs].every(value=>Number.isSafeInteger(value)&&value>0))throw new AppError('INVALID');
  this.maxQueued=maxQueued;this.perOwner=perOwner;this.waitMs=waitMs;this.owners=new Map();this.queued=0;
 }
 acquire(key,{signal,waiting=()=>{}}={}){
  if(signal?.aborted)throw new AppError('WRITE_CANCELLED');
  let owner=this.owners.get(key);
  if(!owner){owner={key,queue:[]};this.owners.set(key,owner);return Promise.resolve(this.ticket(owner));}
  if(this.queued>=this.maxQueued||owner.queue.length>=this.perOwner)throw new AppError('WORKLOAD_BUSY');
  return new Promise((resolve,reject)=>{
   const entry={resolve,reject,signal};
   const remove=error=>{const index=owner.queue.indexOf(entry);if(index<0)return;owner.queue.splice(index,1);this.queued--;this.clear(entry);reject(error);};
   entry.abort=()=>remove(new AppError('WRITE_CANCELLED'));entry.timer=setTimeout(()=>remove(new AppError('WORKLOAD_BUSY')),this.waitMs);
   owner.queue.push(entry);this.queued++;signal?.addEventListener('abort',entry.abort,{once:true});if(signal?.aborted)entry.abort();
   try{waiting();}catch(error){remove(error);}
  });
 }
 clear(entry){clearTimeout(entry.timer);entry.signal?.removeEventListener('abort',entry.abort);}
 ticket(owner){let released=false;return ()=>{
  if(released)return;released=true;
  while(owner.queue.length){const next=owner.queue.shift();this.queued--;this.clear(next);if(next.signal?.aborted){next.reject(new AppError('WRITE_CANCELLED'));continue;}next.resolve(this.ticket(owner));return;}
  this.owners.delete(owner.key);
 };}
 stats(){return {activeOwners:this.owners.size,queued:this.queued,queueLimit:this.maxQueued,perOwnerLimit:this.perOwner};}
}

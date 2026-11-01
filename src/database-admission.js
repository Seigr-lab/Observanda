import {AppError} from './errors.js';
import {workloadPriority,validWorkloadPriority,nextWorkIndex} from './workload-priority.js';

// Admission reserves a primary and one temporary-work connection. Endpoint
// queues cannot exceed the process-wide waiting budget. Global exhaustion is
// refused immediately: a caller may already hold another owner's connection.
export class DatabaseAdmission{
 constructor({limit=12,globalLimit=24,maxQueued=128,waitMs=30000,foregroundReserve=Math.min(2,limit-1),globalForegroundReserve=Math.min(4,globalLimit-1)}={}){
  if(![limit,globalLimit,waitMs].every(value=>Number.isSafeInteger(value)&&value>0)||!Number.isSafeInteger(maxQueued)||maxQueued<0)throw new AppError('INVALID');
  if(![foregroundReserve,globalForegroundReserve].every(value=>Number.isSafeInteger(value)&&value>=0)||foregroundReserve>=limit||globalForegroundReserve>=globalLimit)throw new AppError('INVALID');
  Object.assign(this,{limit,globalLimit,maxQueued,waitMs,foregroundReserve,globalForegroundReserve});this.owners=new Map();this.active=0;this.background=0;this.waiting=0;
 }
 acquire(key,{signal,priority=workloadPriority()}={}){
  signal?.throwIfAborted();if(!validWorkloadPriority(priority))throw new AppError('INVALID');if(this.active>=this.globalLimit||priority==='background'&&this.background>=this.globalLimit-this.globalForegroundReserve)throw new AppError('DATABASE_BUSY');let owner=this.owners.get(key);
  if(!owner){owner={key,active:0,background:0,foregroundGrants:0,queue:[]};this.owners.set(key,owner);}
  if(this.canRun(owner,priority)&&!owner.queue.length)return Promise.resolve(this.ticket(owner,priority));
  if(this.waiting>=this.maxQueued)throw new AppError('DATABASE_BUSY');
  return new Promise((resolve,reject)=>{
   const entry={resolve,reject,signal,priority,timer:null,abort:null};
   const remove=error=>{const index=owner.queue.indexOf(entry);if(index<0)return;owner.queue.splice(index,1);this.waiting--;this.clear(entry);reject(error);this.clean(owner);};
   entry.abort=()=>remove(signal.reason);entry.timer=setTimeout(()=>remove(new AppError('DATABASE_BUSY')),this.waitMs);
   signal?.addEventListener('abort',entry.abort,{once:true});owner.queue.push(entry);this.waiting++;
   if(signal?.aborted)entry.abort();else this.drain(owner);
  });
 }
 canRun(owner,priority){return owner.active<this.limit&&this.active<this.globalLimit&&(priority!=='background'||owner.background<this.limit-this.foregroundReserve&&this.background<this.globalLimit-this.globalForegroundReserve);}
 drain(owner){
  for(;;){const index=nextWorkIndex(owner.queue,entry=>this.canRun(owner,entry.priority),owner.foregroundGrants);if(index<0)break;const [entry]=owner.queue.splice(index,1);this.waiting--;this.clear(entry);if(entry.signal?.aborted){entry.reject(entry.signal.reason);continue;}owner.foregroundGrants=entry.priority==='foreground'?Math.min(4,owner.foregroundGrants+1):0;entry.resolve(this.ticket(owner,entry.priority));}this.clean(owner);
 }
 clear(entry){clearTimeout(entry.timer);entry.signal?.removeEventListener('abort',entry.abort);}
 clean(owner){if(!owner.active&&!owner.queue.length&&this.owners.get(owner.key)===owner)this.owners.delete(owner.key);}
 ticket(owner,priority){
  owner.active++;this.active++;if(priority==='background'){owner.background++;this.background++;}let primary=true,auxiliary=false,finished=false;
  const drain=()=>{
   if(primary||auxiliary||finished)return;finished=true;owner.active--;this.active--;if(priority==='background'){owner.background--;this.background--;}
   for(const candidate of this.owners.values())this.drain(candidate);
  };
  return {
   auxiliary(){if(!primary||auxiliary)throw new AppError('DATABASE_BUSY');auxiliary=true;let released=false;return ()=>{if(released)return;released=true;auxiliary=false;drain();};},
   release(){if(!primary)return;primary=false;drain();}
  };
 }
 stats(){return {limit:this.limit,globalLimit:this.globalLimit,queueLimit:this.maxQueued,connectionLimit:this.globalLimit*2,owners:this.owners.size,admitted:this.active,background:this.background,foregroundReserve:this.foregroundReserve,globalForegroundReserve:this.globalForegroundReserve,queued:this.waiting};}
}

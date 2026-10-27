import {AppError} from './errors.js';

// Admission reserves a primary and one temporary-work connection. Endpoint
// queues cannot exceed the process-wide waiting budget. Global exhaustion is
// refused immediately: a caller may already hold another owner's connection.
export class DatabaseAdmission{
 constructor({limit=12,globalLimit=24,maxQueued=128,waitMs=30000}={}){
  if(![limit,globalLimit,waitMs].every(value=>Number.isSafeInteger(value)&&value>0)||!Number.isSafeInteger(maxQueued)||maxQueued<0)throw new AppError('INVALID');
  Object.assign(this,{limit,globalLimit,maxQueued,waitMs});this.owners=new Map();this.active=0;this.waiting=0;
 }
 acquire(key,{signal}={}){
  signal?.throwIfAborted();if(this.active>=this.globalLimit)throw new AppError('DATABASE_BUSY');let owner=this.owners.get(key);
  if(!owner){owner={key,active:0,queue:[]};this.owners.set(key,owner);}
  if(owner.active<this.limit&&!owner.queue.length)return Promise.resolve(this.ticket(owner));
  if(this.waiting>=this.maxQueued)throw new AppError('DATABASE_BUSY');
  return new Promise((resolve,reject)=>{
   const entry={resolve,reject,signal,timer:null,abort:null};
   const remove=error=>{const index=owner.queue.indexOf(entry);if(index<0)return;owner.queue.splice(index,1);this.waiting--;this.clear(entry);reject(error);this.clean(owner);};
   entry.abort=()=>remove(signal.reason);entry.timer=setTimeout(()=>remove(new AppError('DATABASE_BUSY')),this.waitMs);
   signal?.addEventListener('abort',entry.abort,{once:true});owner.queue.push(entry);this.waiting++;
   if(signal?.aborted)entry.abort();
  });
 }
 clear(entry){clearTimeout(entry.timer);entry.signal?.removeEventListener('abort',entry.abort);}
 clean(owner){if(!owner.active&&!owner.queue.length&&this.owners.get(owner.key)===owner)this.owners.delete(owner.key);}
 ticket(owner){
  owner.active++;this.active++;let primary=true,auxiliary=false,finished=false;
  const drain=()=>{
   if(primary||auxiliary||finished)return;finished=true;owner.active--;this.active--;
   while(owner.queue.length&&owner.active<this.limit&&this.active<this.globalLimit){const entry=owner.queue.shift();this.waiting--;this.clear(entry);if(entry.signal?.aborted){entry.reject(entry.signal.reason);continue;}entry.resolve(this.ticket(owner));}
   this.clean(owner);
  };
  return {
   auxiliary(){if(!primary||auxiliary)throw new AppError('DATABASE_BUSY');auxiliary=true;let released=false;return ()=>{if(released)return;released=true;auxiliary=false;drain();};},
   release(){if(!primary)return;primary=false;drain();}
  };
 }
 stats(){return {limit:this.limit,globalLimit:this.globalLimit,queueLimit:this.maxQueued,connectionLimit:this.globalLimit*2,owners:this.owners.size,admitted:this.active,queued:this.waiting};}
}

import {AppError} from './errors.js';

// Each endpoint owns its queue. Admission reserves a primary connection and
// one temporary-work connection, so admitted audits can finish under pressure.
export class DatabaseAdmission{
 constructor({limit=12,maxQueued=128,waitMs=30000}={}){
  if(!Number.isSafeInteger(limit)||limit<1||!Number.isSafeInteger(maxQueued)||maxQueued<0||!Number.isSafeInteger(waitMs)||waitMs<1)throw new AppError('INVALID');
  this.limit=limit;this.maxQueued=maxQueued;this.waitMs=waitMs;this.owners=new Map();
 }
 acquire(key,{signal}={}){
  signal?.throwIfAborted();let owner=this.owners.get(key);
  if(!owner){owner={key,active:0,queue:[]};this.owners.set(key,owner);}
  if(owner.active<this.limit&&!owner.queue.length)return Promise.resolve(this.ticket(owner));
  if(owner.queue.length>=this.maxQueued)throw new AppError('DATABASE_BUSY');
  return new Promise((resolve,reject)=>{
   const entry={resolve,reject,signal,timer:null,abort:null};
   const remove=error=>{const index=owner.queue.indexOf(entry);if(index<0)return;owner.queue.splice(index,1);this.clear(entry);reject(error);this.clean(owner);};
   entry.abort=()=>remove(signal.reason);entry.timer=setTimeout(()=>remove(new AppError('DATABASE_BUSY')),this.waitMs);
   signal?.addEventListener('abort',entry.abort,{once:true});owner.queue.push(entry);
   if(signal?.aborted)entry.abort();
  });
 }
 clear(entry){clearTimeout(entry.timer);entry.signal?.removeEventListener('abort',entry.abort);}
 clean(owner){if(!owner.active&&!owner.queue.length&&this.owners.get(owner.key)===owner)this.owners.delete(owner.key);}
 ticket(owner){
  owner.active++;let primary=true,auxiliary=false,finished=false;
  const drain=()=>{
   if(primary||auxiliary||finished)return;finished=true;owner.active--;
   while(owner.queue.length&&owner.active<this.limit){const entry=owner.queue.shift();this.clear(entry);if(entry.signal?.aborted){entry.reject(entry.signal.reason);continue;}entry.resolve(this.ticket(owner));}
   this.clean(owner);
  };
  return {
   auxiliary(){if(!primary||auxiliary)throw new AppError('DATABASE_BUSY');auxiliary=true;let released=false;return ()=>{if(released)return;released=true;auxiliary=false;drain();};},
   release(){if(!primary)return;primary=false;drain();}
  };
 }
 stats(){return {limit:this.limit,owners:this.owners.size,admitted:[...this.owners.values()].reduce((n,o)=>n+o.active,0),queued:[...this.owners.values()].reduce((n,o)=>n+o.queue.length,0)};}
}

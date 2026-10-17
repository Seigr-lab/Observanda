// Durable, encrypted workspace jobs. A lease fences every progress/final write;
// handlers prepare bytes outside transactions and commit references inside one.
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {AppError,safeError} from './errors.js';
import {digest,serialize} from './storage.js';
import {researchId} from './web/research-reference.js';
import {JobQueueIndex} from './job-queue-index.js';
import {JobRelocations,jobFingerprint} from './job-relocations.js';
import {withWorkspaceMetadataBatch} from './metadata-batch.js';
import {withoutWriterWait} from './writer-wait.js';
const terminal=new Set(['completed','failed','cancelled']);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const same=(a,b)=>digest(serialize(a))===digest(serialize(b));
const jobWrites=new AsyncLocalStorage();
export const jobSummary=job=>job&&({...Object.fromEntries(['id','type','scope','state','attempt','progress','result','error','cancelRequested','createdAt','updatedAt'].map(key=>[key,job[key]])),message:job.state==='relocated'?safeError(new AppError('JOB_RELOCATED')).message:job.error?safeError(new AppError(job.error)).message:null});
export class DurableJobs{
 constructor(workspace,definitions,{leaseMs=30000,observe=()=>{}}={}){this.workspace=workspace;this.definitions=definitions;this.leaseMs=leaseMs;this.observe=observe;this.pendingWrite=Promise.resolve();this.membership=new JobQueueIndex(workspace,id=>this.read(id));this.relocations=new JobRelocations(workspace);}
 file(id){if(!researchId(id))throw new AppError('INVALID');return '.observanda/jobs/'+id+'.json';}
 async now(){return this.workspace.catalogue(async store=>Number((await store.db.get('SELECT extract(epoch FROM clock_timestamp()) * 1000 AS now')).now));}
 async read(id){return this.workspace.catalogue(()=>this.readStored(id));}
 async readStored(id){
  const raw=await this.workspace.readMetadata(this.file(id),1048576);if(raw===null)return null;
  let job;try{job=JSON.parse(raw);}catch{throw new AppError('JOB_DAMAGED');}
  if(job.format!==1||job.id!==id||!researchId(job.scope)||typeof job.type!=='string'||!job.type||job.type.length>100||!Number.isFinite(Date.parse(job.createdAt))||!Number.isFinite(Date.parse(job.updatedAt))||!['queued','running',...terminal].includes(job.state)||!Number.isSafeInteger(job.attempt)||job.attempt<0||typeof job.cancelRequested!=='boolean'||!job.progress||!Number.isSafeInteger(job.progress.done)||!Number.isSafeInteger(job.progress.total)||job.progress.done<0||job.progress.total<job.progress.done||!job.input||typeof job.input!=='object'||Array.isArray(job.input)||typeof job.progress.stage!=='string'||job.progress.stage.length>80||job.state==='running'&&(!researchId(job.lease?.token)||!Number.isFinite(job.lease?.until)))throw new AppError('JOB_DAMAGED');
  const relocation=await this.relocations.read(id);
  if(relocation){if(jobFingerprint(job)!==relocation.sourceRevision)throw new AppError('JOB_DAMAGED');return {...job,state:'relocated',lease:null,relocation};}
  return job;
 }
 async hasActive(types=null){return this.workspace.catalogue(()=>this.membership.has(types));}
 async status(){return this.workspace.catalogue(()=>this.membership.status());}
 async write(job){
  await this.relocations.writable(job.id);
  await this.membership.update(job);await this.workspace.writeMetadata(this.file(job.id),JSON.stringify(job));
  await this.announce(job);
 }
 async announce(job){
  const observation=jobSummary(job);
  await this.workspace.afterCommit(()=>{try{this.observe(observation);}catch{/* Observation cannot revoke a committed job. */}});
 }
 async transaction(fn){
  // Serialize this worker's heartbeat and command writes; the database still
  // fences competing processes. Observers are invoked after the commit.
  if(jobWrites.getStore()===this)throw new AppError('LOCKED');
  const pending=this.pendingWrite.then(()=>jobWrites.run(this,async()=>{
   for(let i=0;;i++)try{return await this.workspace.withLock(()=>withWorkspaceMetadataBatch(this.workspace,fn));}catch(error){if(error.code!=='LOCKED'||i===4)throw error;await pause(20*(i+1));}
  }));
  this.pendingWrite=pending.catch(()=>{});return pending;
 }
 definition(job){const definition=Object.hasOwn(this.definitions,job.type)?this.definitions[job.type]:null;if(!definition)throw new AppError('JOB_UNSUPPORTED');return definition;}
 async authorize(job){await this.definition(job).authorize(job);}
 async enqueue(intent){return this.transaction(()=>this.enqueueLocked(intent));}
 // For domain commands that persist their input and enqueue in the same transaction.
 async enqueueLocked({id=randomUUID(),type,scope,input}){
  if(!researchId(id)||!researchId(scope)||!input||typeof input!=='object'||Array.isArray(input))throw new AppError('INVALID');
  if(typeof type!=='string'||!type||type.length>100||!Number.isSafeInteger(input.size??0)||(input.size??0)<0)throw new AppError('INVALID');
  const intent={id,type,scope,input};await this.relocations.writable(id);await this.authorize(intent);
   const previous=await this.read(id);if(previous){if(!same({type:previous.type,scope:previous.scope,input:previous.input},{type,scope,input}))throw new AppError('JOB_CHANGED');return previous;}
   const now=new Date(await this.now()).toISOString(),job={format:1,...intent,state:'queued',attempt:0,lease:null,cancelRequested:false,progress:{stage:'queued',done:0,total:input.size??0},result:null,error:null,createdAt:now,updatedAt:now};
   await this.write(job);return job;
 }
 async claim(){
  // Idle workers must not acquire the workspace writer lock. Recheck the queue
  // inside the transaction whenever there is work, including expired leases.
  if(!await this.workspace.catalogue(async()=>this.membership.candidate(await this.now())))return null;
  return this.transaction(async()=>{
   const now=await this.now(),id=await this.membership.candidate(now);
   if(id){
    const job=await this.read(id);if(!job||terminal.has(job.state))throw new AppError('JOB_DAMAGED');
    if(job.state==='running'&&job.lease.until>now)throw new AppError('JOB_DAMAGED');
    if(job.cancelRequested){job.state='cancelled';job.lease=null;job.updatedAt=new Date(now).toISOString();await this.write(job);return null;}
    try{await this.authorize(job);}catch(error){job.state='failed';job.error=safeError(error).code;job.lease=null;job.updatedAt=new Date(now).toISOString();await this.write(job);return null;}
    job.state='running';job.attempt++;job.progress={...job.progress,stage:'preparing',done:0};job.lease={token:randomUUID(),until:now+this.leaseMs};job.updatedAt=new Date(now).toISOString();job.error=null;
    await this.write(job);return job;
   }
   return null;
  });
 }
 async held(id,token){await this.relocations.writable(id);const job=await this.read(id),now=await this.now();
  if(!job||job.state!=='running'||job.lease.token!==token||job.lease.until<=now)throw new AppError('JOB_LEASE');
  if(job.cancelRequested)throw new AppError('JOB_CANCELLED');return {job,now};
 }
 async pulse(id,token,progress){return this.transaction(async()=>{
  const {job,now}=await this.held(id,token);if(progress){if(!Number.isSafeInteger(progress.done)||!Number.isSafeInteger(progress.total)||progress.done<0||progress.done>progress.total||typeof progress.stage!=='string'||progress.stage.length>80)throw new AppError('INVALID');job.progress=progress;}
  job.lease.until=now+this.leaseMs;job.updatedAt=new Date(now).toISOString();await this.write(job);return job;
 });}
 async complete(id,token,prepared,{signal}={}){
  // Opted-in domains may finish expensive immutable-source proofs without
  // occupying the serialized writer. The final transaction rechecks the lease.
  const initial=await this.read(id);if(!initial)throw new AppError('JOB_LEASE');const beforeComplete=this.definition(initial).beforeComplete;
  if(beforeComplete){const {job}=await this.held(id,token);await this.authorize(job);prepared=await beforeComplete(job,prepared,{signal});}
  signal?.throwIfAborted();
  const job=await this.transaction(async()=>{
   signal?.throwIfAborted();const {job}=await this.held(id,token);await this.authorize(job);
   job.result=await this.definition(job).commit(job,prepared);job.state='completed';job.progress={...job.progress,stage:'completed',done:job.progress.total};job.lease=null;job.updatedAt=new Date(await this.now()).toISOString();
   await this.write(job);return job;
  });
  // Cleanup belongs to the completed result, not the serialized job writer.
  // Direct callers still await it; other controls and heartbeats may proceed.
  try{await this.definition(job).afterComplete?.(job);}catch{/* Cleanup cannot revoke a committed job. */}
  return job;
 }
 async release(id,token,{error=null,paused=false}={}){return this.transaction(async()=>{
  await this.relocations.writable(id);const job=await this.read(id);if(!job||job.state!=='running'||job.lease.token!==token)return job;
  job.state=job.cancelRequested?'cancelled':paused?'queued':'failed';job.lease=null;job.error=job.state==='failed'?safeError(error??new AppError('IO')).code:null;job.updatedAt=new Date(await this.now()).toISOString();
  await this.write(job);return job;
 });}
 async control(id,action){return this.transaction(()=>this.controlLocked(id,action));}
 async controlLocked(id,action){
  await this.relocations.writable(id);const job=await this.read(id);if(!job)throw new AppError('NOT_FOUND');await this.authorize(job);
  if(action==='cancel'){
   if(job.state==='completed'||job.state==='cancelled')return job;
   job.cancelRequested=true;if(job.state!=='running')job.state='cancelled';
  }else if(action==='retry'){
   if(!['failed','cancelled'].includes(job.state))throw new AppError('JOB_CHANGED');
   job.state='queued';job.cancelRequested=false;job.error=null;job.lease=null;
  }else throw new AppError('INVALID');
  job.updatedAt=new Date(await this.now()).toISOString();await this.write(job);return job;
 }
}
export class JobWorker{
 constructor(queue,{pollMs=1000}={}){this.queue=queue;this.pollMs=pollMs;this.enabled=false;this.active=null;this.running=null;this.timer=null;this.controller=null;}
 start(){if(this.enabled)return;this.enabled=true;this.wake();}
 wake(){if(!this.enabled||this.running)return;clearTimeout(this.timer);this.timer=setTimeout(()=>this.tick(),0);this.timer.unref();}
 tick(){if(!this.enabled||this.running)return;
  this.running=withoutWriterWait(()=>this.runOnce()).catch(()=>{/* The durable lease survives service/database interruption. */}).finally(()=>{this.running=null;if(this.enabled){this.timer=setTimeout(()=>this.tick(),this.pollMs);this.timer.unref();}});
 }
 async runOnce(){
  const job=await this.queue.claim();if(!job)return;this.active=job;const controller=this.controller=new AbortController();let pulse=Promise.resolve(),lastProgress=0;
  const refresh=progress=>{pulse=pulse.then(()=>this.queue.pulse(job.id,job.lease.token,progress));pulse.catch(error=>controller.abort(error));return pulse;};
  const heartbeat=setInterval(()=>{void refresh().catch(()=>{});},Math.max(100,this.queue.leaseMs/3));heartbeat.unref();
  try{
   if(!this.enabled)controller.abort();
   const prepared=await this.queue.definition(job).prepare(job,{signal:controller.signal,progress:async progress=>{if(Date.now()-lastProgress<250&&progress.done!==progress.total)return;lastProgress=Date.now();await refresh(progress);}});
   if(!this.queue.definition(job).beforeComplete)clearInterval(heartbeat);await pulse;controller.signal.throwIfAborted();await this.queue.complete(job.id,job.lease.token,prepared,{signal:controller.signal});
  }catch(error){clearInterval(heartbeat);await pulse.catch(()=>{});await this.queue.release(job.id,job.lease.token,{error,paused:!this.enabled}).catch(()=>{});}
  finally{clearInterval(heartbeat);await pulse.catch(()=>{});await this.queue.definition(job).discard?.(job).catch(()=>{});this.active=null;this.controller=null;}
 }
 async stop(){this.enabled=false;clearTimeout(this.timer);this.controller?.abort();await this.running;}
 cancel(id){if(this.active?.id===id)this.controller?.abort(new AppError('JOB_CANCELLED'));}
}

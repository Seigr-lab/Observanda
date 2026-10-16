// Bounded request-owned project snapshots for historical workspace reads.
// Access is checked for every read; idle owners are evicted without content limits.
import {ProjectSessionOwner} from './project-session-owner.js';
import {withRetiredProjectRecords} from './project-retired-records.js';
import {AppError} from './errors.js';
export class ProjectHistoryReaders{
 constructor(application,client,{check=async()=>{}}={}){this.application=application;this.client=client;this.check=check;this.registry={workspace:application.workspace};this.owners=new Map();this.waiters=new Set();this.closed=false;}
 wake(){for(const wake of this.waiters)wake();this.waiters.clear();}
 async acquire(id){
  for(;;){
   await this.check();if(this.closed||this.application.closed)throw new AppError('ACCESS_LOCKED');
   let entry=this.owners.get(id);if(entry?.closing){await entry.closing;continue;}if(entry){this.owners.delete(id);this.owners.set(id,entry);entry.uses++;return entry;}
   if(this.owners.size<4){entry={owner:new ProjectSessionOwner(this.application,this.client,id,{check:this.check}),uses:1};this.owners.set(id,entry);return entry;}
   const idle=[...this.owners].find(([,entry])=>!entry.uses&&!entry.closing);
   if(idle){idle[1].closing=idle[1].owner.close().finally(()=>{this.owners.delete(idle[0]);this.wake();});await idle[1].closing;continue;}
   await new Promise(resolve=>this.waiters.add(resolve));
  }
 }
 withProject(id,read,options){return this.application.tracked(async()=>{
  if(options?.action!=='read')throw new AppError('ACCESS_DENIED');let entry;
  try{entry=await this.acquire(id);return await entry.owner.read(read,options);}
  catch(error){if(['ACCESS_LOCKED','ACCESS_DENIED','ACCESS_WAIT','AUTH','DEVICE_UNKNOWN'].includes(error.code))error.projectId=id;throw error;}
  finally{if(entry)entry.uses--;this.wake();}
 },id);}
 async close(){
  this.closed=true;this.wake();while([...this.owners.values()].some(entry=>entry.uses))await new Promise(resolve=>this.waiters.add(resolve));
  const results=await Promise.allSettled([...this.owners.values()].map(entry=>entry.closing??entry.owner.close()));this.owners.clear();const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
 }
}
export async function withProjectHistoryAccess(application,client,operation,options){
 if(!application.workspace?.vault?.key)return operation();const readers=new ProjectHistoryReaders(application,client,options);
 try{return await withRetiredProjectRecords(application.workspace,readers,operation);}finally{await readers.close();}
}

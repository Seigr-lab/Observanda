// A surviving file is not an owner. The operating system releases the lease
// when the helper sees EOF, including abrupt termination of the application.
import {lstat} from 'node:fs/promises';
import {AsyncLocalStorage} from 'node:async_hooks';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
import {AppError} from './errors.js';

const pending=new Map(),owners=new AsyncLocalStorage();
export const writerLeaseHeld=file=>owners.getStore()?.get(file)?.active===true;
// Only a verified move/deletion may release its own lease, after persisting a
// marker which prevents subsequent writers from entering the retired source.
export async function releaseWriterLease(file){await owners.getStore()?.get(file)?.();}
// A lease path is a single regular file; links, folders and other entries are refused.
async function assertLeaseFile(file){
 let stat;try{stat=await lstat(file);}catch(error){if(error.code==='ENOENT')return;throw error;}
 if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink>1)throw new AppError('UNSAFE');
}
export async function withWriterLease(file,operation,{wait=true}={}){
 if(!wait&&pending.has(file))throw new AppError('LOCKED');
 if(owners.getStore()?.has(file))throw new AppError('LOCKED');
 const previous=pending.get(file)??Promise.resolve();
 const task=previous.catch(()=>{}).then(async()=>{
  await assertLeaseFile(file);
  const lease=await workspaceDatabaseLease(null,{file,busyCode:'LOCKED'});
  const close=()=>{close.active=false;return lease.close();};close.active=true;
  try{return await owners.run(new Map([...(owners.getStore()??[]),[file,close]]),operation);}
  finally{await close();}
 });
 pending.set(file,task);try{return await task;}finally{if(pending.get(file)===task)pending.delete(file);}
}

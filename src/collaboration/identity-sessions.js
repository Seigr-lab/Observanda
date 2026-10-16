import path from 'node:path';
import {mkdir,readFile,realpath} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {assertRegular,atomicWrite,serialize} from '../storage.js';
import {identityLease} from './identity-lease.js';
import {AppError} from '../errors.js';
import {exact,uuid} from '../modules/validation.js';

const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw new AppError('COLLABORATION_IDENTITY_BUSY');}};
export async function identitySession(device){
 if(!device.available())return {close:async()=>{},exclusive:async()=>{throw new AppError('DEVICE_UNAVAILABLE');}};
 await mkdir(path.dirname(device.file),{recursive:true,mode:0o700});await assertRegular(path.dirname(device.file),{directory:true});
 const base=path.join(await realpath(path.dirname(device.file)),path.basename(device.file)),file=base+'.collaboration-sessions',id=randomUUID();let closed=false;
 async function locked(fn){
  const lease=await identityLease(base+'.sessions',{lockFile:base+'.session.lock'});
  try{
   const stat=await assertRegular(file,{missing:true});let sessions=[];
   if(stat){if(stat.size>32768)throw new AppError('COLLABORATION_IDENTITY_BUSY');try{sessions=JSON.parse(await readFile(file,'utf8'));if(!Array.isArray(sessions)||sessions.length>64||sessions.some(s=>!exact(s,['id','pid'])||!uuid(s.id)||!Number.isSafeInteger(s.pid)||s.pid<1))throw Error();}catch{throw new AppError('COLLABORATION_IDENTITY_BUSY');}}
   sessions=sessions.filter(s=>alive(s.pid));return await fn(sessions);
  }finally{await lease.close();}
 }
 await locked(async sessions=>{if(sessions.length>=64)throw new AppError('LIMIT');await atomicWrite(file,serialize([...sessions,{id,pid:process.pid}]));});
 return {
  exclusive:fn=>locked(async sessions=>{if(closed||!sessions.some(s=>s.id===id)||sessions.some(s=>s.id!==id))throw new AppError('COLLABORATION_IDENTITY_BUSY');return fn();}),
  close:async()=>{if(closed)return;await locked(async sessions=>{if(sessions.some(s=>s.id===id))await atomicWrite(file,serialize(sessions.filter(s=>s.id!==id)));});closed=true;}
 };
}

// A temporary query database belongs to a guardian process. Its IPC channel is
// the application lifetime: disconnect closes PostgreSQL and removes only the
// temporary directory the guardian created, including after abrupt parent exit.
import {fork} from 'node:child_process';
import {AppError} from './errors.js';
import path from 'node:path';
import {stat} from 'node:fs/promises';
import {managedSharedBuffers} from './postgres-runtime.js';
import {nativeResources,databaseMemoryReservation} from './native-resource-budget.js';

export async function startScratchPostgres({runtimeDirectory,env=process.env,signal,onProgress=()=>{}}){
 signal?.throwIfAborted();
 const childEnv={...env};delete childEnv.OBSERVANDA_DATABASE_URL;
 const reservation=nativeResources.reserve('database',databaseMemoryReservation(managedSharedBuffers(childEnv)));
 // On Windows the guardian must outlive the parent's process group long
 // enough to handle IPC EOF. It remains hidden and exits after cleanup.
 let child;try{child=fork(new URL('./scratch-postgres-worker.js',import.meta.url),[],{windowsHide:true,detached:true,execArgv:[],env:childEnv,stdio:['ignore','ignore','ignore','ipc']});}catch(error){reservation.release();throw error;}
 let root,ready=false,failure,resolveReady,rejectReady,closing=false;
 const started=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
 const finishCapacity=async()=>{
  if(!root){reservation.release();return;}
  try{await stat(path.join(root,'data','postmaster.pid'));reservation.uncertainExit();}
  catch(error){if(error.code==='ENOENT')reservation.release();else reservation.uncertainExit();}
 };
 const exited=new Promise(resolve=>{
  child.once('error',()=>{failure=new AppError('DATABASE_RUNTIME');rejectReady(failure);if(!child.pid)void finishCapacity().then(resolve);else stop();});
  child.once('exit',code=>{if(code!==0)failure??=new AppError('DATABASE_RUNTIME');if(!ready)rejectReady(failure??new AppError(signal?.aborted?'DATABASE_CANCELLED':'DATABASE_RUNTIME'));void finishCapacity().then(resolve);});
 });
 const stop=()=>{if(closing)return;closing=true;if(child.connected)child.send({type:'close'},()=>{});};
 const abort=()=>stop();signal?.addEventListener('abort',abort,{once:true});
 child.on('message',message=>{
  try{
   if(message?.type==='created'){root=message.root;return;}
   if(message?.type==='progress'){onProgress(message.progress);return;}
   if(message?.type==='error'){failure=new AppError(message.code==='DATABASE_CANCELLED'?'DATABASE_CANCELLED':'DATABASE_RUNTIME');rejectReady(failure);return;}
   if(message?.type!=='ready'||ready||typeof root!=='string'||typeof message.url!=='string')throw new AppError('DATABASE_RUNTIME');
   ready=true;resolveReady(message.url);
  }catch(error){failure=error;rejectReady(error);stop();}
 });
 child.send({type:'start',runtimeDirectory},error=>{if(error){failure=new AppError('DATABASE_RUNTIME');rejectReady(failure);stop();}});
 try{
  if(signal?.aborted)stop();const url=await started;signal?.throwIfAborted();
  const environment={...childEnv,OBSERVANDA_DATABASE_URL:url};let close;
  // A vanished guardian invalidates the reusable environment immediately.
  void exited.then(()=>{delete environment.OBSERVANDA_DATABASE_URL;signal?.removeEventListener('abort',abort);});
  return {root,env:environment,service:{close:()=>close??=(async()=>{stop();await exited;if(failure)throw failure;})()}};
 }catch(error){stop();await exited;signal?.removeEventListener('abort',abort);throw signal?.aborted?new AppError('DATABASE_CANCELLED'):error;}
}

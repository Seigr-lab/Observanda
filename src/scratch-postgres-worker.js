// This helper owns a temporary cluster, never a workspace or project database.
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,realpath} from 'node:fs/promises';
import {startManagedPostgres} from './postgres-runtime.js';
import {AppError} from './errors.js';
import {runtimeStorageDirectory} from './database-runtime-environment.js';
import {nativeMember,withNativeTree} from './native-storage-tree.js';
import {removeNativeRuntimeTree} from './postgres-runtime-files.js';
const controller=new AbortController();let root,container,parent,identity,service,starting=false,stopping=false,finished;
const send=message=>{if(process.connected)process.send(message,()=>{});};
async function clean(){
 if(!container)return;
 if(path.dirname(container)!==parent||!path.basename(container).startsWith('observanda-query-work-'))throw new AppError('UNSAFE');
 // A failed shutdown is recoverable. Never erase a cluster that still has a
 // server identity; normal pg_ctl shutdown removes this file before returning.
 await withNativeTree(container,async(directory,{parent,name})=>{
  if(!directory)return;if(directory.identity!==identity)throw new AppError('UNSAFE');
  if(await nativeMember(directory,'database/data/postmaster.pid',(folder,member)=>folder?.stat(member,{missing:true}),{missing:true}))throw new AppError('DATABASE_RUNNING');
  await directory.close();await removeNativeRuntimeTree(parent,name,{identity});
 },{missing:true});
}
function finish(error){return finished??=(async()=>{
 let failure=error;
 try{await service?.close();await clean();}catch(caught){failure??=caught;}
 if(failure){send({type:'error',code:controller.signal.aborted&&!service?'DATABASE_CANCELLED':'DATABASE_RUNTIME'});process.exitCode=1;}
 if(process.connected)process.disconnect();
})();}
function stop(){stopping=true;controller.abort();if(!starting)void finish();}
process.on('disconnect',stop);process.on('SIGTERM',stop);process.on('SIGINT',stop);
process.on('message',message=>{
 if(message?.type==='close'){stop();return;}
 if(message?.type!=='start'||starting||root||stopping){void finish(new AppError('INVALID'));return;}
 starting=true;
 void (async()=>{
  try{
   parent=await realpath(os.tmpdir());container=await mkdtemp(path.join(parent,'observanda-query-work-'));root=path.join(container,'database');await withNativeTree(container,async directory=>{identity=directory.identity;});send({type:'created',root});
   controller.signal.throwIfAborted();
   service=await startManagedPostgres({directory:root,runtimeDirectory:message.runtimeDirectory,env:process.env,signal:controller.signal,onProgress:progress=>send({type:'progress',progress})});
   if(!stopping)send({type:'ready',url:process.env.OBSERVANDA_DATABASE_URL,directory:runtimeStorageDirectory(process.env)});
  }catch(error){stopping=true;await finish(error);}
  finally{starting=false;if(stopping)await finish();}
 })();
});

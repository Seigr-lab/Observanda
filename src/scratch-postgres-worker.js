// This helper owns a temporary cluster, never a workspace or project database.
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {startManagedPostgres} from './postgres-runtime.js';
import {assertRegular} from './storage.js';
import {AppError} from './errors.js';
const controller=new AbortController();let root,parent,identity,service,starting=false,stopping=false,finished;
const send=message=>{if(process.connected)process.send(message,()=>{});};
async function clean(){
 if(!root)return;
 const stat=await assertRegular(root,{directory:true,missing:true});if(!stat)return;
 if(path.dirname(root)!==parent||!path.basename(root).startsWith('observanda-query-work-')||await realpath(root)!==root||String(stat.dev)!==identity.dev||String(stat.ino)!==identity.ino)throw new AppError('UNSAFE');
 // A failed shutdown is recoverable. Never erase a cluster that still has a
 // server identity; normal pg_ctl shutdown removes this file before returning.
 if(await assertRegular(path.join(root,'data','postmaster.pid'),{missing:true}))throw new AppError('DATABASE_RUNNING');
 await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
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
   parent=await realpath(os.tmpdir());root=await mkdtemp(path.join(parent,'observanda-query-work-'));const stat=await assertRegular(root,{directory:true});identity={dev:String(stat.dev),ino:String(stat.ino)};send({type:'created',root});
   controller.signal.throwIfAborted();
   service=await startManagedPostgres({directory:root,runtimeDirectory:message.runtimeDirectory,env:process.env,signal:controller.signal,onProgress:progress=>send({type:'progress',progress})});
   if(!stopping)send({type:'ready',url:process.env.OBSERVANDA_DATABASE_URL});
  }catch(error){stopping=true;await finish(error);}
  finally{starting=false;if(stopping)await finish();}
 })();
});

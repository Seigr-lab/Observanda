import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {diagnosticCount} from './operational-diagnostics.js';
import {mutationFilesClient} from './mutation-files-client.js';
export async function posixMutationFiles(){
 // Packaged and development artifacts are built from the same reviewed source.
 // Missing native support fails closed, never back to pathname mutations.
 const packaged=new URL('../runtime/mutation-files.node',import.meta.url),development=new URL('../.local/native-filesystem/'+process.platform+'-'+process.arch+'/mutation-files.node',import.meta.url);
 let library;try{await access(packaged);library=fileURLToPath(packaged);}catch(error){if(error.code!=='ENOENT')throw error;library=fileURLToPath(development);}
 const worker=fork(new URL('./security/mutation-files-posix-worker.js',import.meta.url),[library],{serialization:'advanced',stdio:['ignore','ignore','ignore','ipc'],windowsHide:true,execArgv:[]});let receiver,failed,serial=Promise.resolve();
 const exited=new Promise(resolve=>{worker.once('exit',resolve);worker.once('error',resolve);});
 const terminate=()=>{worker.kill('SIGKILL');return exited;};
 const fail=error=>{failed??=error;receiver?.reject(failed);receiver=null;};
 worker.on('error',fail);worker.on('exit',()=>fail(new AppError('IO')));
 worker.on('message',message=>{if(Object.hasOwn(message,'progress')){try{receiver?.onProgress?.(message.progress);}catch(error){fail(error);void terminate();}return;}const current=receiver;receiver=null;if(!current){fail(new AppError('IO'));void terminate();return;}if(message.error){const error=new AppError(message.error);error.code=message.error;current.reject(error);}else current.resolve(message);});
 const response=onProgress=>failed?Promise.reject(failed):new Promise((resolve,reject)=>{receiver={resolve,reject,onProgress};});
 const timeout=setTimeout(()=>{fail(new AppError('IO'));void terminate();},15000);
 try{const ready=await response();if(ready.ready!==true)throw new AppError('IO');}catch(error){await terminate();throw error;}finally{clearTimeout(timeout);}
 async function request(command,onProgress){if(failed)throw failed;const pending=response(onProgress);worker.send(command,error=>{if(error)fail(error);});return (await pending).result;}
 async function execute(command,{stream,onProgress,signal,onWrite=(size,write)=>write()}={}){
  signal?.throwIfAborted();if(failed)throw failed;diagnosticCount('nativeFilesystemRequests');if(['root','directory'].includes(command.operation))diagnosticCount('nativeDirectoryRequests');
  const abort=()=>{fail(signal.reason);void terminate();};signal?.addEventListener('abort',abort,{once:true});
  try{
   if(!stream)return await request(command,onProgress);
   if(command.operation==='file-write'){for await(const data of stream)return await request({...command,data},onProgress);throw new AppError('INVALID');}
   if(command.operation!=='write')throw new AppError('INVALID');
   const target=await request({...command,operation:'file-open',mode:'exclusive'}),sha=createHash('sha256');let position=0,reported=0,complete=false;
   try{for await(const value of stream){if(!(value instanceof Uint8Array))throw new AppError('INVALID');for(let offset=0;offset<value.length;offset+=1048576){signal?.throwIfAborted();const data=value.subarray(offset,offset+1048576);if(position+data.length>command.bytes)throw new AppError('STORAGE_COPY');sha.update(data);await onWrite(data.length,()=>request({operation:'file-write',directory:target.id,position,data}));position+=data.length;if(position-reported>=8388608){onProgress?.(position);reported=position;}}}
    if(position!==command.bytes||sha.digest('hex')!==command.sha256)throw new AppError('STORAGE_COPY');await request({operation:'file-sync',directory:target.id});complete=true;return {bytes:position,sha256:command.sha256};
   }finally{if(!failed){await request({operation:'close',directory:target.id});if(!complete)await request({operation:'delete',directory:command.directory,name:command.name,identity:target.identity});}}
  }finally{signal?.removeEventListener('abort',abort);}
 }
 const call=(command,options)=>{const pending=serial.then(()=>execute(command,options));serial=pending.catch(()=>{});return pending;};
 return mutationFilesClient((command,options)=>failed&&command.operation==='close'?Promise.resolve():call(command,options),async()=>{await serial;if(worker.connected)worker.disconnect();await exited;});
}

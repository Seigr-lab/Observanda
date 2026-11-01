import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {StringDecoder} from 'node:string_decoder';
import {AppError} from './errors.js';
import {mutationFilesClient} from './mutation-files-client.js';
import {diagnosticCount} from './operational-diagnostics.js';

const codes=new Set(['INVALID','UNSAFE','CONFLICT','ENOENT','EEXIST','ENOSPC','ENOTEMPTY','EBUSY','EACCES','LOCAL_EXPORT_CHANGED','STORAGE_COPY']);
const wireError=value=>{const code=codes.has(value)?value:'UNSAFE',error=new AppError(code);error.code=code;return error;};

export async function windowsMutationFiles(){
 const child=spawn(path.join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./security/mutation-files.ps1',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','ignore']});
 let receiver,failed,serial=Promise.resolve(),text='',closing;const decoder=new StringDecoder('utf8'),inbox=[];
 const fail=error=>{failed??=error;receiver?.reject(failed);receiver=null;};
 const exited=new Promise(resolve=>{child.once('exit',()=>{fail(new AppError('IO'));resolve();});child.once('error',()=>{fail(new AppError('IO'));resolve();});});
 child.stdin.on('error',()=>fail(new AppError('IO')));
 child.stdout.on('data',bytes=>{
  text+=decoder.write(bytes);if(text.length>262144){fail(new AppError('UNSAFE'));child.kill();return;}
  for(let end;(end=text.indexOf('\n'))>=0;){const line=text.slice(0,end);text=text.slice(end+1);let value;try{value=JSON.parse(line);}catch{fail(new AppError('UNSAFE'));child.kill();return;}
   if(!receiver){if(inbox.length>=2){fail(new AppError('UNSAFE'));child.kill();return;}inbox.push(value);continue;}
   if(Object.hasOwn(value,'progress')){try{receiver.progress?.(value.progress);}catch(error){fail(error);child.kill();}continue;}
   const current=receiver;receiver=null;
   if(value.error)current.reject(wireError(value.error));else current.resolve(value);
  }
 });
 const response=progress=>{if(failed)return Promise.reject(failed);if(receiver)throw new AppError('IO');if(inbox.length){const value=inbox.shift();return value.error?Promise.reject(wireError(value.error)):Promise.resolve(value);}return new Promise((resolve,reject)=>{receiver={resolve,reject,progress};});};
 const timer=setTimeout(()=>{fail(new AppError('IO'));child.kill();},15000);
 try{const ready=await response();if(ready.ready!==true)throw new AppError('IO');}catch(error){child.stdin.end();child.kill();await exited;throw error;}finally{clearTimeout(timer);}
 const send=bytes=>new Promise((resolve,reject)=>child.stdin.write(bytes,error=>error?reject(error):resolve()));
 async function execute(command,{stream,onProgress,signal,onWrite=(size,write)=>write()}={}){
  signal?.throwIfAborted();if(failed)throw failed;
  diagnosticCount('nativeFilesystemRequests');if(['root','directory'].includes(command.operation))diagnosticCount('nativeDirectoryRequests');
  const abort=()=>{fail(signal.reason);child.kill();};signal?.addEventListener('abort',abort,{once:true});
  try{
   const first=response(onProgress);void first.catch(()=>{});await send(JSON.stringify(command)+'\n');
   if(!stream){const value=await first;if(!Object.hasOwn(value,'result'))throw new AppError('IO');return value.result;}
   const ready=await first;if(ready.ready!==true)throw new AppError('IO');
   const done=response(onProgress);void done.catch(()=>{});let bytes=0;
   try{for await(const chunk of stream){signal?.throwIfAborted();if(!Buffer.isBuffer(chunk)&&!(chunk instanceof Uint8Array))throw new AppError('INVALID');bytes+=chunk.length;if(bytes>command.bytes)throw new AppError('STORAGE_COPY');
     for(let offset=0;offset<chunk.length;offset+=1048576){const part=chunk.subarray(offset,offset+1048576);await onWrite(part.length,()=>send(part));}
    }
    if(bytes!==command.bytes)throw new AppError('STORAGE_COPY');
   }catch(error){fail(error);child.kill();throw error;}
   return (await done).result;
  }finally{signal?.removeEventListener('abort',abort);}
 }
 const call=async(command,options)=>{const task=serial.then(()=>execute(command,options));serial=task.catch(()=>{});try{return await task;}catch(cause){if(!(cause instanceof AppError))throw cause;const error=new AppError(cause.code);error.code=cause.code;error.cause=cause;throw error;}};
 return mutationFilesClient((command,options)=>failed&&command.operation==='close'?Promise.resolve():call(command,options),()=>closing??=(async()=>{await serial;child.stdin.end();await exited;})());
}

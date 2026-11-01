import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {StringDecoder} from 'node:string_decoder';
import {AppError} from './errors.js';
import {AsyncLocalStorage} from 'node:async_hooks';
const active=new AsyncLocalStorage();
export async function withWindowsMutationFiles(operation){const existing=active.getStore();if(existing)return operation(existing);const service=await windowsMutationFiles();try{return await active.run(service,()=>operation(service));}finally{await service.close();}}
export const withMutationFilesSession=operation=>process.platform==='win32'?withWindowsMutationFiles(operation):operation(null);

const codes=new Set(['INVALID','UNSAFE','CONFLICT','ENOENT','EEXIST','ENOSPC','ENOTEMPTY','EBUSY','LOCAL_EXPORT_CHANGED','STORAGE_COPY']);
const wireError=value=>{const code=codes.has(value)?value:'UNSAFE',error=new AppError(code);error.code=code;return error;};
const missing=(error,allowed)=>{if(allowed&&error.code==='ENOENT')return null;throw error;};
function name(value){if(typeof value!=='string'||!value||value==='.'||value==='..'||/[\\/\0]/.test(value))throw new AppError('UNSAFE');return value;}

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
 const call=(command,options)=>{const task=serial.then(()=>execute(command,options));serial=task.catch(()=>{});return task;};
 const handles=new Set();
 class Directory{
  constructor({id,identity}){this.id=id;this.identity=identity;this.closed=false;handles.add(this);}
  request(operation,data={},options){if(this.closed)throw new AppError('IO');return call({operation,directory:this.id,...data},options);}
  async directory(member,{create=false,missing:optional=false}={}){try{return new Directory(await this.request('directory',{name:name(member),create}));}catch(error){return missing(error,optional);}}
  async stat(member,{folder=false,links=false,missing:optional=false}={}){try{return await this.request('stat',{name:name(member),folder,links});}catch(error){return missing(error,optional);}}
  async hash(member,{links=false,missing:optional=false}={}){try{return await this.request('hash',{name:name(member),links});}catch(error){return missing(error,optional);}}
  async *entries(){let restart=true;for(;;){const page=await this.request('list',{restart});if(!page||!Array.isArray(page.entries)||typeof page.done!=='boolean')throw new AppError('UNSAFE');for(const entry of page.entries)yield entry;if(page.done)return;restart=false;}}
  write(member,stream,{bytes,sha256,...options}){return this.request('write',{name:name(member),bytes,sha256},{...options,stream});}
  copy(source,sourceName,member,{bytes,sha256,...options}){if(!handles.has(source)||source.closed)throw new AppError('UNSAFE');return this.request('copy',{sourceDirectory:source.id,source:name(sourceName),name:name(member),bytes,sha256},options);}
  move(operation,member,target,targetName,{folder=false,links=false,identity}={}){if(!handles.has(target)||target.closed)throw new AppError('UNSAFE');return this.request(operation,{name:name(member),targetDirectory:target.id,target:name(targetName),folder,links,...(identity?{identity}:{})});}
  rename(member,target,targetName,options){return this.move('rename',member,target,targetName,options);}
  link(member,target,targetName,options){return this.move('link',member,target,targetName,options);}
  remove(member,{folder=false,links=false,identity}={}){return this.request('delete',{name:name(member),folder,links,...(identity?{identity}:{})});}
  async close(){if(this.closed)return;this.closed=true;handles.delete(this);if(!failed)await call({operation:'close',directory:this.id});}
 }
 return {async open(root){if(typeof root!=='string'||!path.isAbsolute(root))throw new AppError('UNSAFE');return new Directory(await call({operation:'root',path:root}));},close:()=>closing??=(async()=>{try{for(const handle of [...handles])await handle.close();}finally{await serial;child.stdin.end();await exited;}})()};
}

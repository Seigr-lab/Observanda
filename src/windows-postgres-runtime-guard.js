import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {AppError} from './errors.js';

export const acquireWindowsPostgresRuntimeGuard=({prepared,...options})=>(prepared??prepareWindowsPostgresRuntimeGuard()).acquire(options);
export const inspectWindowsPostgresRuntimeStorage=directory=>windowsRuntimeGuard(launchGuard(),{directory,inspectOnly:true});
export const probeWindowsPostgresRuntimeCreation=(directory,{mapped=false}={})=>windowsRuntimeGuard(launchGuard(),{directory,probeCreate:true,mapped});
// Starting the guard (PowerShell and its compiled helper) takes most of a
// second. A caller may start it before it knows the directory, concurrently
// with other work; admission and every check happen only in acquire().
export function prepareWindowsPostgresRuntimeGuard(){
 let launched=launchGuard(),used=false;
 return {
  acquire(options){if(used)throw new AppError('DATABASE_GUARD_UNAVAILABLE');used=true;const value=launched;launched=null;return windowsRuntimeGuard(value,options);},
  async close(){if(used)return;used=true;const value=launched;launched=null;value.child.stdin.end();value.child.kill();await value.exited;}
 };
}
function launchGuard(){
 const child=spawn(path.join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./security/postgres-runtime-guard.ps1',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 const pending=new Map();let next=0,header='',failed,readyResolve,readyReject,stderr='';
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const fail=error=>{failed??=error;readyReject(failed);for(const item of pending.values())item.reject(failed);pending.clear();};
 const exited=new Promise(resolve=>{child.once('exit',()=>{const error=new AppError('DATABASE_GUARD_UNAVAILABLE');error.diagnostic=stderr;fail(error);resolve();});child.once('error',error=>{fail(new AppError('DATABASE_GUARD_UNAVAILABLE'));resolve();});});
 child.stdin.on('error',()=>fail(new AppError('DATABASE_GUARD_UNAVAILABLE')));child.stderr.on('data',bytes=>{if(stderr.length<8192)stderr+=bytes.toString();});
 child.stdout.on('data',bytes=>{
  try{header+=bytes.toString();if(header.length>262144)throw new AppError('DATABASE_GUARD_UNAVAILABLE');let newline;
   while((newline=header.indexOf('\n'))>=0){const message=JSON.parse(header.slice(0,newline));header=header.slice(newline+1);if(message.ready===true){readyResolve();continue;}const item=pending.get(message.id);if(!item)throw new AppError('DATABASE_GUARD_UNAVAILABLE');pending.delete(message.id);
    // A runtime admission proof made with another workspace key, or copied from
    // another folder, is replaced or damaged data, not a storage limitation.
    if(message.error){const code=message.error==='EBUSY'?'DATABASE_RUNNING':message.reason==='runtime-admission-authentication-failed'?'ENCRYPTION_DAMAGED':['DATABASE_GUARD_STORAGE','DATABASE_GUARD_UNAVAILABLE','STORAGE_COPY','UNSAFE','ENOENT','EEXIST','ENOTEMPTY','LIMIT','CONFLICT'].includes(message.error)?message.error:'DATABASE_GUARD_STORAGE',error=new AppError(code);error.code=code;error.diagnostic=message.diagnostic;if(typeof message.reason==='string')error.reason=message.reason;item.reject(error);}else item.resolve(message.result);
   }
  }catch(error){fail(error);child.kill();}
 });
 function request(operation,data={}){if(failed)return Promise.reject(failed);const id=++next,result=new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));child.stdin.write(JSON.stringify({id,operation,...data})+'\n',error=>{if(error)fail(new AppError('DATABASE_GUARD_UNAVAILABLE'));});return result;}
 const timer=setTimeout(()=>{fail(new AppError('DATABASE_GUARD_UNAVAILABLE'));child.kill();},15000);
 const started=ready.finally(()=>clearTimeout(timer));void started.catch(()=>{});
 return {child,exited,request,started,failure:()=>failed};
}
async function windowsRuntimeGuard(launched,{directory,create=true,parentIdentity,expectedIdentity,creationToken,admissionKey,signal,inspectOnly=false,probeCreate=false,mapped=false}={}){
 const {child,exited,request}=launched;let closing;
 try{signal?.throwIfAborted();await launched.started;}catch(error){child.stdin.end();child.kill();await exited;throw error;}
 if(inspectOnly){try{return await request('inspect',{directory});}finally{child.stdin.end();await exited;}}
 if(probeCreate){try{return await request('probe-create',{directory,mapped});}finally{child.stdin.end();await exited;}}
 let receipt;
 try{receipt=await request('admit',{directory,create,parentIdentity,expectedIdentity,creationToken,admissionKey:admissionKey?.toString('base64')});signal?.throwIfAborted();}
 catch(error){child.stdin.end();await exited;throw error;}
 const close=()=>closing??=(async()=>{let stopped=false;try{if(!launched.failure())stopped=(await request('close')).stopped===true;}finally{child.stdin.end();await exited;}return {stopped};})();
 const relative=file=>{const value=path.relative(directory,path.resolve(file));if(!value||value==='..'||value.startsWith('..'+path.sep)||path.isAbsolute(value))throw new AppError('UNSAFE');return value.split(path.sep).join('/');};
 const file=(action,target,options={})=>request('file',{action,relative:relative(target),...options});
 const optional=async operation=>{try{return await operation();}catch(error){if(error.code==='ENOENT')return null;throw error;}};
 const readIdentified=async(target,limit)=>{const result=await file('read',target,{limit});return {bytes:Buffer.from(result.data,'base64'),identity:result.identity};};
 const files={
  stat:(target,{directory:folder=false,missing=false}={})=>missing?optional(()=>file('stat',target,{folder})):file('stat',target,{folder}),
  readIdentified,
  async read(target,{limit=16384,encoding}={}){const {bytes}=await readIdentified(target,limit);return encoding?bytes.toString(encoding):bytes;},
  write:(target,bytes)=>file('write',target,{data:(Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes,'utf8')).toString('base64')}),
  removeTree:target=>optional(()=>file('remove-tree',target)),rename:(source,target)=>file('rename',source,{folder:true,target:relative(target)}),unlink:target=>optional(()=>file('unlink',target))
 };
 return {directory,identity:receipt.identity,cached:receipt.cached,files,processId:child.pid,inspectSource:(source,{parentIdentity,expectedIdentity})=>request('inspect-source',{source,parentIdentity,expectedIdentity}),sourceFence:(source,options)=>request('source-fence',{source,...options}),lease:{close:async()=>{}},
  stopWitness:receipt.localStopSupported?options=>request('local-stop-witness',options):null,
  async run(command,args,{signal:commandSignal,capture=false,diagnose=false}={}){
   commandSignal?.throwIfAborted();let cancelled;
   const abort=()=>{cancelled??=request('cancel');void cancelled.catch(()=>{});};commandSignal?.addEventListener('abort',abort,{once:true});
   try{const result=await request('run',{command,args,capture,diagnose});await cancelled;if(commandSignal?.aborted)throw new AppError('DATABASE_CANCELLED');if(result.exitCode!==0)throw Object.assign(new AppError('DATABASE_INSTALL'),{exitCode:result.exitCode},result.stderr?{diagnostic:result.stderr}:{});return result.stdout??'';}
   finally{commandSignal?.removeEventListener('abort',abort);}
  },close
 };
}

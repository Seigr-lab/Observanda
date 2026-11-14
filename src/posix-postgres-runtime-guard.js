import path from 'node:path';
import {access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {posixMutationFiles} from './posix-mutation-files.js';
import {AppError} from './errors.js';
import {nativeMember} from './native-storage-tree.js';

const unavailable=()=>new AppError('DATABASE_GUARD_UNAVAILABLE');
export async function acquirePosixPostgresRuntimeGuard({directory,create=true,parentIdentity,expectedIdentity,run,signal}){
 // A pathname sandbox is not an inode-bound substitute on unsupported hosts.
 if(process.platform!=='linux')throw unavailable();
 signal?.throwIfAborted();directory=path.resolve(directory);
 const packaged=new URL('../runtime/postgres-confinement',import.meta.url),development=new URL('../dist/native/'+process.platform+'-'+process.arch+'/postgres-confinement',import.meta.url);
 let launcher;try{await access(packaged);launcher=fileURLToPath(packaged);}catch(error){if(error.code!=='ENOENT')throw error;launcher=fileURLToPath(development);try{await access(launcher);}catch{throw unavailable();}}
 const files=await posixMutationFiles();let parent,root,closed=false;
 try{
  parent=await files.open(path.dirname(directory));if(parentIdentity&&parent.identity!==parentIdentity)throw unavailable();
  root=await parent.directory(path.basename(directory),{create});if(expectedIdentity&&root.identity!==expectedIdentity)throw unavailable();
  const identity=root.identity;
  try{await run(launcher,[directory,identity,'--probe'],{signal});}catch(error){if(signal?.aborted)throw error;throw unavailable();}
  return {directory,identity,async member(relative,operation,options){if(closed)throw unavailable();return nativeMember(root,relative,operation,options);},async assertNamed(){if(closed)throw unavailable();const current=await files.open(directory);try{if(current.identity!==identity)throw unavailable();}finally{await current.close();}},async run(command,args,options={}){
   if(closed||options.inherit)throw unavailable();options.signal?.throwIfAborted();
   // PostgreSQL uses a stable namespace alias, including on later status/stop
   // invocations. The helper compares the admitted inode before every launch.
   const rewrite=value=>String(value).replaceAll(directory+'/','/observanda/').replaceAll('='+directory,'=/observanda');
   const mapped=args.map(value=>String(value)===directory?'/observanda':rewrite(value));
   try{return await run(launcher,[directory,identity,'--',command,...mapped],options);}catch(error){if(error.exitCode===125)throw unavailable();throw error;}
  },async close(){if(closed)return;closed=true;await files.close();}};
 }catch(error){await root?.close().catch(()=>{});await parent?.close().catch(()=>{});await files.close().catch(()=>{});throw error;}
}

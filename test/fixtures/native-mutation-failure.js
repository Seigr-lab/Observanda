import path from 'node:path';
import {withMutationFilesSession} from '../../src/mutation-files.js';

// Fault injection wraps the public native adapter for this asynchronous scope.
// The same fault boundary applies to all supported native filesystems.
export function nativeMutationFailure(check,operation){
 return withMutationFilesSession(async service=>{
  if(!service)return operation();
  const open=service.open,wrapped=new WeakSet();
  function wrap(handle,directory){
   if(!handle||wrapped.has(handle))return handle;wrapped.add(handle);
   const child=handle.directory,remove=handle.remove,rename=handle.rename;
   handle.directory=async function(name,options){return wrap(await child.call(this,name,options),path.join(directory,name));};
   handle.remove=async function(name,options){await check('remove',path.join(directory,name));return remove.call(this,name,options);};
   handle.rename=async function(name,...args){await check('rename',path.join(directory,name));return rename.call(this,name,...args);};
   return handle;
  }
  service.open=async directory=>wrap(await open.call(service,directory),directory);
  try{return await operation();}finally{service.open=open;}
 });
}

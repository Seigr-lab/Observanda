import path from 'node:path';
import {opendir} from 'node:fs/promises';
import {setTimeout as pause} from 'node:timers/promises';
import {safeError,AppError} from '../errors.js';
import {checkedSourcePath} from '../migration/source-files.js';
// Polling reconciles additions and modifications even when filesystem watch
// events are coalesced. Notifications never stage, apply or execute anything.
export async function watchIntake(directory,preview,{signal,onNotice,interval=2000,once=false}={}){
 const seen=new Map();
 do{
  signal?.throwIfAborted();await checkedSourcePath(directory);let count=0;const present=new Set();
  for await(const entry of await opendir(directory)){
   signal?.throwIfAborted();if(!entry.isDirectory()||entry.isSymbolicLink())continue;
   if(++count>1000)throw new AppError('LIMIT');present.add(entry.name);
   let notice;try{notice={version:1,ok:true,proposal:await preview(path.join(directory,entry.name))};}catch(error){notice={version:1,ok:false,error:safeError(error)};}
   const identity=JSON.stringify(notice);if(seen.get(entry.name)!==identity){await onNotice({...notice,directory:entry.name});seen.set(entry.name,identity);}
  }
  for(const name of seen.keys())if(!present.has(name))seen.delete(name);
  if(!once)await pause(interval,undefined,{signal});
 }while(!once&&!signal?.aborted);
}

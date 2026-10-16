// Only directory ownership is inspected for a native rename. File contents
// are neither read nor copied. An unregistered nested database cannot travel
// as an incidental directory while its independent process may still be live.
import path from 'node:path';
import {opendir} from 'node:fs/promises';
import {assertRegular} from './storage.js';
import {operationStage,operationAdvance,operationItem} from './operation-progress.js';
import {AppError} from './errors.js';
export async function assertRenameDatabaseOwners(root,projectRoots,{stage='rename-check-owners',errorCode='STORAGE_RENAME_PROJECTS',skipRoots=[]}={}){
 const allowed=new Set([root,...projectRoots]);
 return operationStage(stage,{unit:'folders'},async()=>{
  const pending=[root],running=new Set();let failure;
  const scan=async directory=>{
   await assertRegular(directory,{directory:true});operationItem(path.relative(root,directory));
   for await(const entry of await opendir(directory)){
    if(failure)return;
    if(entry.isSymbolicLink())throw new AppError('UNSAFE');if(!entry.isDirectory())continue;
    const child=path.join(directory,entry.name);await assertRegular(child,{directory:true});
    if(path.basename(directory).toLowerCase()==='.observanda'&&entry.name.toLowerCase()==='postgresql'){
     if(path.basename(directory)!=='.observanda'||entry.name!=='postgresql'||!allowed.has(path.dirname(directory)))throw new AppError(errorCode);continue;
    }
    if(!skipRoots.includes(child))pending.push(child);
   }
   operationAdvance();
  };
  try{
   while(pending.length||running.size){
    if(failure)throw failure;
    while(pending.length&&running.size<16){
     const task=scan(pending.pop());running.add(task);
     task.then(()=>running.delete(task),error=>{failure??=error;running.delete(task);});
    }
    if(running.size)await Promise.race(running);
   }
   if(failure)throw failure;
  }finally{await Promise.allSettled(running);}

 });
}

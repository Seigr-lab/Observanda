import {setTimeout as delay} from 'node:timers/promises';
import {AsyncLocalStorage} from 'node:async_hooks';
import {realpath} from 'node:fs/promises';
import {AppError} from '../errors.js';
const pending=new Map(),owners=new AsyncLocalStorage();
// Same-owner requests wait their turn instead of spending all lock retries
// while an earlier local save is still committing. Different owners stay free.
export async function organizationTransaction(workspace,operation){
 const root=await realpath(workspace.root);if(owners.getStore()?.has(root))throw new AppError('LOCKED');
 const before=pending.get(root)??Promise.resolve();let release;
 const ticket=new Promise(resolve=>{release=resolve;});pending.set(root,ticket);
 try{
  await before;
  return await owners.run(new Set([...(owners.getStore()??[]),root]),async()=>{
   // External writers still have bounded admission retries. Each failed
   // transaction is rolled back before any retry.
   for(let attempt=0;;attempt++){
    try{return await workspace.withLock(operation);}
    catch(error){if(error.code!=='LOCKED'||attempt>=5)throw error;await delay(25*2**attempt);}
   }
  });
 }finally{release();if(pending.get(root)===ticket)pending.delete(root);}
}

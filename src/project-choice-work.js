import {scratchDatabaseEnvironment} from './workspace-database-context.js';
import {runtimeStorageDirectory} from './database-runtime-environment.js';
import {AppError} from './errors.js';
const MiB=1024*1024;
// This is incremental disk admission, not a project/depth limit. PostgreSQL
// owns the encrypted temporary table and closes it before the ticket releases.
export async function withProjectChoiceWork(workspace,operation,{signal}={}){
 const environment=await scratchDatabaseEnvironment(),directory=runtimeStorageDirectory(environment);
 if(!directory)return operation(null);
 const [{withScratch},{diskCapacity},{withStagingCapacity}]=await Promise.all([import('./scratch-work.js'),import('./disk-capacity.js'),import('./staging-reservations.js')]);
 return withStagingCapacity(workspace,async admission=>{
 const ticket=await diskCapacity.reserve(directory,0,{reserveBytes:64*MiB,refreshBytes:MiB,growthBytes:4*MiB,signal,admission});let first=true;
 try{return await withScratch(work=>operation({get:id=>work.get(id),put:async(id,value)=>{
  signal?.throwIfAborted();if(runtimeStorageDirectory(environment)!==directory)throw new AppError('DATABASE_CANCELLED');
  // Reserve initial relation/index pages once, then conservatively account
  // for each encrypted tuple/version and index entry. Rechecking each growth
  // window avoids a filesystem round trip for every small memo insertion.
  const bytes=(first?96*1024:0)+1024+Buffer.byteLength(JSON.stringify(value))*2;
  return ticket.write(bytes,async()=>{await work.put(id,value);first=false;});
 }}),{signal});}finally{ticket.release();}
 },{signal});
}

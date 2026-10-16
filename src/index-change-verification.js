// Compare authenticated roots in key order. Expected changes are independently
// derived into encrypted scratch storage. Each changed branch is read once,
// instead of performing two random tree lookups for every expected key.
import {AppError} from './errors.js';
export async function verifyIndexChanges(index,before,after,expected,check){
 let batch=[];
 const flush=async()=>{
  const ids=batch.map(item=>item.id),values=await expected.getMany(ids);
  for(const change of batch){
   const item=values.get(change.id);if(!item)throw new AppError('CATALOGUE_DAMAGED');
   check(item,change.before?.revision??null,change.after?.revision??null);
  }
  await expected.removeMany(ids);batch=[];
 };
 for await(const change of index.differences(before.root,after.root)){
  batch.push(change);if(batch.length===32)await flush();
 }
 if(batch.length)await flush();
 // The complete comparison proves remaining keys did not change. They still
 // need a point proof: an expected edit must not vanish from both roots.
 for await(const item of expected.items()){
  const revision=(await index.find(before,item.id))?.revision??null;
  check(item,revision,revision);
 }
}

// Shared immutable owners already establish equality. Only differing owners
// need canonical comparison, preserving equality across property reordering.
import {createHash} from 'node:crypto';
export async function changedRecordFields(earlier,latest,fields,{signal}={}){
 const fingerprint=async(document,reference)=>{
  if(reference===null)return null;
  const hash=createHash('sha256');
  for await(const chunk of document.tree.json(reference,{canonical:true,signal}))hash.update(chunk);
  return hash.digest('hex');
 };
 const changed=[];
 for(const name of fields){
  signal?.throwIfAborted();
  const before=await earlier.reference([name],{signal}),after=await latest.reference([name],{signal});
  if(before===after)continue;
  if(await fingerprint(earlier,before)!==await fingerprint(latest,after))changed.push(name);
 }
 return changed;
}

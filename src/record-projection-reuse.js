// Reuse a derived value only when every original owner it depends on retains
// the same immutable reference. Both documents and the query live under the
// same notebook key; no cache survives a save or supplies record evidence.
import {sameCollectionFields} from './record-projection-dependency.js';
export function recordProjectionReuse(document,previous,{signal}={}){
 const unchanged=new Map();
 return async(path,owners,build)=>{
  signal?.throwIfAborted();
  if(previous){
   let same=true;
   for(const owner of owners){
    const key=JSON.stringify(owner);
    if(!unchanged.has(key))unchanged.set(key,Array.isArray(owner)?await document.reference(owner,{signal})===await previous.document.reference(owner,{signal}):await sameCollectionFields(document,previous.document,owner,{signal}));
    if(!unchanged.get(key)){same=false;break;}
   }
   if(same){
    const selected=await previous.tree.select(previous.root,path);
    if(selected)return selected.inline?document.tree.retain(selected.value):selected.revision;
   }
  }
  return build();
 };
}

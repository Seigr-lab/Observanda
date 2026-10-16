// Ordered temporary values reuse the authenticated tree. Neither sort keys nor
// values are stored as plaintext, and only a bounded node cache stays in memory.
import {ObjectIndex} from './object-index.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
export function scratchOrder(work,prefix){
 const hash=value=>digest(serialize(value)),tree=new ObjectIndex(null,{namespace:prefix+'node:',cacheReads:true,nodeStorage:{read:ref=>work.get(prefix+'node:'+ref.key)}});let root=null;
 return {
  async put(id,value){
   await work.put(prefix+'value:'+id,value);root=await tree.change(root,id,hash(value));
   for(const [slot,node] of tree.writes){await work.put(slot,node);tree.cacheNode({key:digest(node.id),hash:hash(node)},node);}
   tree.pending.clear();tree.pendingBytes=0;tree.writes.clear();
  },
  async *items(){for await(const entry of tree.entries({root})){
   const value=await work.get(prefix+'value:'+entry.id);if(value===undefined||hash(value)!==entry.revision)throw new AppError('CATALOGUE_DAMAGED');yield value;
  }}
 };
}

import {materialReference} from './web/material-reference.js';
import {withScratch} from './scratch-work.js';
// Breadth-first traversal keeps pending and visited identities in encrypted
// temporary storage. Only one material document is retained by the visitor.
export function withMaterialTraversal(operation,options={}){
 return withScratch(async work=>{
  const enqueue=ref=>{
   const value=materialReference(ref);
   return work.add(JSON.stringify(value),value);
  };
  return operation({
   get size(){return work.size;},
   reset:()=>work.clear(),
   async walk(seeds,visit){
    for await(const ref of seeds)await enqueue(ref);
    for(;;){const ref=await work.take();if(ref===undefined)return;await visit(ref,enqueue);}
   }
  });
 },options);
}

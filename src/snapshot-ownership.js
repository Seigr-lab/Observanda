// Older membership roots can lack lab-book ownership. Complete the next root
// inside the writer's transaction, without rewriting an earlier snapshot or
// assembling record bodies. Existing declared ownership must still prove valid.
import {SnapshotIndex} from './snapshot-index.js';
import {snapshotTotals} from './catalogue-outline.js';
import {AppError} from './errors.js';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};

export async function hasSnapshotOwnership(store,snapshot){
 if(!snapshot.indexVersion)return false;
 const count=await new SnapshotIndex(store).scopedCount(snapshot.membership);
 if(count>snapshot.count)damaged();return count===snapshot.count;
}
export async function completeSnapshotOwnership(store,snapshot,{signal}={}){
 signal?.throwIfAborted();
 if(await hasSnapshotOwnership(store,snapshot))return snapshot;
 const index=new SnapshotIndex(store),totals=snapshotTotals(snapshot),notebooks=new Set(snapshot.metadata.notebooks.map(n=>n.id));
 const ownership=snapshot.indexVersion?await index.scopedCount(snapshot.membership):0;
 let count=0,bytes=0,known=0;
 async function* rows(){
  for await(const row of store.members(snapshot,{signal})){
   signal?.throwIfAborted();count++;bytes+=row.bytes;
   if(snapshot.indexVersion){
    const book=await index.find({root:snapshot.membership},'book:'+row.notebookId+':'+row.id),record=await index.find({root:snapshot.membership},'record:'+row.id);
    if(!book||book.revision!==record?.revision)damaged();known++;
   }
   if(!notebooks.has(row.notebookId))damaged();
   yield row;
  }
  if(count!==totals.total||bytes!==totals.totalBytes||snapshot.indexVersion&&known!==ownership)damaged();
 }
 const membership=await index.build(rows());signal?.throwIfAborted();
 // Other indexes authenticate the previous member hashes. The normal commit
 // rebuilds them against this root; carrying them across would be inconsistent.
 return {indexVersion:1,metadata:snapshot.metadata,membership,count,bytes,nextPosition:snapshot.nextPosition??count};
}

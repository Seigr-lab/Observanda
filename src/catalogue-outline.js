// Current catalogues count authenticated ownership ranges. Older snapshots
// retain their identity and resolve only missing ownership, one original at a
// time; opening them never falls back to a complete research document.
import {SnapshotIndex} from './snapshot-index.js';
import {AppError} from './errors.js';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export const snapshotTotals=snapshot=>snapshot.indexVersion?{total:snapshot.count,totalBytes:snapshot.bytes}:
 {total:snapshot.records.length,totalBytes:snapshot.records.reduce((sum,row)=>sum+row.bytes,0)};
export async function catalogueOutline(store,snapshot,{signal}={}){
 signal?.throwIfAborted();
 const totals=snapshotTotals(snapshot),notebookCounts=Object.fromEntries(snapshot.metadata.notebooks.map(n=>[n.id,0])),index=new SnapshotIndex(store);
 if(!Number.isSafeInteger(totals.totalBytes)||totals.totalBytes<0)damaged();
 let ownership=0;
 if(snapshot.indexVersion){
  ownership=await index.scopedCount(snapshot.membership);
  if(ownership>totals.total)damaged();
  if(ownership===totals.total){
   for(const id of Object.keys(notebookCounts)){signal?.throwIfAborted();notebookCounts[id]=await index.scopedCount(snapshot.membership,id);}
   if(Object.values(notebookCounts).reduce((a,b)=>a+b,0)!==totals.total)damaged();
   signal?.throwIfAborted();
   return {...totals,notebookCounts};
  }
 }
 let known=0;
 for await(const row of store.members(snapshot,{signal})){
  signal?.throwIfAborted();
  if(snapshot.indexVersion&&row.notebookId!==undefined){
   // Missing ownership on an old member is supported. Missing or substituted
   // index entries for a member that declares ownership are corruption.
   const book=await index.find({root:snapshot.membership},'book:'+row.notebookId+':'+row.id);
   const record=await index.find({root:snapshot.membership},'record:'+row.id);
   if(!book||book.revision!==record?.revision)damaged();known++;
  }
  const notebookId=row.notebookId??(await store.record(row.id,row.revision)).notebookId;
  if(!Object.hasOwn(notebookCounts,notebookId))damaged();notebookCounts[notebookId]++;
 }
 signal?.throwIfAborted();
 if(snapshot.indexVersion&&known!==ownership||Object.values(notebookCounts).reduce((a,b)=>a+b,0)!==totals.total)damaged();
 return {...totals,notebookCounts};
}

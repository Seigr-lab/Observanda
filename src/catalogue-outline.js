// Catalogues count authenticated lab book ownership ranges. Every member carries
// its ownership key, so a count that disagrees with the snapshot is damage;
// opening a catalogue never falls back to scanning originals.
import {SnapshotIndex} from './snapshot-index.js';
import {AppError} from './errors.js';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export const snapshotTotals=snapshot=>({total:snapshot.count,totalBytes:snapshot.bytes});
export async function catalogueOutline(store,snapshot,{signal}={}){
 signal?.throwIfAborted();
 const totals=snapshotTotals(snapshot),notebookCounts=Object.fromEntries(snapshot.metadata.notebooks.map(n=>[n.id,0])),index=new SnapshotIndex(store);
 if(!Number.isSafeInteger(totals.totalBytes)||totals.totalBytes<0)damaged();
 if(await index.scopedCount(snapshot.membership)!==totals.total)damaged();
 for(const id of Object.keys(notebookCounts)){signal?.throwIfAborted();notebookCounts[id]=await index.scopedCount(snapshot.membership,id);}
 if(Object.values(notebookCounts).reduce((a,b)=>a+b,0)!==totals.total)damaged();
 signal?.throwIfAborted();
 return {...totals,notebookCounts};
}

import {AppError} from '../errors.js';
import {uuid,requireValue} from './validation.js';
import {materialRecordSummary} from '../material-record-summary.js';

// A module command shares the workspace lock. Research membership and selected
// revision identities come from that pinned snapshot, never record bodies.
export async function moduleResearchContext(workspace){
 const outline=await workspace.outline();
 const {metadata:book,etag}=outline;
 const lookup=(id,summary)=>{
  requireValue(uuid(id),'Record identity');
  return workspace.catalogue(async store=>{
   const snapshot=await store.snapshot(etag);
   if(snapshot.metadata.id!==book.id)throw new AppError('WORKSPACE_CHANGED');
   const member=await store.member(snapshot,id);
   return summary?materialRecordSummary(store,member):Boolean(member);
  });
 };
 return {book,hasRecord:id=>lookup(id,false),recordSummary:id=>lookup(id,true)};
}

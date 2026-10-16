// Select run relationships by their authenticated owner, including retained
// addresses of records now owned by an independent project.
import {SnapshotIndex} from './snapshot-index.js';
import {referenceNamespaceMatches} from './research-reference-namespace.js';
import {AppError} from './errors.js';
export async function hasRunParent(store,row,recordId){
 if(row?.type!=='run')return false;
 for(const target of row.runOf)if(target.id===recordId&&await referenceNamespaceMatches(store,target))return true;
 return false;
}
export async function* recordRunMembers(store,snapshot,recordId,{signal,notebookIds}={}){
 const index=new SnapshotIndex(store);
 const rows=async function*(){
  if(!snapshot.indexVersion){yield* store.members(snapshot,{signal,notebookIds});return;}
  for await(const entry of index.entries({root:snapshot.membership},'run:'+recordId+':')){
   signal?.throwIfAborted();const row=await index.member(entry);
   if(entry.id!=='run:'+recordId+':'+row.id||!row.runOf.some(target=>target.id===recordId))throw new AppError('CATALOGUE_DAMAGED');
   yield row;
  }
 };
 for await(const row of rows()){
  signal?.throwIfAborted();if(notebookIds&&row.notebookId&&!notebookIds.has(row.notebookId))continue;
  if(await hasRunParent(store,row,recordId))yield row;
 }
}

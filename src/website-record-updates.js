import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {storedLinkedRuns,websiteLinkedRuns,currentWebsiteCopy} from './publication-conversion.js';
import {withDeferredFeedRefresh} from './website-dynamic-feeds.js';

// A website made in the website editor keeps the copy of each lab book record
// it places. When the author saves the record again, the website keeps showing
// the earlier copy until the author chooses to update it. Both steps read only
// the records the site's placed sources came from, with the person's access.
const ITEM_LIMIT=200,REFRESH_LIMIT=200;

async function placedSources(store,siteId,expectedRevision,selected=null){
 return store.scope(async()=>{
  const manifest=await store.current(siteId,expectedRevision),groups=new Map();
  for(const placed of manifest.sources){
   if(selected&&!selected.has(placed.id))continue;
   const source=await store.source(placed.id),origin=source?.provenance;
   if(source?.target!=='website'||!source.visible||!researchId(origin?.workspaceId)||!researchId(origin?.recordId)||!researchId(origin?.notebookId)||!revisionId(origin?.recordRevision))continue;
   const rows=groups.get(origin.workspaceId)??[];
   rows.push({sourceId:placed.id,title:source.title??'',origin});
   groups.set(origin.workspaceId,rows);
  }
  return groups;
 });
}
// Placed records the lab book has changed since the website took its copy, and
// records whose copy an earlier version made, records whose shared runs changed since then (a copy lists its runs, which
// link to it, so the record itself is not saved when a run is). A record that
// moved to another lab book is updated by that move, not here.
async function changedRecords(reader,groups,signal,visit){
 for(const [workspaceId,rows] of groups){
  signal?.throwIfAborted();
  await reader.use(workspaceId,undefined,async(catalogue,snapshot,pinned)=>{
   const storage=new Proxy(pinned.storage,{get(target,key){if(key==='catalogue')return consume=>consume(catalogue);const value=target[key];return typeof value==='function'?value.bind(target):value;}});
   for(const row of rows){
    signal?.throwIfAborted();const member=await catalogue.member(snapshot,row.origin.recordId);
    if(!member||member.notebookId!==row.origin.notebookId)continue;
    if(member.revision!==row.origin.recordRevision||!currentWebsiteCopy(row.origin)||storedLinkedRuns(row.origin)!==await websiteLinkedRuns(catalogue,snapshot,member.id,{signal}))await visit(row,storage);
   }
  });
 }
}
export async function websiteRecordUpdates(store,siteId,{expectedRevision,sourceReader,signal}={}){
 if(!researchId(siteId)||!revisionId(expectedRevision)||typeof sourceReader!=='function')throw new AppError('INVALID');
 const groups=await placedSources(store,siteId,expectedRevision),items=[];let total=0;
 if(groups.size){
  const reader=await sourceReader({signal});
  try{
   await changedRecords(reader,groups,signal,async row=>{total++;if(items.length<ITEM_LIMIT)items.push({sourceId:row.sourceId,recordId:row.origin.recordId,title:row.title});});
   await reader.verify();
  }finally{await reader.close();}
 }
 return {siteId,revision:expectedRevision,total,items,truncated:total>items.length};
}
export async function refreshWebsiteRecords(store,conversion,siteId,{expectedRevision,sourceIds,sourceReader,signal}={}){
 if(!researchId(siteId)||!revisionId(expectedRevision)||typeof sourceReader!=='function'||!Array.isArray(sourceIds)||!sourceIds.length||sourceIds.length>REFRESH_LIMIT||sourceIds.some(id=>!revisionId(id))||new Set(sourceIds).size!==sourceIds.length)throw new AppError('INVALID');
 const groups=await placedSources(store,siteId,expectedRevision,new Set(sourceIds));let updated=0;
 if(groups.size){
  const reader=await sourceReader({signal});
  try{
   // The record lists containing these records are refreshed once, after all of them.
   await withDeferredFeedRefresh(store,()=>changedRecords(reader,groups,signal,async(row,storage)=>{
    await conversion.refreshRecord(storage,{workspaceId:row.origin.workspaceId,notebookId:row.origin.notebookId,recordId:row.origin.recordId});updated++;
   }),{signal});
  }finally{await reader.close();}
 }
 // The websites placing these records were rewritten with the new copies.
 const site=await store.scope(()=>store.raw(siteId));
 return {siteId,updated,revision:site?.revision??null};
}

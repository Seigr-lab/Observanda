import {digest} from './storage-format.js';
import {AppError} from './errors.js';
import {summaryPage} from './summary-page.js';
import {compareKey,QUERY_ORDER_VERSION} from './web/query-order.js';
import {researchId} from './web/research-reference.js';
import {timelineMatch,timelineOrder,validTimelineQuery} from './web/tools/timeline-model.js';
import {timelineCollectionScope} from './timeline-collection-scope.js';
import {recordDateWindow} from './record-date-window.js';
import {queryResultWindow} from './query-result-window.js';
export async function timelineCollectionQuery(pages,client,command,{scope=null,registry,visit,signal}){
 if(!command||Object.keys(command).sort().join()!=='cursor,limit,query,workspaceId')throw new AppError('INVALID');
 const {workspaceId,query,limit,cursor}=command;
 if(!researchId(workspaceId)||!validTimelineQuery(query)||!Number.isSafeInteger(limit)||limit<1||limit>100||cursor!==null&&(typeof cursor!=='string'||!cursor||cursor.length>4096))throw new AppError('INVALID');
 signal?.throwIfAborted();const sources=await timelineCollectionScope(registry,{workspaceId,scope,query}),signature=digest(JSON.stringify({kind:'timeline',scope,workspaceId,query,limit,order:QUERY_ORDER_VERSION})),session=pages.begin(client,signature,cursor),snapshots={directory:sources.directory.revision};
 if(session.snapshots&&session.snapshots.directory!==sources.directory.revision)throw new AppError('RECORD_QUERY_CURSOR');
 const order=(a,b)=>timelineOrder(query)(a,b)||compareKey(a.owner.workspaceId,b.owner.workspaceId),point=row=>({id:row.id,title:row.title,occurredOn:row.occurredOn,owner:{workspaceId:row.owner.workspaceId}}),page=summaryPage({offset:session.offset,after:session.after,limit,order,point}),matches=timelineMatch(query);let changed=false;
 await visit(async(storage,owner)=>storage.catalogue(async store=>{
  signal?.throwIfAborted();const head=await store.head(),snapshotId=session.snapshots?.[owner.workspaceId]??head;
  if(session.snapshots&&!Object.hasOwn(session.snapshots,owner.workspaceId)||Object.hasOwn(snapshots,owner.workspaceId))throw new AppError('RECORD_QUERY_CURSOR');snapshots[owner.workspaceId]=snapshotId;changed||=head!==snapshotId;
  const snapshot=await store.snapshot(snapshotId),metadata=snapshot.metadata;if(metadata.id!==owner.workspaceId)throw new AppError('DATABASE_LOCATION');
  const ids=sources.books(metadata),books=new Map(metadata.notebooks.map(book=>[book.id,book])),projects=new Map(metadata.projects.map(project=>[project.id,project]));
  const owned=record=>{const {id,notebookId,title,occurredOn,status}=record,book=books.get(notebookId),project=projects.get(book.projectId);return {id,notebookId,title,occurredOn,status,owner:{...owner,projectId:book.projectId??owner.projectId,projectTitle:project?.title??owner.projectTitle??'',notebookTitle:book.title}};};
  if(!query.query&&!query.status&&!query.from&&!query.to){
   const indexed=await recordDateWindow(store,snapshot,ids,{offset:session.offset,after:session.after,limit,workspaceId:owner.workspaceId,ascending:!query.descending,signal});
   if(indexed){page.addIndexed({...indexed,records:indexed.records.map(owned)});return;}
  }
  const cached=await queryResultWindow({reuse:!!cursor,workspace:storage,ownerId:owner.workspaceId,snapshotId,queryHash:digest(JSON.stringify(['timeline-collection',signature,[...ids].sort()])),order:timelineOrder(query),point:record=>({id:record.id,title:record.title,occurredOn:record.occurredOn,owner:{workspaceId:owner.workspaceId}}),after:session.offset?session.after:null,includeEqual:!session.after||owner.workspaceId<=session.after.owner.workspaceId,limit,preceding:session.offset>limit,signal},check=>{
   async function* matching(){for await(const record of store.queryDocuments(store.searchMembers(snapshot,ids,'',{signal}),metadata,{signal,search:false})){check();if(!ids.has(record.notebookId)||!matches(record))continue;const {id,notebookId,title,occurredOn,status}=record;yield {id,notebookId,title,occurredOn,status};}}
   return {rows:matching()};
  });
  if(cached){page.addIndexed({...cached,records:cached.records.map(owned)});return;}
  for await(const record of store.queryDocuments(store.searchMembers(snapshot,ids,'',{signal}),metadata,{signal,search:false})){
   signal?.throwIfAborted();if(!ids.has(record.notebookId)||!matches(record))continue;
   page.add(owned(record));
  }
 }),{workspaceId,scope,signal,selection:sources.selection,includeOwner:sources.includeOwner});
 if(session.snapshots&&Object.keys(session.snapshots).some(id=>!Object.hasOwn(snapshots,id))||(await registry.directory()).revision!==sources.directory.revision)throw new AppError('RECORD_QUERY_CURSOR');
 signal?.throwIfAborted();const {records,total,after,previousAfter}=page.finish(),offset=session.offset,encode=pages.retain(session,snapshots);
 return {collection:true,workspaceId,snapshotId:digest(JSON.stringify(Object.entries(snapshots).sort())),records,total,offset,changed,missingSources:query.projects.length+query.books.length-sources.found.size,cursor:encode(offset,session.after),previousCursor:offset?encode(offset-limit,offset>limit?previousAfter:null):null,nextCursor:offset+records.length<total?encode(offset+records.length,after):null};
}

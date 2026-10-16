import {timelineSource} from './web/tools/timeline-source.js';
import {QUERY_ORDER_VERSION} from './web/query-order.js';
import {AppError} from './errors.js';
import {digest} from './storage.js';
import {upgradeNotebook} from './model.js';
import {summaryPage} from './summary-page.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {validRecordDate} from './web/record-date.js';
import {timelineScope,timelineMatch,timelineOrder,validTimelineQuery} from './web/tools/timeline-model.js';

export class TimelineQuery{
 constructor(workspace){this.workspace=workspace;}
 async list({workspaceId,query,cursor=null,limit=50}={},{signal}={}){
  if(!researchId(workspaceId)||!validTimelineQuery(query)||!Number.isSafeInteger(limit)||limit<1||limit>100||cursor!==null&&(typeof cursor!=='string'||!cursor||cursor.length>4096))throw new AppError('INVALID');
  signal?.throwIfAborted();const queryHash=digest(JSON.stringify({order:QUERY_ORDER_VERSION,query}));
  const run=async({head,snapshot,documents,encode,decode})=>{
   let anchor={workspaceId,snapshotId:head,queryHash,offset:0,limit};
   if(cursor){try{anchor=decode(cursor);}catch{throw new AppError('RECORD_QUERY_CURSOR');}}
   if(!anchor||anchor.workspaceId!==workspaceId||!revisionId(anchor.snapshotId)||anchor.queryHash!==queryHash||anchor.limit!==limit||!Number.isSafeInteger(anchor.offset)||anchor.offset<0||anchor.offset%limit||anchor.offset>0&&(!researchId(anchor.after?.id)||typeof anchor.after.title!=='string'||!validRecordDate(anchor.after.occurredOn)))throw new AppError('RECORD_QUERY_CURSOR');
   const source=await snapshot(anchor.snapshotId),book=source.metadata;
   if(book.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const ids=timelineScope(book,query),matches=timelineMatch(query),page=summaryPage({...anchor,order:timelineOrder(query)});
   for await(const record of documents(source,ids)){
    signal?.throwIfAborted();if(!ids.has(record.notebookId)||!matches(record))continue;
    const {id,notebookId,title,occurredOn,status}=record;page.add({id,notebookId,title,occurredOn,status});
   }
   const {records,total,after,previousAfter}=page.finish(),next=anchor.offset+records.length;
   const bookIds=new Set(records.map(r=>r.notebookId)),books=book.notebooks.filter(b=>bookIds.has(b.id)).map(({id,title,projectId})=>({id,title,projectId})),projectIds=new Set(books.map(b=>b.projectId)),projects=book.projects.filter(p=>projectIds.has(p.id)).map(({id,title})=>({id,title}));
   const missing=(values,items)=>values.filter(value=>{const ref=timelineSource(value,workspaceId);return ref.workspaceId!==workspaceId||!items.some(item=>item.id===ref.id);}).length;
   const missingSources=missing(query.books,book.notebooks)+missing(query.projects,book.projects);
   signal?.throwIfAborted();
   return {workspaceId,snapshotId:anchor.snapshotId,records,books,projects,missingSources,total,offset:anchor.offset,changed:head!==anchor.snapshotId,cursor:encode(anchor),
    previousCursor:anchor.offset?encode({...anchor,offset:anchor.offset-limit,after:previousAfter}):null,nextCursor:next<total?encode({...anchor,offset:next,after}):null};
  };
  if(await this.workspace.storageKind()==='catalogue')return this.workspace.catalogue(async store=>{
   const head=await store.head();if((await store.snapshot(head)).metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   return run({head,snapshot:id=>store.snapshot(id),documents:(source,ids)=>store.queryDocuments(store.searchMembers(source,ids,'',{signal}),source.metadata,{signal,search:false}),
    encode:value=>store.encode('timeline-page',workspaceId,value).toString('base64url'),decode:value=>store.decode('timeline-page',workspaceId,Buffer.from(value,'base64url'))});
  });
  const source=await this.workspace.read(),book=upgradeNotebook(source.book);
  if(book.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
  return run({head:source.etag,snapshot:async id=>{if(id!==source.etag)throw new AppError('RECORD_QUERY_CURSOR');return {metadata:book};},documents:async function*(){yield* book.entries;},
   encode:value=>Buffer.from(JSON.stringify(value)).toString('base64url'),decode:value=>JSON.parse(Buffer.from(value,'base64url').toString('utf8'))});
 }
}

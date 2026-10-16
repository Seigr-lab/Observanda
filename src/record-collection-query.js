// A collection combines read projections from independent owners. Its cursor
// pins their immutable snapshots; its bounded page never becomes writable data.
import {digest} from './storage-format.js';
import {summaryPage} from './summary-page.js';
import {AppError} from './errors.js';
import {validViewQuery} from './web/record-view-model.js';
import {recordQueryMatcher,recordQueryOrder,browseActive} from './web/record-query.js';
import {recentRecordOrder,compareKey,QUERY_ORDER_VERSION} from './web/query-order.js';
import {recordCounts} from './web/record-workflow.js';
import {RecordRecentIndex} from './record-recent-index.js';
import {researchId} from './web/research-reference.js';
import {notebooksIn} from './web/workspace-structure.js';
export async function recordCollectionQuery(pages,client,command,{scope,visit,signal}){
 if(!command||Object.keys(command).sort().join()!=='cursor,limit,mode,query,workspaceId')throw new AppError('INVALID');
 const {workspaceId,query,limit,cursor,mode}=command;
 if(!researchId(workspaceId)||!validViewQuery(query)||!Number.isInteger(limit)||limit<1||limit>100||!['browse','recent'].includes(mode)||cursor!==null&&(typeof cursor!=='string'||cursor.length>4096)||mode==='recent'&&(cursor!==null||query.filter!=='all'||query.search||browseActive(query.browse)))throw new AppError('INVALID');
 const signature=digest(JSON.stringify({scope,workspaceId,query,limit,mode,order:QUERY_ORDER_VERSION})),session=pages.begin(client,signature,cursor);
 const orderRecord=mode==='recent'?recentRecordOrder:recordQueryOrder(query.browse),order=(a,b)=>orderRecord(a,b)||compareKey(a.owner.workspaceId,b.owner.workspaceId);
 const point=value=>({id:value.id,title:value.title,occurredOn:value.occurredOn,...(mode==='recent'?{updatedAt:value.updatedAt}:{}),owner:{workspaceId:value.owner.workspaceId}});
 const page=summaryPage({offset:session.offset,after:session.after,limit,order,point}),counts=recordCounts([]),domains=new Set(),snapshots={},seen=new Set();let changed=false,recentTotal=0;
 const matches=recordQueryMatcher({...query,search:'',notebook:query.notebookId??'all'});
 const result=await visit(async(storage,owner,localProjectId)=>{
  signal?.throwIfAborted();
  await storage.catalogue(async store=>{
   const head=await store.head(),snapshotId=session.snapshots?.[owner.workspaceId]??head;
   if(session.snapshots&&!Object.hasOwn(session.snapshots,owner.workspaceId)||seen.has(owner.workspaceId))throw new AppError('RECORD_QUERY_CURSOR');
   seen.add(owner.workspaceId);snapshots[owner.workspaceId]=snapshotId;changed||=head!==snapshotId;
   const snapshot=await store.snapshot(snapshotId),metadata=snapshot.metadata;if(metadata.id!==owner.workspaceId)throw new AppError('DATABASE_LOCATION');
   if(localProjectId&&!metadata.projects.some(p=>p.id===localProjectId))throw new AppError('RECORD_VIEW_SCOPE');
   const books=notebooksIn(metadata,localProjectId,{recursive:true}),ids=new Set(books.filter(n=>!query.notebookId||n.id===query.notebookId).map(n=>n.id));
   const attach=(document,updatedAt)=>{
    if(document.template?.profileId)domains.add(document.template.profileId);
    if(!matches(document))return;
    const increment=recordCounts([document]);for(const key of Object.keys(counts))counts[key]+=increment[key];
    const book=books.find(n=>n.id===document.notebookId),project=metadata.projects.find(p=>p.id===book?.projectId);
    page.add({...document,...(updatedAt?{updatedAt}:{}),owner:{...owner,projectTitle:owner.projectTitle??project?.title??'',notebookTitle:book?.title??''}});
   };
   // The overview needs only the first page. Ordered indexes avoid scanning a
   // whole book merely to show its ten most recently changed records.
   if(mode==='recent'&&snapshot.recentIndex){
    const recent=await new RecordRecentIndex(store).page(snapshot,ids,{signal});recentTotal+=recent.total;
    let count=0;for await(const row of recent.rows){if(count++===limit)break;for await(const doc of store.queryDocuments([row],metadata,{signal,search:false}))attach(doc,row.updatedAt);}
   }else{
    const rows=store.searchMembers(snapshot,ids,query.search,{signal});
    if(mode==='recent'){
     for await(const row of rows){for await(const doc of store.queryDocuments([row],metadata,{signal,search:false})){recentTotal++;attach(doc,row.updatedAt??(await store.record(row.id,row.revision)).updatedAt);}}
    }else for await(const doc of store.queryDocuments(rows,metadata,{signal,search:false,matching:query.search}))attach(doc);
   }
  });
 },{workspaceId,query,scope,signal});
 if(session.snapshots&&Object.keys(session.snapshots).some(id=>!seen.has(id)))throw new AppError('RECORD_QUERY_CURSOR');
 signal?.throwIfAborted();const {records,total,after,previousAfter}=page.finish(),snapshotId=digest(JSON.stringify(Object.entries(snapshots).sort()));
 if(mode==='recent')return {workspaceId,snapshotId,records,total:recentTotal,changed,...result};
 const encode=pages.retain(session,snapshots),offset=session.offset,next=offset+records.length;
 return {workspaceId,snapshotId,records,total,counts,domains:[...domains].sort(),offset,changed,cursor:encode(offset,session.after),previousCursor:offset?encode(Math.max(0,offset-limit),offset>limit?previousAfter:null):null,nextCursor:next<total?encode(next,after):null,...result};
}

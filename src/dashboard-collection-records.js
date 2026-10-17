import {configurationProfileBooks} from './configuration-profiles.js';
import {RecordRecentIndex} from './record-recent-index.js';
import {digest} from './storage-format.js';
import {AppError} from './errors.js';
import {rankedRangePage} from './ranked-range-page.js';
import {dashboardRecordMembers} from './dashboard-record-members.js';
import {dashboardCollectionContract} from './dashboard-collection-contract.js';
import {recentRecordOrder,compareKey,QUERY_ORDER_VERSION} from './web/query-order.js';
import {dashboardSourceKey} from './web/dashboard-source-key.js';
import {researchCardItems} from './web/research-card-items.js';
import {withRecordDocument} from './record-document.js';
import {RecordMemberCollections} from './record-member-collections.js';

export async function dashboardCollectionRecords(pages,client,command,{scope=null,visit,reader,signal}){
 const {field,lab,source,selection,filters}=dashboardCollectionContract(command),{workspaceId,etag,provider,key,cursor,limit}=command;
 const signature=digest(JSON.stringify({kind:'dashboard',scope,...command,cursor:undefined,order:QUERY_ORDER_VERSION})),session=pages.begin(client,signature,cursor),backward=session.after?.direction==='backward';
 const order=(a,b)=>recentRecordOrder(a,b)||compareKey(a.owner.workspaceId,b.owner.workspaceId),page=rankedRangePage({offset:session.offset,after:session.after,limit,order,backward}),snapshots={},seenBooks=new Set();
 const namespaces=key?new Set([source.workspaceId??workspaceId]):null;
 let scopeProjects={};
 await visit(async(storage,owner,selected)=>storage.catalogue(async store=>{
  scopeProjects=selected.projectLabels??{};
  signal?.throwIfAborted();const snapshotId=session.snapshots?.[owner.workspaceId]??await store.head();
  if(session.snapshots&&!Object.hasOwn(session.snapshots,owner.workspaceId)||Object.hasOwn(snapshots,owner.workspaceId))throw new AppError('RECORD_QUERY_CURSOR');
  snapshots[owner.workspaceId]=snapshotId;const snapshot=await store.snapshot(snapshotId),metadata=snapshot.metadata;
  if(metadata.id!==owner.workspaceId)throw new AppError('DATABASE_LOCATION');
  const books=metadata.notebooks.filter(book=>selected.projectIds.has(book.projectId??null)&&(!selected.notebookIds||selected.notebookIds.has(book.id)));for(const book of books)seenBooks.add(book.id);
  const ids=new Set((lab?await configurationProfileBooks(store,metadata,books,lab.profile,{signal}):books).map(book=>book.id));
  const describe=row=>{const book=books.find(book=>book.id===row.notebookId),project=metadata.projects.find(project=>project.id===book?.projectId);return {...row,owner:{...owner,projectTitle:owner.projectTitle??project?.title??'',notebookTitle:book?.title??''}};};
  if(snapshot.recentIndex&&provider==='records'&&!key&&filters.recordType==='all'&&filters.status==='all'&&!filters.tag){
   const relative=session.after?compareKey(owner.workspaceId,session.after.owner.workspaceId):0;
   const window=await new RecordRecentIndex(store).page(snapshot,ids,{after:session.after,backward,inclusive:backward?relative<0:relative>0,signal}),items=[];
   for await(const row of window.rows){items.push(describe(row));if(items.length===limit)break;}
   page.window({items,total:window.total,before:window.before});
  }else for await(const row of dashboardRecordMembers(store,snapshot,{provider,ids,filters,key:source.key,signal}))page.add(describe(row),row.quantity);
 }),{workspaceId,scope,selection,namespaces,signal});
 if(session.snapshots&&Object.keys(session.snapshots).some(id=>!Object.hasOwn(snapshots,id)))throw new AppError('RECORD_QUERY_CURSOR');
 if(!key&&selection.notebookMode==='selected'&&selection.notebookIds.some(id=>!seenBooks.has(id)))throw new AppError('RECORD_VIEW_SCOPE');
 const selected=page.finish(),records=[],items=[],accepted=[];let bytes=0;
 try{
  for(const row of selected.items){
   signal?.throwIfAborted();
   // Serialized membership size bounds a whole-record card before reading it.
   if(!field&&accepted.length&&bytes+row.bytes>256*1024)break;
   const value=await reader.use(row.owner,snapshots[row.owner.workspaceId],async(store,snapshot)=>{
    if(!field)return {...await store.record(row.id,row.revision),owner:row.owner,collectionKey:dashboardSourceKey(row.owner.workspaceId,row.id)};
    return withRecordDocument(store,row.id,row.revision,async document=>{
     let index=row.index;
     if(source.key){const member=await store.member(snapshot,row.id);index=await new RecordMemberCollections(store).position(member,field,source.key.split(':').at(-1));if(index<0)throw new AppError('RECORD_QUERY_CURSOR');}
     const [ref]=await Array.fromAsync(document.items([field],{offset:index,limit:1,signal}));if(!ref)throw new AppError('RECORD_QUERY_CURSOR');
     const data=(await document.tree.selected(ref.value,[])).value,title=(await document.field(['title'],{signal})).value;
     const [item]=researchCardItems(provider,{id:row.id,title,[field]:[data]});
     return {...item,key:dashboardSourceKey(row.owner.workspaceId,item.key),owner:row.owner,action:{name:'research-open-owned',data:{workspaceId:row.owner.workspaceId,id:row.id}}};
    });
   });
   const size=Buffer.byteLength(JSON.stringify(value));if(accepted.length&&bytes+size>256*1024)break;
   bytes+=size;(field?items:records).push(value);accepted.push(row);
  }
  await reader.verify();
 }finally{await reader.close();}
 if(backward){records.reverse();items.reverse();accepted.reverse();}
 const count=accepted.length,offset=backward?session.offset-count:session.offset,next=offset+count;
 if(offset<0||next>selected.total||session.offset&&!count)throw new AppError('RECORD_QUERY_CURSOR');
 signal?.throwIfAborted();const encode=pages.retain(session,snapshots),point=(row,direction)=>({id:row.id,updatedAt:row.updatedAt,index:row.index,owner:{workspaceId:row.owner.workspaceId},...(direction?{direction}:{})});
 return {workspaceId,etag,collection:true,scopeProjects,...(field?{items}:{records}),total:selected.total,offset,cursor:encode(session.offset,session.after),previousCursor:offset?encode(offset,point(accepted[0],'backward')):null,nextCursor:next<selected.total&&count?encode(next,point(accepted.at(-1))):null};
}

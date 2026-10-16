// Type discovery follows the same owner scope as the record list. Only type
// identities are deduplicated; record bodies and editable catalogues stay local.
import {digest} from './storage-format.js';
import {AppError} from './errors.js';
import {summaryPage} from './summary-page.js';
import {RecordTypeIndex} from './record-type-index.js';
import {RECORD_TYPES} from './web/record-types.js';
import {validViewFilter,viewQuery} from './web/record-view-model.js';
import {compareTitles,compareKey,QUERY_ORDER_VERSION} from './web/query-order.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {notebooksIn} from './web/workspace-structure.js';
export async function recordCollectionTypes(pages,client,command,{scope,visit,signal,selection=null}){
 if(!command||Object.keys(command).sort().join()!=='cursor,etag,limit,notebookId,projectId,search,selected,workspaceId')throw new AppError('INVALID');
 const {workspaceId,etag,projectId,notebookId,selected,search,limit,cursor}=command;
 if(!researchId(workspaceId)||!revisionId(etag)||![projectId,notebookId].every(id=>id===null||researchId(id))||projectId&&notebookId||!validViewFilter(selected)||typeof search!=='string'||search.length>160||!Number.isInteger(limit)||limit<1||limit>25||cursor!==null&&(typeof cursor!=='string'||cursor.length>4096))throw new AppError('INVALID');
 const signature=digest(JSON.stringify({kind:'types',scope,selection,workspaceId,etag,projectId,notebookId,selected,search,limit,order:QUERY_ORDER_VERSION})),session=pages.begin(client,signature,cursor),snapshots={},seen=new Set(),types=new Set();
 const order=(a,b)=>compareTitles(a.label,b.label)||compareKey(a.value,b.value),point=value=>value,page=summaryPage({offset:session.offset,after:session.after,limit,order,point});let selectedType=null;
 const add=choice=>{if(types.has(choice.value))return;if(types.size>=65536)throw new AppError('LIMIT');types.add(choice.value);if(choice.value===selected)selectedType=choice;if(choice.label.toLocaleLowerCase('en').includes(search.trim().toLocaleLowerCase('en')))page.add(choice);};
 for(const type of RECORD_TYPES)add({value:type.id,label:type.label});
 await visit(async(storage,owner,localProjectId)=>storage.catalogue(async store=>{
  signal?.throwIfAborted();const snapshotId=session.snapshots?.[owner.workspaceId]??await store.head();
  if(session.snapshots&&!Object.hasOwn(session.snapshots,owner.workspaceId)||seen.has(owner.workspaceId))throw new AppError('RECORD_QUERY_CURSOR');
  seen.add(owner.workspaceId);snapshots[owner.workspaceId]=snapshotId;const snapshot=await store.snapshot(snapshotId);
  if(snapshot.metadata.id!==owner.workspaceId)throw new AppError('DATABASE_LOCATION');
  if(typeof localProjectId==='string'&&!snapshot.metadata.projects.some(p=>p.id===localProjectId))throw new AppError('RECORD_VIEW_SCOPE');
  const books=selection?snapshot.metadata.notebooks.filter(n=>localProjectId.projectIds.has(n.projectId??null)&&(!localProjectId.notebookIds||localProjectId.notebookIds.has(n.id))):notebooksIn(snapshot.metadata,localProjectId,{recursive:true});
  const ids=new Set(books.filter(n=>!notebookId||n.id===notebookId).map(n=>n.id));
  for await(const type of new RecordTypeIndex(store).types(snapshot,ids,{signal}))add({value:'template:'+type.id,label:type.label});
 }),{workspaceId,scope,query:viewQuery({project:projectId,notebook:notebookId}),selection,signal});
 if(session.snapshots&&Object.keys(session.snapshots).some(id=>!seen.has(id)))throw new AppError('RECORD_QUERY_CURSOR');
 signal?.throwIfAborted();const {records:items,total,after,previousAfter}=page.finish(),offset=session.offset,encode=pages.retain(session,snapshots);
 return {workspaceId,etag,items,total,offset,selected:selectedType,previousCursor:offset?encode(Math.max(0,offset-limit),offset>limit?previousAfter:null):null,nextCursor:offset+items.length<total?encode(offset+items.length,after):null};
}

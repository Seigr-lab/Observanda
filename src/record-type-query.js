import {recordTypePage} from './record-type-page.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {upgradeNotebook} from './model.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {validViewFilter,viewScopeIssue} from './web/record-view-model.js';
import {notebooksIn} from './web/workspace-structure.js';
import {QUERY_ORDER_VERSION} from './web/query-order.js';
export class RecordTypeQuery{
 constructor(workspace){this.workspace=workspace;}
 async read(command,{signal}={}){
  if(!command||Object.keys(command).sort().join()!=='cursor,etag,limit,notebookId,projectId,search,selected,workspaceId')throw new AppError('INVALID');
  const {workspaceId,etag,projectId,notebookId,selected:selectedValue,search,limit,cursor}=command;
  if(!researchId(workspaceId)||!revisionId(etag)||![projectId,notebookId].every(id=>id===null||researchId(id))||projectId&&notebookId||!validViewFilter(selectedValue)||typeof search!=='string'||search.length>160||!Number.isInteger(limit)||limit<1||limit>25||cursor!==null&&(typeof cursor!=='string'||cursor.length>4096))throw new AppError('INVALID');
  signal?.throwIfAborted();
  const read=async(store,snapshot)=>{
   if(snapshot.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   if(viewScopeIssue(snapshot.metadata,{projectId,notebookId}))throw new AppError('RECORD_VIEW_SCOPE');
   const ids=new Set(notebookId?[notebookId]:notebooksIn(snapshot.metadata,projectId,{recursive:true}).map(n=>n.id));
   const signature=digest(serialize({workspaceId,etag,projectId,notebookId,selectedValue,search,limit,order:QUERY_ORDER_VERSION}));
   return recordTypePage(store,snapshot,{workspaceId,etag,ids,selectedValue,search,limit,cursor,signature,namespace:'record-types',signal});
  };
  if(await this.workspace.storageKind()==='catalogue')return this.workspace.catalogue(async store=>{
   if((await store.snapshot()).metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   return read(store,await store.snapshot(etag));
  });
  const current=await this.workspace.read();if(current.etag!==etag)throw new AppError('RECORD_QUERY_CURSOR');
  const book=upgradeNotebook(current.book);
  return read({members:async function*(){for(const record of book.entries){signal?.throwIfAborted();yield {...record,template:record.template??null};}},
   encode:(_table,_id,value)=>Buffer.from(JSON.stringify(value)),decode:(_table,_id,value)=>JSON.parse(value.toString('utf8'))},{metadata:book});
 }
}

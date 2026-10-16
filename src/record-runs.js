import {hasRunParent} from './record-run-members.js';
import {AppError} from './errors.js';
import {RecordQuery} from './record-query.js';
import {researchId} from './web/research-reference.js';
import {recordBrowse} from './web/record-query.js';
import {RUN_PAGE_SIZE,validRunDetailWindows} from './web/record-runs.js';
import {revisionId} from './web/revision-model.js';
import {withRecordDocument} from './record-document.js';
import {recordRunComparison} from './record-run-comparison.js';

// Reuse the authenticated summary index and its snapshot-bound cursor. Comparison
// details are derived only from this page's immutable record revisions.
export class RecordRuns{
 constructor(workspace){this.workspace=workspace;}
 async list(command,{signal}={}){
  const {workspaceId,recordId,cursor=null,compare=false}=command??{};
  if(!command||Object.keys(command).some(key=>!['workspaceId','recordId','cursor','compare'].includes(key))||!researchId(workspaceId)||!researchId(recordId)||typeof compare!=='boolean')throw new AppError('INVALID');
  if(await this.workspace.storageKind()!=='catalogue')throw new AppError('FORMAT');
  const page=await new RecordQuery(this.workspace).list({workspaceId,query:{projectId:null,notebookId:null,filter:'run',search:'',browse:recordBrowse({sort:'date-asc'})},runOf:recordId,selection:{excludeId:recordId,recordType:'run'},cursor,limit:RUN_PAGE_SIZE},{signal});
  const runs=page.records.map(({id,title,occurredOn,status,outcome,revision})=>({id,title,occurredOn,status,outcome:outcome??'',revision}));
  if(compare&&runs.length){
   await this.workspace.catalogue(async store=>{
    const snapshot=await store.snapshot(page.snapshotId);if(snapshot.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
    if(snapshot.metadata.formatVersion!==21)throw new AppError('FORMAT');
    for(const run of runs){
     signal?.throwIfAborted();
     const row=await store.member(snapshot,run.id);if(!row)throw new AppError('CATALOGUE_DAMAGED');
     run.conditions=await withRecordDocument(store,row.id,row.revision,document=>recordRunComparison(document,{signal}));
    }
   });
  }
  return {workspaceId,recordId,snapshotId:page.snapshotId,runs,compare,total:page.total,offset:page.offset,cursor:page.cursor,nextCursor:page.nextCursor,previousCursor:page.previousCursor,changed:page.changed};
 }
 async comparison(command,{signal}={}){
  const {workspaceId,recordId,runId,snapshotId,windows}=command??{};
  if(!command||Object.keys(command).sort().join()!=='recordId,runId,snapshotId,windows,workspaceId'||![workspaceId,recordId,runId].every(researchId)||!revisionId(snapshotId)||!validRunDetailWindows(windows))throw new AppError('INVALID');
  signal?.throwIfAborted();if(await this.workspace.storageKind()!=='catalogue')throw new AppError('FORMAT');
  return this.workspace.catalogue(async store=>{
   const current=await store.snapshot(),snapshot=await store.snapshot(snapshotId);if(current.metadata.id!==workspaceId||snapshot.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const row=await store.member(snapshot,runId);if(!await hasRunParent(store,row,recordId))throw new AppError('MISSING');
   if(snapshot.metadata.formatVersion!==21)throw new AppError('FORMAT');
   const conditions=await withRecordDocument(store,row.id,row.revision,document=>recordRunComparison(document,{windows,signal}));
   return {workspaceId,recordId,runId,snapshotId,conditions};
  });
 }
}

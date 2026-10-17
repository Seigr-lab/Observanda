import {AppError} from './errors.js';
import {reconcileWebsiteMembership} from './website-membership.js';
import {ResearchRecords,recordRevision} from './research.js';
import {validateRecordChanges} from './model.js';
import {SnapshotIndex} from './snapshot-index.js';
import {validateWorkspaceEditCommand,workspaceEditMetadata} from './workspace-edit-command.js';
import {websiteSelectionRecords} from './website-selection.js';

const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

// Research edits retain an exact base. Website choices use their independent
// owner; only older inline workspaces accept the legacy mixed selection edit.
export class WorkspaceEdits{
 constructor(workspace,evidence){this.workspace=workspace;this.records=new ResearchRecords(workspace,evidence);}
 async save(command){
  const response=command?.response;
  if(response!==undefined){if(response!=='outline')throw new AppError('INVALID');const {response:_,...rest}=command;command=rest;}
  validateWorkspaceEditCommand(command);
  if(command.selection&&response!=='outline')throw new AppError('INVALID');
  // Outline validates the workspace descriptor/access before entering storage.
  const outline=await this.workspace.outline();
  if(outline.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  if(outline.etag!==command.baseEtag)throw new AppError('CONFLICT');
  if(outline.metadata.formatVersion!==21||await this.workspace.storageKind()!=='catalogue')throw new AppError('FORMAT');
  return this.workspace.withLock(()=>this.workspace.catalogue(store=>this.apply(store,command,{response})));
 }
 async apply(store,command,{response}={}){
  const head=await store.head(),source=await store.snapshot(head);
  if(source.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  if(head!==command.baseEtag)throw new AppError('CONFLICT');
  if(source.websiteDocuments===1&&command.selection)throw new AppError('INVALID');
  const current=await store.indexed(source),metadata=workspaceEditMetadata(current.metadata,command);
  const previous=new Map(),removed=command.removed.map(r=>r.id),deleted=new Set(removed);
  for(const change of [...command.changes,...command.removed]){
   const row=await store.member(current,change.id);
   const record=row?await store.record(row.id,row.revision):null;
   if((record?recordRevision(record):null)!==change.expectedRevision)throw new AppError('RECORD_CHANGED',[{field:'record',recordId:change.id}]);
   if(record)previous.set(record.id,record);
  }
  const edited=new Map(command.changes.map(c=>[c.id,c.record]));
  await reconcileWebsiteMembership(metadata,id=>deleted.has(id)?null:edited.get(id)??store.member(current,id));
  await store.validateMetadata(current,metadata,{removed,records:command.changes.map(c=>c.record)});
  // Validate the same record contract before reference/media checks.
  validateRecordChanges(metadata,command.changes.map(c=>c.record),[]);
  const selected=[...previous.values()].filter(r=>!deleted.has(r.id));
  const prepared=await this.records.prepare({...metadata,entries:selected,partialRecords:true},command),now=new Date().toISOString(),modified=[];
  for(const record of prepared?.entries??[]){
   const prior=previous.get(record.id);
   if(prior&&recordRevision(prior)===recordRevision(record))continue;
   record.createdAt=prior?.createdAt??now;record.updatedAt=now;modified.push(record);
  }
  const index=new SnapshotIndex(store);
  validateRecordChanges(metadata,modified,(await index.validationRows(current.membership,modified)).filter(r=>!deleted.has(r.id)));
  if(!equal(metadata,current.metadata)||modified.length||removed.length||command.selection){
   async function* records(){yield* modified;yield* websiteSelectionRecords(store,current,command.selection,{now,excluded:[...command.changes.map(r=>r.id),...removed]});}
   await store.commitChanges(head,current,metadata,records(),{removed,now});
  }
  return response==='outline'?store.recordOutline():store.changeResponse(head,modified,{removed,appended:modified.filter(r=>!previous.has(r.id)).map(r=>r.id)});
 }
}

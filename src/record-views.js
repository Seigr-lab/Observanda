import path from 'node:path';
import {digest,serialize} from './storage.js';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {viewKeys,validRecordView,viewScopeIssue} from './web/record-view-model.js';

const MAX_VIEWS=100,MAX_BYTES=1024*1024;
const withRevision=view=>({...view,revision:digest(serialize(view))});
// Named queries are private workspace configuration. Reuse encrypted atomic
// writes and the workspace lock; never put search text in record/public history.
export class RecordViews{
 constructor(workspace){this.workspace=workspace;}
 async context(){return await this.workspace.storageKind()==='catalogue'?this.workspace.catalogue(async store=>(await store.snapshot()).metadata):(await this.workspace.read()).book;}
 file(){return path.join(this.workspace.root,'.observanda','record-views.json');}
 async read(workspaceId){
  if(!researchId(workspaceId))throw new AppError('INVALID');
  if((await this.context()).id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
  const raw=await this.workspace.readMetadata('.observanda/record-views.json',MAX_BYTES);if(raw===null)return {formatVersion:1,workspaceId,views:[]};
  let value;try{value=JSON.parse(raw);}catch{throw new AppError('RECORD_VIEW_FORMAT');}
  if(!viewKeys(value,['formatVersion','workspaceId','views'])||value.formatVersion!==1||value.workspaceId!==workspaceId||!Array.isArray(value.views)||value.views.length>MAX_VIEWS||!value.views.every(validRecordView)||new Set(value.views.map(v=>v.id)).size!==value.views.length||new Set(value.views.map(v=>v.name.toLowerCase())).size!==value.views.length)throw new AppError('RECORD_VIEW_FORMAT');
  return value;
 }
 async list(command){
  if(!viewKeys(command,['workspaceId']))throw new AppError('INVALID');
  const result=await this.read(command.workspaceId);return {workspaceId:result.workspaceId,views:result.views.map(withRevision)};
 }
 async save(command){
  if(!viewKeys(command,['workspaceId','expectedRevision','view'])||!researchId(command.workspaceId)||!(command.expectedRevision===null||revisionId(command.expectedRevision))||!validRecordView(command.view))throw new AppError('INVALID');
  return this.workspace.withLock(async()=>{
   const catalog=await this.read(command.workspaceId),view=command.view,prior=catalog.views.find(v=>v.id===view.id);
   if(prior&&withRevision(prior).revision===withRevision(view).revision)return {view:withRevision(prior)}; // Retry after a lost acknowledgement.
   if((prior?withRevision(prior).revision:null)!==command.expectedRevision)throw new AppError('RECORD_VIEW_CHANGED');
   if(catalog.views.some(v=>v.id!==view.id&&v.name.toLowerCase()===view.name.toLowerCase()))throw new AppError('RECORD_VIEW_NAME');
   const book=await this.context();
   // Renaming a retained view with a missing scope is safe; a changed/new query must be valid now.
   if((!prior||JSON.stringify(prior.query)!==JSON.stringify(view.query))&&viewScopeIssue(book,view.query))throw new AppError('RECORD_VIEW_SCOPE');
   if(!prior&&catalog.views.length>=MAX_VIEWS)throw new AppError('LIMIT');
   catalog.views=prior?catalog.views.map(v=>v.id===view.id?view:v):[...catalog.views,view];
   const raw=serialize(catalog);if(Buffer.byteLength(raw)>MAX_BYTES)throw new AppError('LIMIT');
   await this.workspace.writeMetadata('.observanda/record-views.json',raw);return {view:withRevision(view)};
  });
 }
 async remove(command){
  if(!viewKeys(command,['workspaceId','id','expectedRevision'])||!researchId(command.workspaceId)||!researchId(command.id)||!revisionId(command.expectedRevision))throw new AppError('INVALID');
  return this.workspace.withLock(async()=>{
   const catalog=await this.read(command.workspaceId),prior=catalog.views.find(v=>v.id===command.id);
   if(!prior)return {ok:true};
   if(withRevision(prior).revision!==command.expectedRevision)throw new AppError('RECORD_VIEW_CHANGED');
   catalog.views=catalog.views.filter(v=>v.id!==command.id);await this.workspace.writeMetadata('.observanda/record-views.json',serialize(catalog));return {ok:true};
  });
 }
}

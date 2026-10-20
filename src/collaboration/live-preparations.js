import {RecordDocument} from '../record-document.js';
import {copyRecordValue} from '../record-document-copy.js';
import {PreparationIdentityIndex} from '../record-preparation-index.js';
import {digest,serialize} from '../storage-format.js';
import {RecordValueDrafts} from '../record-value-drafts.js';
import {emptyAttempt,attemptReferences,validAttemptFact} from '../web/attempt-model.js';
// Room-scoped access to the native selected preparation/checkpoint owner.
// Every call stays inside LiveResearch's grant and membership transaction.
import {exact,uuid} from '../modules/validation.js';
import {liveValid as valid} from './live-protocol.js';
import {identityHash} from './identity.js';
import {RecordValues} from '../record-values.js';
import {RecordPreparationDrafts} from '../record-preparation-drafts.js';
import {ResearchDrafts} from '../research-drafts.js';
import {withRecordDocument} from '../record-document.js';
import {recordAttemptWindow} from '../record-attempt-window.js';
import {preparationReferences,isPreparationWindow} from '../record-preparation-document.js';
import {attemptValueField} from '../web/record-attempt-value.js';
import {LiveMaterialReading} from './live-material-reading.js';
const prefix='.observanda/collaboration/live/preparation-checkpoints/';
const target=c=>({workspaceId:c.workspaceId,recordId:c.recordId,selection:c.selection,draft:c.draft});
export const livePreparationOperations=['attempt-window','attempt-context','preparation-select','preparation-pending','preparation-open','preparation-window','preparation-change','preparation-rebase','preparation-save','preparation-remove'];
export class LivePreparations extends LiveMaterialReading{
 async member(store,access,id){valid(uuid(id));const member=await store.member(await store.snapshot(),id);valid(member&&access.notebookIds.includes(member.notebookId),'COLLABORATION_DENIED');return member;}
 path(access,recordId){return prefix+access.principalId+'/'+recordId+'.json';}
 async binding(access,recordId){const raw=await this.workspace.readMetadata(this.path(access,recordId),4096);if(raw===null)return null;const value=JSON.parse(raw);valid(exact(value,['version','workspaceId','principalId','recordId','id','selection','recordedAt'])&&value.version===1&&value.principalId===access.principalId&&value.recordId===recordId&&uuid(value.id),'CATALOGUE_DAMAGED');return value;}
 async checkReferences(store,access,scope,recordId,refs){for await(const ref of refs){valid(ref.workspaceId===scope.workspaceId&&(ref.kind!=='record'||ref.id!==recordId),'COLLABORATION_DENIED');await this.resolve(store,access,ref);}}
 async dispatch(store,access,scope,operation,data,audit){
  const member=await this.member(store,access,data.recordId),values=new RecordValues(this.workspace),owner=new RecordPreparationDrafts(this.workspace),drafts=new ResearchDrafts(this.workspace);
  if(operation==='attempt-window'){
   valid(exact(data,['recordId',...(Object.hasOwn(data,'windows')?['windows']:[])]));const windows=data.windows??{};valid(windows&&typeof windows==='object'&&!Array.isArray(windows)&&Object.keys(windows).length<=20&&Object.entries(windows).every(([name,offset])=>(['preparations','events','assessments'].includes(name)||isPreparationWindow(name))&&Number.isSafeInteger(offset)&&offset>=0));
   return withRecordDocument(store,member.id,member.revision,async document=>({...await recordAttemptWindow(document,{windows}),workspaceId:scope.workspaceId,recordId:member.id,storageRevision:member.revision,role:access.grant.role}));
  }
  if(operation==='attempt-context')return values.attemptContext({...data,workspaceId:scope.workspaceId});
  if(operation==='preparation-select'){valid(exact(data,['recordId','field'])&&attemptValueField(data.field)?.kind==='preparation');return values.read({...data,workspaceId:scope.workspaceId});}
  const binding=await this.binding(access,data.recordId);
  if(operation==='preparation-pending'){
   valid(exact(data,['recordId']));if(!binding)return {pending:null};const saved=await drafts.read(binding.id,{header:true});if(saved){valid(saved.draft.formatVersion===6&&saved.draft.workspaceId===scope.workspaceId&&saved.draft.base.recordId===member.id,'CATALOGUE_DAMAGED');this.owns(binding,{workspaceId:scope.workspaceId,selection:saved.draft.selection,draft:{id:binding.id}});}return {pending:saved?{...saved,recordId:data.recordId}:null};
  }
  valid(data.workspaceId===scope.workspaceId&&attemptValueField(data.selection?.field)?.kind==='preparation','COLLABORATION_DENIED');
  if(operation==='preparation-rebase'){
   valid(exact(data,['workspaceId','recordId','selection','draft','commandId'])&&uuid(data.commandId)&&data.draft);const hash=identityHash(data),retained=await drafts.read(data.draft.id,{header:true});
   if(retained?.draft.preparationEdit?.commandId===data.commandId){valid(retained.draft.preparationEdit.request===hash,'CONFLICT');this.owns(binding,{...data,selection:retained.draft.selection});return owner.open({...target(data),selection:retained.draft.selection,draft:{id:retained.draft.id,revision:retained.revision}});}
   this.owns(binding,data);valid(retained&&retained.revision===data.draft.revision,'DRAFT_CHANGED');await new RecordValueDrafts(this.workspace).verify(store,retained.draft);
   const fresh=await values.read({workspaceId:scope.workspaceId,recordId:member.id,field:data.selection.field});valid(fresh.value.value===null,'ATTEMPT_IMMUTABLE');const selection={field:fresh.field,revision:fresh.revision,storageRevision:fresh.storageRevision},command={...target(data),selection,draft:null};
   return owner.source(store,target(data),source=>owner.source(store,command,async current=>{
    let document=current.document;const opened=await owner.envelope(command,current),copied=await copyRecordValue(source.document,document,source.reference);let preparation=new RecordDocument(document.blocks,copied,{mutable:true});preparation=await preparation.property([],'supersedes',opened.header.supersedes);
    if(!await document.reference(['attempt']))document=await document.property([],'attempt',emptyAttempt());document=await document.appendReference(['attempt','preparations'],preparation.root);
    const identities=await PreparationIdentityIndex.build(document,preparation.root);await document.blocks.flush();const draft={...retained.draft,titles:[(await document.field(['title'])).value.slice(0,160)],updatedAt:new Date().toISOString(),base:{recordId:member.id,revision:current.baseRevision},selection,document:{notebookId:document.blocks.scopeId,generation:document.blocks.generation,root:document.root},preparationEdit:{commandId:data.commandId,request:hash,identities:identities.value}},raw=serialize(draft),saved={draft,revision:digest(raw)};
    await this.workspace.writeMetadata('.observanda/drafts/'+draft.id+'.json',raw);await drafts.index.removeLocked(retained.draft);await drafts.index.putLocked(saved,digest(serialize({text:raw})));await this.workspace.writeMetadata(this.path(access,member.id),JSON.stringify({...binding,selection}));return owner.envelope(command,{document,reference:preparation.root,saved});
   },{mutable:true}));
  }
  if(operation==='preparation-save'){
   valid(exact(data,['workspaceId','recordId','selection','draft','id','kind'])&&uuid(data.id)&&data.id===attemptValueField(data.selection.field).id&&data.kind==='preparation-checkpoint');
   const receipt='.observanda/collaboration/live/receipts/'+access.principalId+'/'+data.id+'.json',hash=identityHash(data),raw=await this.workspace.readMetadata(receipt,4096);
   if(raw){const prior=JSON.parse(raw);valid(prior.hash===hash,'CONFLICT');return prior;}
   this.owns(binding,data);await owner.source(store,target(data),source=>this.checkReferences(store,access,scope,member.id,preparationReferences(source.document,source.reference)));
   const saved=await owner.saveLocked(target(data)),response={...saved,hash,itemId:data.id};await this.workspace.writeMetadata(receipt,JSON.stringify(response));await audit(access,member.id,'attempt',{kind:'preparation',itemId:data.id,before:member.revision,after:saved.revision});return response;
  }
  if(operation==='preparation-change'){
   valid(uuid(data.id));let bound=binding;
   if(bound&&bound.id!==data.id){valid(await drafts.read(bound.id,{header:true})===null,'CONFLICT');bound=null;}
   if(!bound){valid(data.draft===null&&await drafts.read(data.id,{header:true})===null,'COLLABORATION_DENIED');bound={version:1,workspaceId:scope.workspaceId,principalId:access.principalId,recordId:member.id,id:data.id,selection:data.selection,recordedAt:new Date().toISOString()};}
   valid(bound.workspaceId===data.workspaceId&&bound.id===data.id&&identityHash(bound.selection)===identityHash(data.selection),'COLLABORATION_DENIED');
   valid(Array.isArray(data.operations)&&data.operations.length>0&&data.operations.length<=20);const refs=[];
   for(const operation of data.operations){if(operation.type==='header'){if(operation.value?.basedOn)refs.push(operation.value.basedOn);if(Array.isArray(operation.value?.protocols))refs.push(...operation.value.protocols);}else if(['conditions','inputs'].includes(operation.collection)&&operation.value?.reference)refs.push(operation.value.reference);}
   await this.checkReferences(store,access,scope,member.id,refs);
   const operations=data.operations.map(op=>op.type==='header'?{...op,value:{...op.value,recordedAt:bound.recordedAt}}:op);
   if(data.draft===null&&!operations.some(op=>op.type==='header')){const opened=await owner.open(target(data));operations.unshift({type:'header',value:{...opened.header,recordedAt:bound.recordedAt}});}
   const result=await owner.changeLocked({...data,operations});await this.workspace.writeMetadata(this.path(access,member.id),JSON.stringify(bound));return result;
  }
  if(data.draft)this.owns(binding,data);else valid(!binding||await drafts.read(binding.id,{header:true})===null,'CONFLICT');
  if(operation==='preparation-open')return owner.open(data);
  if(operation==='preparation-window')return owner.window(data);
  if(operation==='preparation-remove'){
   valid(exact(data,['workspaceId','recordId','selection','draft'])&&data.draft);await drafts.removeLocked({workspaceId:data.workspaceId,id:data.draft.id,expectedRevision:data.draft.revision});await this.workspace.removeMetadata(this.path(access,member.id));return {ok:true};
  }
  valid(false);
 }
 async append(store,access,scope,data,audit){
  const member=await this.member(store,access,data.recordId);valid(exact(data,['recordId','id','kind','item'])&&uuid(data.id)&&['event','assessment'].includes(data.kind)&&data.item?.id===data.id&&validAttemptFact(data.kind,data.item,{draft:true}));
  const receipt='.observanda/collaboration/live/receipts/'+access.principalId+'/'+data.id+'.json',hash=identityHash(data),raw=await this.workspace.readMetadata(receipt,4096);if(raw){const prior=JSON.parse(raw);valid(prior.hash===hash,'CONFLICT');return prior;}
  const group=data.kind==='event'?'events':'assessments',item={...data.item,recordedAt:new Date().toISOString()};await this.checkReferences(store,access,scope,member.id,attemptReferences({...emptyAttempt(),[group]:[item]}));
  const values=new RecordValues(this.workspace),target={workspaceId:scope.workspaceId,recordId:member.id,field:'attempt:'+data.kind+':'+data.id},base=await values.read(target);valid(base.value.value===null,'CONFLICT');
  try{await values.saveLocked({...target,expectedRevision:base.revision,value:{value:item}});}catch(error){if(error.code==='ATTEMPT_CONFLICT')valid(false,'RECORD_CHANGED');if(['INVALID','ATTEMPT_REFERENCE','MISSING'].includes(error.code))valid(false);throw error;}
  const row=await store.member(await store.snapshot(),member.id),history=store.historyIndex(member.id),found=await history.lookup(await history.head(),'version',row.revision),response={hash,revision:(await history.display(found.item)).revision,itemId:item.id};await this.workspace.writeMetadata(receipt,JSON.stringify(response));await audit(access,member.id,'attempt',{kind:data.kind,itemId:item.id,before:member.revision,after:response.revision});return response;
 }
 owns(binding,data){valid(binding&&binding.workspaceId===data.workspaceId&&binding.id===data.draft?.id&&identityHash(binding.selection)===identityHash(data.selection),'COLLABORATION_DENIED');}
}

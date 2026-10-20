// Durable recovery for one explicitly selected record value. The retained base
// and notebook-key document prove the scope; omitted fields are never edits.
import {ResearchDrafts} from './research-drafts.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {withRecordDocument,RecordDocument} from './record-document.js';
import {withDraftDocument} from './record-draft-document.js';
import {withRecordProjectionScratch} from './record-projection-scratch.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.sort().join();
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export class SelectedRecordDrafts{
 constructor(workspace,spec){this.workspace=workspace;this.spec=spec;this.drafts=new ResearchDrafts(workspace);}
 async retainedBase(store,workspaceId,recordId,selection,consume,{mutable=false}={}){
  const history=store.historyIndex(recordId),head=await history.head(),found=await history.lookup(head,'version',selection.storageRevision);
  const snapshot=await store.recordSnapshot(found.item.snapshotId,recordId),row=await store.member(snapshot,recordId);
  if(snapshot.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
  if(!row||row.revision!==found.item.revision)fail();
  return withRecordDocument(store,recordId,selection.storageRevision,async document=>{
   const selected=await this.spec.select(document,selection,{row,store});
   if(digest(serialize(selected.value))!==selection.revision)throw new AppError('RECORD_CHANGED');
   return consume({document,selected,row,baseRevision:(await history.display(found.item)).revision});
  },{mutable});
 }
 async write(command){
  const spec=this.spec,selection=command?.[spec.name];
  if(!exact(command,['id','workspaceId','recordId','expectedRevision',spec.name,'value'])||![command.id,command.workspaceId,command.recordId].every(researchId)||command.expectedRevision!==null&&!revisionId(command.expectedRevision)||!spec.validBase(selection)||!spec.validValue(command.value,selection))throw new AppError('INVALID');
  return this.workspace.withLock(()=>this.workspace.catalogue(async store=>{
   if((await store.snapshot()).metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   await this.drafts.index.ensureLocked(command.workspaceId);const previous=await this.drafts.read(command.id,{header:true});
   if(previous&&previous.draft.workspaceId!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   return this.retainedBase(store,command.workspaceId,command.recordId,selection,async({document,selected,baseRevision})=>{
    await spec.validateExtras?.(this.workspace,command.value,command.workspaceId,command.recordId);
    await spec.requireFormat(store.db,selection,command.value);
    const changed=await selected.replace(document,command.value),descriptor={notebookId:document.blocks.scopeId,generation:document.blocks.generation,root:changed.root},extra=spec.extras?.(command.value)??{};
    if(previous?.draft.formatVersion===spec.version&&previous.draft.workspaceId===command.workspaceId&&previous.draft.base.recordId===command.recordId&&serialize(previous.draft[spec.name])===serialize(selection)&&serialize(previous.draft.document)===serialize(descriptor)&&serialize(spec.savedExtras?.(previous.draft)??{})===serialize(extra))return {revision:previous.revision,updatedAt:previous.draft.updatedAt};
    if((previous?.revision??null)!==command.expectedRevision)throw new AppError('DRAFT_CHANGED');
    await changed.blocks.flush();
    const draft={formatVersion:spec.version,id:command.id,workspaceId:command.workspaceId,updatedAt:new Date().toISOString(),count:1,titles:[(await document.field(['title'])).value.slice(0,160)],base:{recordId:command.recordId,revision:baseRevision},[spec.name]:selection,document:descriptor,...extra};
    const raw=serialize(draft);await this.workspace.writeMetadata('.observanda/drafts/'+command.id+'.json',raw);
    if(previous)await this.drafts.index.removeLocked(previous.draft);await this.drafts.index.putLocked({draft,revision:digest(raw)},digest(serialize({text:raw})));
    return {revision:digest(raw),updatedAt:draft.updatedAt};
   },{mutable:true});
  }));
 }
 async read(command){
  if(!exact(command,['id','workspaceId','expectedRevision'])||![command.id,command.workspaceId].every(researchId)||!revisionId(command.expectedRevision))throw new AppError('INVALID');
  return this.workspace.catalogue(async store=>{
   if((await store.snapshot()).metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const result=await this.drafts.read(command.id,{header:true});
   if(!result||result.revision!==command.expectedRevision)throw new AppError('DRAFT_CHANGED');
   if(result.draft.workspaceId!==command.workspaceId||result.draft.formatVersion!==this.spec.version)throw new AppError('INVALID');
   return {...result,...await this.verify(store,result.draft)};
  });
 }
 async verify(store,draft){
  const spec=this.spec,selection=draft[spec.name];
  return this.retainedBase(store,draft.workspaceId,draft.base.recordId,selection,async({document,selected,row,baseRevision})=>{
   if(baseRevision!==draft.base.revision||(await document.field(['title'])).value.slice(0,160)!==draft.titles[0])fail();
   return withDraftDocument(store,draft,async retained=>{
    const next=await spec.select(retained,selection,{row,store}),value=spec.restore?.(draft,next.value)??next.value;
    if(!spec.validValue(value,selection))fail();
    await spec.validateExtras?.(this.workspace,value,draft.workspaceId,draft.base.recordId);
    await withRecordProjectionScratch(document,async projection=>{
     const expected=await selected.replace(new RecordDocument(projection.blocks,projection.root,{mutable:true}),value);
     if(expected.root!==retained.root)fail();
    });return {value,...(selected.definition?{definition:selected.definition}:{})};
   });
  });
 }
}

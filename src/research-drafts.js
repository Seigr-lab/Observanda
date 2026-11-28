import {hasPlotResourceFigures} from './plot-resource-format.js';
import {hasApproximateFigures} from './record-computation-format.js';
import {requireFigureProjectionPolicies,catalogueRequiresFigureProjectionPolicies} from './catalogue-format.js';
import {requireApproximateCalculator,catalogueRequiresApproximateCalculator} from './catalogue-format.js';
import {validFigureEdit,hasAuthoredFigures} from './figure-authoring-format.js';
import {catalogueRequiresFigureAuthoring,requireFigureAuthoring} from './catalogue-format.js';
import {hasRetainedFigures} from './record-retained-figures.js';
import {requireRetainedFigures,catalogueRequiresRetainedFigures} from './catalogue-format.js';
import {hasRecordProjection} from './record-numerical-models.js';
import {requireNativeNumericalModels,catalogueRequiresNativeNumericalModels} from './catalogue-format.js';
import {hasPagedResultTables} from './retained-tables.js';
import {hasNestedAttemptContinuations} from './web/attempt-model.js';
import {validPreparationEdit,attemptValueField} from './web/record-attempt-value.js';
import {projectRecordOwnerDraft,recordOwnerDraftProjectionNeeded} from './record-owner-drafts.js';
import {upgradeRecord} from './web/record-model.js';
import {validDraftRecord as record} from './record-draft-validation.js';
import {ResearchDraftIndex,draftSummary,recordRecoverySummary} from './research-draft-index.js';
import {digest,serialize} from './storage.js';
import {MAX_RECORD_COMMAND_BYTES as MAX_BYTES} from './web/research-capacity.js';
import {recordRevision} from './research.js';
import {AppError} from './errors.js';
import {researchDraftBase} from './research-draft-base.js';
import {admitResearchBytes} from './research-capacity.js';
import {RecordDraftChunks} from './record-draft-chunks.js';
import {transferredDraftChanges} from './record-draft-content.js';
import {validDraftDocument} from './record-draft-document.js';
import {validWritingBase} from './web/record-writing-model.js';
import {validRecordValueBase} from './web/record-value-model.js';
import {catalogueFormat,catalogueRequiresNestedAttemptCollections,requireNestedAttemptCollections,requireDraftEdits,requirePagedResearchTables,catalogueRequiresPagedResearchTables} from './catalogue-format.js';
import {validFigureCopies} from './web/record-figure-copy-model.js';

const id=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const text=value=>typeof value==='string';
const revision=value=>value===null||typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function validDraftChanges(changes,compact=false){
  if(compact&&changes?.length!==1)return false;
  return Array.isArray(changes)&&changes.length>0&&new Set(changes.map(c=>c?.record?.id)).size===changes.length&&changes.every(c=>
    keys(c,[compact?'baseRevision':'base','record','expectedRevision'])&&record(c.record)&&revision(c.expectedRevision)&&
    (compact?c.baseRevision===c.expectedRevision:c.base===null?c.expectedRevision===null:record(c.base)&&c.base.id===c.record.id&&recordRevision(c.base)===c.expectedRevision));
}
const validChanges=validDraftChanges;

// The adapter shares the workspace encryption and lock. Drafts never mutate the
// manifest, record history or publication selection. Each editor owns a unique
// checkpoint ID, with a revision guard for recovery from another window.
export class ResearchDrafts {
  constructor(workspace){this.workspace=workspace;this.index=new ResearchDraftIndex(workspace,id=>this.read(id,{indexed:false,expand:false,header:true,raw:true}),result=>projectRecordOwnerDraft(workspace,result),(store,summary)=>recordOwnerDraftProjectionNeeded(store,summary.id));}
  async read(idValue,{indexed=true,expand=true,header=false,raw=false,includePending=false}={}){
    return this.workspace.catalogue(()=>this.readValue(idValue,indexed,expand,header,{raw,includePending}));
  }
  async readValue(idValue,indexed,expand,header,options){
    if(!id(idValue))throw new AppError('INVALID');
    await this.workspace.requireStorageKey();
    const raw=await this.workspace.readMetadata('.observanda/drafts/'+idValue+'.json',MAX_BYTES);if(raw===null)return null;
    let draft;try{draft=JSON.parse(raw);}catch{throw new AppError('FORMAT');}
    if([5,6].includes(draft?.formatVersion)){
      if(draft.formatVersion===6&&await this.workspace.catalogue(async store=>await catalogueFormat(store.db)<7))throw new AppError('CATALOGUE_DAMAGED');
      if(Object.hasOwn(draft,'preparationEdit')&&(draft.formatVersion!==6||attemptValueField(draft.selection?.field)?.kind!=='preparation'||!validPreparationEdit(draft.preparationEdit)||!await this.workspace.catalogue(async store=>catalogueRequiresNestedAttemptCollections(await catalogueFormat(store.db)))))throw new AppError('CATALOGUE_DAMAGED');
      if(draft.formatVersion===6&&draft.selection?.field==='type'&&await this.workspace.catalogue(async store=>await catalogueFormat(store.db)<13))throw new AppError('CATALOGUE_DAMAGED');
      if(Object.hasOwn(draft,'figureCopies')&&(draft.formatVersion!==6||!draft.selection?.field?.startsWith('figure:')||!validFigureCopies(draft.figureCopies)))throw new AppError('FORMAT');
      if(draft.figureCopies&&await this.workspace.catalogue(async store=>await catalogueFormat(store.db)<15))throw new AppError('CATALOGUE_DAMAGED');
      if(Object.hasOwn(draft,'figureEdit')&&(draft.formatVersion!==6||!draft.selection?.field?.startsWith('figure:')||!validFigureEdit(draft.figureEdit)||!await this.workspace.catalogue(async store=>catalogueRequiresFigureAuthoring(await catalogueFormat(store.db)))))throw new AppError('CATALOGUE_DAMAGED');
      const selection=draft.formatVersion===5?'writing':'selection',validBase=draft.formatVersion===5?validWritingBase:validRecordValueBase;
      if(!keys(draft,['formatVersion','id','workspaceId','updatedAt','count','titles','base',selection,'document',...(draft.figureCopies?['figureCopies']:[]),...(draft.preparationEdit?['preparationEdit']:[]),...(draft.figureEdit?['figureEdit']:[])])||draft.id!==idValue||!id(draft.workspaceId)||!text(draft.updatedAt)||draft.count!==1||!Array.isArray(draft.titles)||draft.titles.length!==1||!text(draft.titles[0])||draft.titles[0].length>160||!keys(draft.base,['recordId','revision'])||!id(draft.base.recordId)||draft.base.revision===null||!revision(draft.base.revision)||!validBase(draft[selection])||!validDraftDocument(draft.document))throw new AppError('FORMAT');
    }else if([3,4].includes(draft?.formatVersion)){
      if(!keys(draft,['formatVersion','id','workspaceId','updatedAt','count','titles','base','content',...(draft.formatVersion===4?['document']:[])])||draft.formatVersion===4&&!validDraftDocument(draft.document)||draft.id!==idValue||!id(draft.workspaceId)||!text(draft.updatedAt)||draft.count!==1||!Array.isArray(draft.titles)||draft.titles.length!==1||!text(draft.titles[0])||draft.titles[0].length>160||!keys(draft.base,['recordId','revision'])||!id(draft.base.recordId)||!revision(draft.base.revision)||!new RecordDraftChunks(this.workspace,idValue).valid(draft.content))throw new AppError('FORMAT');
    }else if(!keys(draft,['formatVersion','id','workspaceId','updatedAt','changes'])||![1,2].includes(draft.formatVersion)||draft.id!==idValue||!id(draft.workspaceId)||!text(draft.updatedAt)||!validChanges(draft.changes,draft.formatVersion===2))throw new AppError('FORMAT');
    if(draft.changes?.some(change=>hasPagedResultTables(change.record?.results)||hasPagedResultTables(change.base?.results))&&!await this.workspace.catalogue(async store=>catalogueRequiresPagedResearchTables(await catalogueFormat(store.db))))throw new AppError('CATALOGUE_DAMAGED');
    if(draft.changes?.some(change=>hasNestedAttemptContinuations(change.record?.attempt)||hasNestedAttemptContinuations(change.base?.attempt))&&!await this.workspace.catalogue(async store=>catalogueRequiresNestedAttemptCollections(await catalogueFormat(store.db))))throw new AppError('CATALOGUE_DAMAGED');
    if(draft.changes?.some(change=>hasRecordProjection(change.record)||hasRecordProjection(change.base))&&!await this.workspace.catalogue(async store=>catalogueRequiresNativeNumericalModels(await catalogueFormat(store.db))))throw new AppError('CATALOGUE_DAMAGED');
    if(draft.changes?.some(change=>hasPlotResourceFigures(change.record)||hasPlotResourceFigures(change.base))&&!await this.workspace.catalogue(async store=>catalogueRequiresFigureProjectionPolicies(await catalogueFormat(store.db))))throw new AppError('CATALOGUE_DAMAGED');
    if(draft.changes?.some(change=>hasApproximateFigures(change.record)||hasApproximateFigures(change.base))&&!await this.workspace.catalogue(async store=>catalogueRequiresApproximateCalculator(await catalogueFormat(store.db))))throw new AppError('CATALOGUE_DAMAGED');
     if(draft.changes?.some(change=>hasAuthoredFigures(change.record)||hasAuthoredFigures(change.base))&&!await this.workspace.catalogue(async store=>catalogueRequiresFigureAuthoring(await catalogueFormat(store.db))))throw new AppError('CATALOGUE_DAMAGED');
     if(draft.changes?.some(change=>hasRetainedFigures(change.record)||hasRetainedFigures(change.base))&&!await this.workspace.catalogue(async store=>catalogueRequiresRetainedFigures(await catalogueFormat(store.db))))throw new AppError('CATALOGUE_DAMAGED');
    let result={draft,revision:digest(raw)};
    if(indexed)await this.index.verifySelected(result,digest(serialize({text:raw})));
    if(!options.raw){result=await projectRecordOwnerDraft(this.workspace,result,options);if(!result)return null;draft=result.draft;}
    if([5,6].includes(draft.formatVersion))return result;
    if([3,4].includes(draft.formatVersion)){
      if(header)return result;
      const changes=[];for await(const change of transferredDraftChanges(this.workspace,idValue,draft.content))changes.push(change);
      if(!validChanges(changes,true)||changes[0].record.id!==draft.base.recordId||changes[0].baseRevision!==draft.base.revision||changes[0].record.title.slice(0,160)!==draft.titles[0])throw new AppError('FORMAT');
      draft={formatVersion:2,id:draft.id,workspaceId:draft.workspaceId,updatedAt:draft.updatedAt,changes};result.draft=draft;
    }
    if(expand){
      const changes=[];
      for(const change of draft.changes){
        const base=draft.formatVersion===2?await researchDraftBase(this.workspace,draft.workspaceId,change):change.base?upgradeRecord(change.base):null;
        changes.push({base,record:upgradeRecord(change.record),expectedRevision:base?recordRevision(base):null});
      }
      result.draft={...draft,formatVersion:1,changes};
    }
    return result;
  }
  async list({workspaceId=null,cursor=null,excludeId=null,limit=10,includeRecovery=false}={},{signal}={}){
    if(typeof includeRecovery!=='boolean'||workspaceId!==null&&!id(workspaceId)||excludeId!==null&&!id(excludeId)||!Number.isInteger(limit)||limit<1||limit>20||cursor!==null&&(typeof cursor!=='string'||!cursor.length||cursor.length>4096))throw new AppError('INVALID');
    signal?.throwIfAborted();const {metadata:book}=await this.workspace.outline();
    if(workspaceId!==null&&workspaceId!==book.id)throw new AppError('WORKSPACE_CHANGED');
    const owner=this.recoveryOwner(book);
    const presentSummary=includeRecovery?(result,sourceRevision)=>recordRecoverySummary(result,sourceRevision,owner):draftSummary;
    const page=await this.index.page(book.id,{cursor,excludeId,limit},{signal,presentSummary});
    return {...page,drafts:await this.editedTitles(page.drafts,{signal})};
  }
  // A new record written on the record page keeps its edits beside its checkpoint, so the list
  // names it by the title written into it; only that small note is read, never a checkpoint body.
  async editedTitles(items,{signal}={}){
    if(!items.length)return items;
    const {RECORD_DRAFT_TITLE_PREFIX}=await import('./record-draft-edits.js');
    return this.workspace.catalogue(async store=>{
      const named=[];
      for(const item of items){
        signal?.throwIfAborted();const note=item.count===1?await store.object(RECORD_DRAFT_TITLE_PREFIX+item.id):null;
        named.push(note?.draftRevision===item.revision&&typeof note.title==='string'&&note.title?{...item,titles:[note.title,...item.titles.slice(1)]}:item);
      }
      return named;
    });
  }
  recoveryOwner(book){
    const labBookId=this.workspace.labBookId??null;
    return {projectId:this.workspace.projectId??(labBookId?book.projects[0].id:null),labBookId};
  }
  // Recovery details of one listed checkpoint, read only when the author asks
  // for them, so that discovery never reads checkpoint bodies.
  async recovery(data,{signal}={}){
    if(!keys(data,['workspaceId','id'])||!id(data.workspaceId)||!id(data.id))throw new AppError('INVALID');
    signal?.throwIfAborted();const {metadata:book}=await this.workspace.outline();
    if(data.workspaceId!==book.id)throw new AppError('WORKSPACE_CHANGED');
    const result=await this.read(data.id,{expand:false,header:true});
    if(!result)throw new AppError('NOT_FOUND');
    if(result.draft.workspaceId!==book.id)throw new AppError('WORKSPACE_CHANGED');
    signal?.throwIfAborted();return recordRecoverySummary(result,result.revision,this.recoveryOwner(book)).recovery;
  }
  async write(command){
    const compact=Array.isArray(command?.changes)&&command.changes.some(c=>Object.hasOwn(c??{},'baseRevision'));
    if(!keys(command,['id','workspaceId','expectedRevision','changes'])||!id(command.id)||!id(command.workspaceId)||!revision(command.expectedRevision)||!validChanges(command.changes,compact))throw new AppError('INVALID');
    const draft={formatVersion:compact?2:1,id:command.id,workspaceId:command.workspaceId,updatedAt:new Date().toISOString(),changes:command.changes},raw=serialize(draft);
    admitResearchBytes('recordCheckpoint',Buffer.byteLength(raw));
    return this.workspace.withLock(async()=>{
      const {metadata:book}=await this.workspace.outline();
      if(book.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
      await this.index.ensureLocked(book.id);
      const previous=await this.read(command.id,{expand:false,header:true});
      if(previous?.draft.workspaceId===command.workspaceId&&([3,4].includes(previous.draft.formatVersion)?previous.draft.content.sha256===digest(JSON.stringify(command.changes)):serialize(previous.draft.changes)===serialize(command.changes)))return {revision:previous.revision,updatedAt:previous.draft.updatedAt};
      if((previous?.revision??null)!==command.expectedRevision)throw new AppError('DRAFT_CHANGED');
      if(compact)await researchDraftBase(this.workspace,book.id,command.changes[0],{read:false});
      await this.workspace.catalogue(store=>(command.changes.some(change=>hasNestedAttemptContinuations(change.record?.attempt)||hasNestedAttemptContinuations(change.base?.attempt))?requireNestedAttemptCollections:requireDraftEdits)(store.db));
      if(command.changes.some(change=>hasPagedResultTables(change.record?.results)||hasPagedResultTables(change.base?.results))){await this.workspace.catalogue(store=>requirePagedResearchTables(store.db));}
      if(command.changes.some(change=>hasRecordProjection(change.record)||hasRecordProjection(change.base))){await this.workspace.catalogue(store=>requireNativeNumericalModels(store.db));}
      if(command.changes.some(change=>hasPlotResourceFigures(change.record)||hasPlotResourceFigures(change.base))){await this.workspace.catalogue(store=>requireFigureProjectionPolicies(store.db));}
      if(command.changes.some(change=>hasApproximateFigures(change.record)||hasApproximateFigures(change.base))){await this.workspace.catalogue(store=>requireApproximateCalculator(store.db));}
       if(command.changes.some(change=>hasAuthoredFigures(change.record)||hasAuthoredFigures(change.base))){await this.workspace.catalogue(store=>requireFigureAuthoring(store.db));}
       if(command.changes.some(change=>hasRetainedFigures(change.record)||hasRetainedFigures(change.base))){await this.workspace.catalogue(store=>requireRetainedFigures(store.db));}
      await this.workspace.writeMetadata('.observanda/drafts/'+command.id+'.json',raw);
      if(previous)await this.index.removeLocked(previous.draft);await this.index.putLocked({draft,revision:digest(raw)},digest(serialize({text:raw})));
      await new RecordDraftChunks(this.workspace,command.id).clear();
      return {revision:digest(raw),updatedAt:draft.updatedAt};
    });
  }
  async remove(command){
    return this.workspace.withLock(()=>this.removeLocked(command));
  }
  // Compound recovery commits already own the workspace writer transaction.
  // store: the open catalogue transaction when removal is part of a save.
  async removeLocked(command,{store=null}={}){
    if(!keys(command,['id','workspaceId','expectedRevision'])||!id(command.id)||!id(command.workspaceId)||!revision(command.expectedRevision))throw new AppError('INVALID');
      if((await this.workspace.outline()).metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
      await this.index.ensureLocked(command.workspaceId);
      const current=await this.read(command.id,{expand:false,header:true});
      if(!current)return {ok:true};
      if(current.draft.workspaceId!==command.workspaceId||current.revision!==command.expectedRevision)throw new AppError('DRAFT_CHANGED');
      await this.index.removeLocked(current.draft);
      // A record checkpoint also loses what was written into it through the record page.
      if([1,2,3,4].includes(current.draft.formatVersion)){
        const {retireRecordDraftEdits}=await import('./record-draft-edits.js');
        await (store?retireRecordDraftEdits(store,command.id):this.workspace.catalogue(catalogue=>retireRecordDraftEdits(catalogue,command.id)));
      }
      await new RecordDraftChunks(this.workspace,command.id).clear();
      await this.workspace.removeMetadata('.observanda/drafts/'+command.id+'.json');return {ok:true};
  }
}

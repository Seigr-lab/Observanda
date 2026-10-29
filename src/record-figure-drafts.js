// Figure edits are owned by an authenticated selected-value checkpoint. Client
// requests identify that checkpoint; they never authorize arbitrary block roots.
import {validRetainedFigureLanguage} from './retained-figure-localization.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {validRecordValueBase,figureValueId} from './web/record-value-model.js';
import {validMaterialReference} from './web/material-reference.js';
import {validRetainedFigure} from './web/retained-figure-model.js';
import {RecordValueDrafts} from './record-value-drafts.js';
import {ResearchDrafts} from './research-drafts.js';
import {ResearchMaterials} from './research-materials.js';
import {withDraftDocument} from './record-draft-document.js';
import {RecordDocument} from './record-document.js';
import {selectedRecordValue,replaceRecordValue} from './record-values.js';
import {dispatchRetainedFigure,validateRetainedFigureSource} from './retained-figures.js';
import {figureCopySource} from './record-figure-copy-values.js';
import {validFigureCopySource} from './web/record-figure-copy-model.js';
import {hasRetainedFigureTarget} from './retained-figure-targets.js';
import {requireFigureCopyDrafts} from './catalogue-format.js';
import {requireFigureAuthoring} from './catalogue-format.js';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.slice().sort().join();
const invalid=()=>{throw new AppError('INVALID');};
const recordImport=value=>exact(value,['ref','figureId','plotId'])&&validFigureCopySource(value.ref)&&researchId(value.figureId)&&researchId(value.plotId);
const fields=['id','workspaceId','recordId','selection','expectedRevision'];
const target=c=>[c.id,c.workspaceId,c.recordId].every(researchId)&&validRecordValueBase(c.selection)&&figureValueId(c.selection.field)&&(c.expectedRevision===null||revisionId(c.expectedRevision));
export class RecordFigureDrafts{
 constructor(workspace){this.workspace=workspace;this.drafts=new ResearchDrafts(workspace);this.selected=new RecordValueDrafts(workspace);}
 async current(store,command,{optional=false}={}){
  if((await store.snapshot()).metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  const saved=await this.drafts.read(command.id,{header:true});
  if(!saved){if(optional&&command.expectedRevision===null)return null;throw new AppError('DRAFT_CHANGED');}
  if(saved.draft.formatVersion!==6||saved.draft.workspaceId!==command.workspaceId||!figureValueId(saved.draft.selection?.field)||command.recordId!==undefined&&(saved.draft.base.recordId!==command.recordId||serialize(saved.draft.selection)!==serialize(command.selection)))invalid();
  return saved;
 }
 async value(store,saved,consume){return withDraftDocument(store,saved.draft,async document=>consume({...((await selectedRecordValue(document,saved.draft.selection.field)).value),...(saved.draft.figureCopies?{copies:saved.draft.figureCopies}:{})},document));}
 async read(command,{signal}={}){
  const keys=['id','workspaceId','expectedRevision','operation','selection',...(Object.hasOwn(command??{},'window')?['window']:[]),...(Object.hasOwn(command??{},'language')?['language']:[])];
  if(!exact(command,keys)||!validRetainedFigureLanguage(command)||![command.id,command.workspaceId].every(researchId)||!revisionId(command.expectedRevision)||!['open','header','window','item','text','cells','svg','source'].includes(command.operation)||Object.hasOwn(command,'window')&&command.operation!=='svg')invalid();
  return this.workspace.catalogue(async store=>{
   const saved=await this.current(store,command);if(saved.revision!==command.expectedRevision)throw new AppError('DRAFT_CHANGED');
   return this.value(store,saved,async value=>{
    // Drawing uses a strictly finished checkpoint. Incomplete measurements are
    // recoverable editor data, never a scientific preview or published figure.
    if(['svg','cells'].includes(command.operation)&&!validRetainedFigure(value.value))throw new AppError('MATERIAL_INVALID');
    const {RetainedFigureAuthoring}=await import('./retained-figure-authoring.js');
    const reader=await new RetainedFigureAuthoring(this.workspace,{signal,readOnly:true}).open(value.value);
    return dispatchRetainedFigure(reader,saved.revision,command,{signal});
   });
  });
 }
 start(command,options){return this.mutate('start',command,options);}
 change(command,options){return this.mutate('change',command,options);}
 finish(command,options){return this.mutate('finish',command,options);}
 import(command,options){return this.mutate('import',command,options);}
 async mutate(action,command,{signal}={}){
  const extras=action==='start'?['create']:action==='change'?['operation']:action==='import'?['source','mode','plotId']:[];
  if(!exact(command,[...fields,'operationId',...extras])||!target(command)||!researchId(command.operationId)||action==='start'&&![null,'plot','panels'].includes(command.create)||action==='import'&&(!(validMaterialReference(command.source)&&command.source.kind==='analysis'||recordImport(command.source))||!['replace','append','panel'].includes(command.mode)||!researchId(command.plotId)))invalid();
  const request=digest(serialize({action,command}));
  return this.workspace.withLock(()=>this.workspace.catalogue(async store=>{
   signal?.throwIfAborted();const previous=await this.current(store,command,{optional:action==='start'});
   if(previous?.draft.figureEdit?.operationId===command.operationId){if(previous.draft.figureEdit.request!==request)throw new AppError('DRAFT_CHANGED');return this.value(store,previous,value=>({revision:previous.revision,updatedAt:previous.draft.updatedAt,value,validationIssues:[]}));}
   if((previous?.revision??null)!==command.expectedRevision)throw new AppError('DRAFT_CHANGED');
   return this.selected.retainedBase(store,command.workspaceId,command.recordId,command.selection,async({document:base,selected,baseRevision})=>{
    const run=async(value,original)=>{
     await requireFigureAuthoring(store.db);
     const {RetainedFigureAuthoring}=await import('./retained-figure-authoring.js');
     const authoring=new RetainedFigureAuthoring(this.workspace,{signal}),current=value.value;let figure,copies=value.copies??[];
     if(action==='start'){
      if(command.create!==null&&current!==null)invalid();
      if(current?.kind==='retained'&&current.document?.format!=='figure-authoring')await validateRetainedFigureSource(new ResearchMaterials(this.workspace),current,{signal});
      figure=await authoring.start(current,{id:figureValueId(command.selection.field),kind:command.create??'plot'});
     }else{
      if(!validRetainedFigure(current,{draft:true})||current.document.format!=='figure-authoring')invalid();
      if(action==='change')figure=await authoring.change(current,command.operation);
      else if(action==='finish')figure=await authoring.finish(current);
      else{
       const materials=new ResearchMaterials(this.workspace);await materials.assertOwner(command.recordId,{write:true});
       let source,recordSource=null;
       if(recordImport(command.source)){
        recordSource=await figureCopySource(this.workspace,{workspaceId:command.workspaceId,recordId:command.recordId,source:command.source.ref,figureId:command.source.figureId,plotId:command.source.plotId},{signal});
        if(recordSource.statementCount&&command.mode==='append')throw new AppError('FIGURE_COPY_CHANGED');
        source=recordSource.figure;if(source.kind!=='retained')source=await authoring.finish(await authoring.start(source));
       }else{const result=await materials.read(command.source);if(!validRetainedFigure(result.content?.figure))invalid();source={...result.content.figure,source:command.source};}
       let importedTarget=null;
       figure=await authoring.import(current,source,{mode:command.mode,plotId:command.plotId,...(recordSource?{sourcePlotId:recordSource.plotId}:{}),onMapped:({targetId})=>{importedTarget=targetId;}});
       if(command.mode==='replace')copies=[];
       if(recordSource?.statementCount){const targetId=command.mode==='replace'?figure.id:importedTarget;if(!researchId(targetId))throw new AppError('CATALOGUE_DAMAGED');copies=[...copies,{source:recordSource.source,figureId:recordSource.figureId,plotId:recordSource.plotId,targetId}];}

      }
     }
     if(figure.id!==figureValueId(command.selection.field)||!validRetainedFigure(figure,{draft:true}))throw new AppError('CATALOGUE_DAMAGED');
     const retainedCopies=[];for(const copy of copies)if(await hasRetainedFigureTarget(this.workspace,figure,copy.targetId,{signal,draft:true}))retainedCopies.push(copy);if(retainedCopies.length)await requireFigureCopyDrafts(store.db);
     const nextValue={value:figure,...(retainedCopies.length?{copies:retainedCopies}:{})},mutable=new RecordDocument(original.blocks,original.root,{mutable:true}),changed=await replaceRecordValue(mutable,command.selection.field,nextValue);
     await changed.blocks.flush();await this.drafts.index.ensureLocked(command.workspaceId);
     const draft={formatVersion:6,id:command.id,workspaceId:command.workspaceId,updatedAt:new Date().toISOString(),count:1,titles:[(await base.field(['title'])).value.slice(0,160)],base:{recordId:command.recordId,revision:baseRevision},selection:command.selection,document:{notebookId:changed.blocks.scopeId,generation:changed.blocks.generation,root:changed.root},figureEdit:{operationId:command.operationId,request},...(retainedCopies.length?{figureCopies:retainedCopies}:{})};
     const raw=serialize(draft),saved={draft,revision:digest(raw)};
     await this.workspace.writeMetadata('.observanda/drafts/'+command.id+'.json',raw);if(previous)await this.drafts.index.removeLocked(previous.draft);await this.drafts.index.putLocked(saved,digest(serialize({text:raw})));
     return {revision:saved.revision,updatedAt:draft.updatedAt,value:nextValue,validationIssues:[]};
    };
    return previous?this.value(store,previous,run):run(selected.value,base);
   },{mutable:true});
  }));
 }
}

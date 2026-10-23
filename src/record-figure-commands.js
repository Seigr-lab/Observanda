import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId,revisionText} from './web/revision-model.js';
import {placedFigures} from './web/book-selectors.js';
import {cloneFigure} from './web/figure-composition.js';
import {hasRetainedFigure} from './record-retained-figures.js';
import {RetainedFigureAuthoring} from './retained-figure-authoring.js';
import {withScratch} from './scratch-work.js';
import {allFigurePlots} from './web/figure-provenance.js';
import {copyFigureDocumentResults} from './record-figure-copy-values.js';
import {resolveFigureSources} from './figure-provenance.js';
import {ResearchMaterials} from './research-materials.js';
import {RecordValues,selectedRecordValue} from './record-values.js';
import {RecordMemberCollections,memberCollectionCount} from './record-member-collections.js';
import {withRecordDocument} from './record-document.js';
import {commitRecordDocument} from './record-document-commit.js';
import {digest,serialize} from './storage-format.js';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.sort().join();

// Each acknowledged command has a small encrypted receipt. Retrying a copy
// never creates a second figure; retrying removal cannot delete a later edit.
export class RecordFigureCommands{
 constructor(workspace){this.workspace=workspace;}
 async context(store,command){
  const etag=await store.head(),snapshot=await store.snapshot(etag);
  if(snapshot.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  if(snapshot.metadata.formatVersion!==21)throw new AppError('FORMAT');return {etag,snapshot};
 }
 async receipt(file,request){
  const raw=await this.workspace.readMetadata(file,4096);if(raw===null)return null;let saved;
  try{saved=JSON.parse(raw);}catch{throw new AppError('CATALOGUE_DAMAGED');}
  if(!exact(saved,['version','request','result'])||saved.version!==1||!revisionId(saved.request)||!exact(saved.result,['etag','saved','figureId','position'])||!revisionId(saved.result.etag)||saved.result.saved!==true||!researchId(saved.result.figureId)||!Number.isSafeInteger(saved.result.position)||saved.result.position<0)throw new AppError('CATALOGUE_DAMAGED');
  if(saved.request!==request)throw new AppError('RECORD_CHANGED');return saved.result;
 }
 async run(command){
  if(!exact(command,['workspaceId','recordId','id','figureId','action','expectedRevision'])||![command.workspaceId,command.recordId,command.id,command.figureId].every(researchId)||!['duplicate','remove'].includes(command.action)||!revisionId(command.expectedRevision))throw new AppError('INVALID');
  const request=digest(revisionText(command)),file='.observanda/figure-commands/'+command.id+'.json';
  const previous=await this.workspace.catalogue(async store=>{await this.context(store,command);return this.receipt(file,request);});if(previous)return previous;
  let prepared=null;
  if(command.action==='duplicate'){
   const selected=await new RecordValues(this.workspace).read({workspaceId:command.workspaceId,recordId:command.recordId,field:'figure:'+command.figureId});
   if(!selected.value.value)throw new AppError('MISSING');if(selected.revision!==command.expectedRevision)throw new AppError('RECORD_CHANGED');
   // Pin legacy implicit calculation references before taking the writer lock.
   prepared=(await resolveFigureSources(new ResearchMaterials(this.workspace),{recordId:command.recordId,figures:[selected.value.value]})).sources;
  }
  return this.workspace.withLock(()=>this.workspace.catalogue(async store=>{
   const {etag,snapshot}=await this.context(store,command),retry=await this.receipt(file,request);if(retry)return retry;
   const row=await store.member(snapshot,command.recordId);if(!row)throw new AppError('MISSING');
   const members=new RecordMemberCollections(store),index=await members.position(row,'figures',command.figureId);if(index<0)throw new AppError('MISSING');
   return withRecordDocument(store,row.id,row.revision,async original=>{
    const selected=await selectedRecordValue(original,'figure:'+command.figureId,{position:index});if(selected.revision!==command.expectedRevision)throw new AppError('RECORD_CHANGED');
    let document,figureId=command.figureId,position=index;
    if(command.action==='remove'){
     if(selected.definition.hasLinkedResults||selected.definition.linkedFigureIds.length)throw new AppError('FIGURE_RESULTS');
     const inUse=body=>placedFigures({body}).has(command.figureId);
     if(inUse((await original.field(['body'])).value))throw new AppError('FIGURE_IN_USE');
     for await(const item of original.items(['sections']))if(inUse((await original.tree.selected(item.value,['body'])).value))throw new AppError('FIGURE_IN_USE');
     document=await original.splice(['figures'],index,1,[]);
    }else{
     if(await members.position(row,'figures',command.id)>=0)throw new AppError('RECORD_CHANGED');
     const source=structuredClone(selected.value.value),byId=new Map(prepared.map(item=>[item.figureId,item.ref]));
     for(const plot of allFigurePlots([source]))if(byId.has(plot.id))plot.source=byId.get(plot.id);
     position=memberCollectionCount(row,'figures');figureId=command.id;
     if(hasRetainedFigure(source))document=await withScratch(async mapping=>{
      const authoring=new RetainedFigureAuthoring(this.workspace),retained=source.kind==='retained'?source:await authoring.finish(await authoring.start(source));
      const copy=await authoring.duplicate(retained,{id:command.id,onMapped:async({sourceId,targetId})=>{if(!await mapping.add(sourceId,targetId))throw new AppError('MATERIAL_INVALID');}});
      const changed=await original.splice(['figures'],position,0,[copy]);return copyFigureDocumentResults(original,changed,[],{mapTarget:id=>mapping.get(id)});
     });
     else{
      let first=true;const copy=cloneFigure(source,()=>{if(first){first=false;return command.id;}return randomUUID();});
      document=await original.splice(['figures'],position,0,[copy]);document=await copyFigureDocumentResults(original,document,[[source,copy]]);
     }
    }
    const member=await members.changed(row,'figures',document),saved=await commitRecordDocument(store,{etag,snapshot,row,document,member}),result={etag:saved.etag,saved:true,figureId,position};
    await this.workspace.writeMetadata(file,serialize({version:1,request,result}));return result;
   },{mutable:true});
  }));
 }
}

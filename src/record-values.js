// Individually owned record details. A value revision guards only this field;
// other fields and growing collections remain references to their saved values.
import {recordTemplateDefinition,recordTemplateChoices} from './record-template-document.js';
import {resultFigureCount} from './record-result-document.js';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId,revisionText} from './web/revision-model.js';
import {sameJSONData} from './web/json-data-equality.js';
import {validRecordValueField,validRecordValue,recordValueCollection} from './web/record-value-model.js';
import {relationValue,relationFromValue,canonicalRelationValue} from './web/record-relation-value.js';
import {mediaDetails} from './web/record-media-value.js';
import {retainedFigureTargets,hasRetainedFigureTarget} from './retained-figure-targets.js';
import {figureTargets} from './web/figure-composition.js';
import {validateFigureSources} from './figure-provenance.js';
import {digest,serialize} from './storage-format.js';
import {withRecordDocument} from './record-document.js';
import {commitRecordDocument} from './record-document-commit.js';
import {RecordMemberCollections,memberCollectionCount} from './record-member-collections.js';
import {SnapshotIndex} from './snapshot-index.js';
import {parseResearchReference,researchReference} from './web/research-reference.js';
import {attemptValueField} from './web/record-attempt-value.js';
import {selectedAttemptValue,replaceAttemptValue,prepareAttemptValue} from './record-attempt-values.js';
import {attemptValueContext,validAttemptContext} from './record-attempt-context.js';
import {resultValueId} from './web/record-result-value.js';
import {selectedResultValue,replaceResultValue,validateSelectedResult,resultFigureRootTarget,resultFigureTargetPage} from './record-result-values.js';
import {applyFigureCopies} from './record-figure-copy-values.js';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.sort().join();
const fields=['workspaceId','recordId','field'];
const target=c=>researchId(c.workspaceId)&&researchId(c.recordId)&&validRecordValueField(c.field);
export async function recordTypeEditable(document,{signal}={}){
 const template=await document.reference(['template'],{signal}),node=template?await document.tree.node(template):null;
 return !node||node.type==='inline'&&node.value===null;
}
export async function selectedRecordValue(document,field,{position,signal,inspectResults=true}={}){
 if(!validRecordValueField(field))throw new AppError('INVALID');
 if(field==='type'&&!await recordTypeEditable(document,{signal}))throw new AppError('INVALID',[{field:'The record type belongs to its saved template.'}]);
 if(attemptValueField(field))return selectedAttemptValue(document,field,{signal});
 if(resultValueId(field))return selectedResultValue(document,field,{signal});
 const collection=recordValueCollection(field);
 if(collection){
  // Saved reads use the authenticated membership index. Checkpoint documents
  // may add or remove this identity, so resolve their own references instead.
  if(position===undefined){position=-1;for await(const item of document.items([collection.name],{signal})){
   if((await document.tree.selected(item.value,['id'])).value===collection.id){position=item.index;break;}
  }}
  const path=position<0?null:[collection.name,String(position)],selected=path?(await document.field(path,{signal})).value:null;
  if(path&&selected?.id!==collection.id)throw new AppError('CATALOGUE_DAMAGED');
  if(collection.kind==='media'&&!selected)throw new AppError('MISSING');
  if(collection.kind==='figure'){
   const value={value:selected},linkedFigureIds=new Set();let hasLinkedResults=false;
   if(inspectResults&&selected?.kind==='retained'&&await document.reference(['results'],{signal})&&await document.tree.arrayLength(document.root,['results','statements'])){
    // A retained composition can have arbitrarily many children. The selected
    // response needs only presence; individual targets are inspected by page.
    for await(const figure of retainedFigureTargets(document.blocks,selected,{signal,draft:true}))if(await resultFigureCount(document,figure.id,{signal})){hasLinkedResults=true;break;}
   }else for(const figure of inspectResults&&selected?figureTargets([selected]):[])if(await resultFigureCount(document,figure.id,{signal})){linkedFigureIds.add(figure.id);hasLinkedResults=true;}
   return {path,position,collection,definition:{kind:'figure',existing:!!selected,linkedFigureIds:[...linkedFigureIds],hasLinkedResults},value,revision:digest(serialize(value))};
  }
  const value={value:selected?(collection.kind==='media'?mediaDetails(selected):collection.kind==='relation'?relationValue(selected):{name:selected.name,role:selected.role}):null};
  return {path,position,collection,definition:{kind:collection.kind,original:value.value,...(collection.kind==='media'?{mediaKind:selected.kind}:{}),...(collection.kind==='relation'?{recordType:(await document.field(['type'])).value}:{})},value,revision:digest(serialize(value))};
 }
 const custom=field.startsWith('template:'),key=custom?field.slice(9):field,path=custom?['template','values',key]:[key];let definition=null;
 if(custom)definition=await recordTemplateDefinition(document,field,{signal});
 const selected=await document.field(path,{signal}),value={value:selected.found?selected.value:null};
 return {path,definition,value,revision:digest(serialize(value))};
}
export async function replaceRecordValue(document,field,value,selected=null){
 selected??=await selectedRecordValue(document,field,{inspectResults:false});const path=selected.path;
 if(selected.fact)return replaceAttemptValue(document,value,selected);
 if(selected.resultId)return replaceResultValue(document,value,selected);
 if(selected.collection?.kind==='figure')return selected.position<0?document.splice(['figures'],await document.tree.arrayLength(document.root,['figures']),0,[value.value]):document.replace(path,value.value);
 if(selected.collection?.kind==='media')return document.replace(path,{id:selected.collection.id,kind:selected.definition.mediaKind,...value.value});
 if(selected.collection){
  const {id,name,kind}=selected.collection,item=value.value===null?null:kind==='relation'?relationFromValue(id,value.value):{id,...value.value};
  if(selected.position<0)return item===null?document:document.splice([name],await document.tree.arrayLength(document.root,[name]),0,[item]);
  return item===null?document.splice([name],selected.position,1,[]):document.replace(path,item);
 }
 return document.property(path.slice(0,-1),path.at(-1),value.value,{remove:value.value===null});
}
export class RecordValues{
 constructor(workspace){this.workspace=workspace;}
 async choices(command,{signal}={}){
  if(!exact(command,['workspaceId','recordId','storageRevision','field','schemaRevision','offset','query'])||!target(command)||!command.field.startsWith('template:')||!revisionId(command.storageRevision))throw new AppError('INVALID');
  return this.workspace.catalogue(async store=>{
   await this.select(store,command);
   const history=store.historyIndex(command.recordId);await history.lookup(await history.head(),'version',command.storageRevision);
   return withRecordDocument(store,command.recordId,command.storageRevision,async document=>({workspaceId:command.workspaceId,recordId:command.recordId,storageRevision:command.storageRevision,field:command.field,...await recordTemplateChoices(document,command.field,{...command,signal})}));
  });
 }
 async attemptContext(command,{signal}={}){
  if(!exact(command,['workspaceId','recordId','storageRevision','field','prior','preparationId','offset',...(Object.hasOwn(command,'criterionId')?['criterionId']:[]),...(Object.hasOwn(command,'criterionOffset')?['criterionOffset']:[])])||!target(command)||!revisionId(command.storageRevision)||!validAttemptContext(command))throw new AppError('INVALID');
  return this.workspace.catalogue(async store=>{
   await this.select(store,command);
   const history=store.historyIndex(command.recordId);await history.lookup(await history.head(),'version',command.storageRevision);
   return withRecordDocument(store,command.recordId,command.storageRevision,document=>attemptValueContext(document,command.field,{...command,signal}));
  });
 }
 async figureChoices(command,{signal}={}){
  const child=Object.hasOwn(command,'figureId');
  if(!exact(command,['workspaceId','recordId','offset',...(child?['figureId']:[])])||!researchId(command.workspaceId)||!researchId(command.recordId)||!Number.isSafeInteger(command.offset)||command.offset<0||child&&!researchId(command.figureId))throw new AppError('INVALID');
  return this.workspace.catalogue(async store=>{
   const {row}=await this.select(store,command);
   return withRecordDocument(store,row.id,row.revision,async document=>{
    if(child){
     const position=await new RecordMemberCollections(store).position(row,'figures',command.figureId);if(position<0)throw new AppError('MISSING');
     const page=await resultFigureTargetPage(document,position,{offset:command.offset,limit:4,signal});
     return {workspaceId:command.workspaceId,recordId:row.id,storageRevision:row.revision,figureId:command.figureId,offset:page.offset,total:page.total,nextOffset:page.next,items:page.items};
    }
    const total=await document.tree.arrayLength(document.root,['figures']),offset=Math.min(command.offset,Math.max(0,total-1)),items=[];
    for(let i=offset;i<Math.min(offset+4,total);i++){signal?.throwIfAborted();const target=await resultFigureRootTarget(document,i,{signal});if(!target)throw new AppError('CATALOGUE_DAMAGED');items.push(target);}
    return {workspaceId:command.workspaceId,recordId:row.id,storageRevision:row.revision,figureId:null,offset,total,nextOffset:offset+4<total?offset+4:null,items};
   });
  });
 }
 async select(store,command){
  const etag=await store.head(),snapshot=await store.snapshot(etag);if(snapshot.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  if(snapshot.metadata.formatVersion!==21)throw new AppError('FORMAT');const row=await store.member(snapshot,command.recordId);if(!row)throw new AppError('MISSING');
  const collection=recordValueCollection(command.field),position=collection?await new RecordMemberCollections(store).position(row,collection.name,collection.id):undefined;
  return {etag,snapshot,row,position};
 }
 async read(command,{signal}={}){
  if(!exact(command,fields)||!target(command))throw new AppError('INVALID');signal?.throwIfAborted();
  return this.workspace.catalogue(async store=>{
   const {row,etag,position}=await this.select(store,command);
   return withRecordDocument(store,row.id,row.revision,async document=>{
    const selected=await selectedRecordValue(document,command.field,{position,signal});signal?.throwIfAborted();
    return {...command,etag,storageRevision:row.revision,revision:selected.revision,value:selected.value,definition:selected.definition,recordTitle:(await document.field(['title'])).value};
   });
  });
 }
 async save(command){return this.workspace.withLock(()=>this.saveLocked(command));}
 async saveLocked(command){
  if(!exact(command,[...fields,'expectedRevision','value'])||!target(command)||!revisionId(command.expectedRevision)||!validRecordValue(command.value,command.field))throw new AppError('INVALID');
  if(recordValueCollection(command.field)?.kind==='relation'&&command.value.value!==null)command={...command,value:{value:canonicalRelationValue(command.value.value)}};
  return this.workspace.catalogue(async store=>{
   const {row,etag,snapshot,position}=await this.select(store,command);
   const receipt=command.value.copies?'.observanda/figure-copy-values/'+digest(revisionText(command))+'.json':null;
   if(receipt){const raw=await this.workspace.readMetadata(receipt,4096);if(raw!==null){let result;try{result=JSON.parse(raw);}catch{throw new AppError('CATALOGUE_DAMAGED');}if(!exact(result,['etag','revision','saved','position'])||!revisionId(result.etag)||!revisionId(result.revision)||result.saved!==true||!Number.isSafeInteger(result.position)||result.position<0)throw new AppError('CATALOGUE_DAMAGED');return result;}}
   return withRecordDocument(store,row.id,row.revision,async original=>{
    const selected=await selectedRecordValue(original,command.field,{position});
    if(sameJSONData(selected.value,command.value))return {etag,revision:selected.revision,saved:true,...(selected.collection?.kind==='figure'?{position:selected.position}:{})};
    if(selected.revision!==command.expectedRevision)throw new AppError('RECORD_CHANGED');
    if(selected.fact){
     const change=await prepareAttemptValue(this.workspace,store,{command,selected,original,row,snapshot});
     const saved=await commitRecordDocument(store,{etag,snapshot,row,...change});
     return {etag:saved.etag,revision:digest(serialize(command.value)),saved:true};
    }
    if(selected.resultId)await validateSelectedResult(this.workspace,original,command.value);
    if(selected.collection?.kind==='figure'){
     if(selected.value.value)for await(const target of retainedFigureTargets(this.workspace,selected.value.value))if(await resultFigureCount(original,target.id)&&!await hasRetainedFigureTarget(this.workspace,command.value.value,target.id))throw new AppError('INVALID',[{field:'A figure with an attached result cannot be removed. Review its result first.',recordId:row.id}]);
     await validateFigureSources(this.workspace,{figures:[command.value.value]});
    }
    if(selected.collection?.kind==='relation'&&command.value.value!==null){
     const value=command.value.value,target=parseResearchReference(value.reference);
     if(target?.workspaceId===command.workspaceId&&target.kind==='record'&&target.id===row.id)throw new AppError('INVALID',[{field:'Choose another record to link.',recordId:row.id}]);
     for await(const item of original.items(['relations'])){
      const link=await original.tree.read(item.value);
      if(link.id!==selected.collection.id&&link.type===value.type&&researchReference(link.target)===value.reference)throw new AppError('INVALID',[{field:'That relationship is already linked.',recordId:row.id}]);
     }
    }
    let document=await replaceRecordValue(original,command.field,command.value,selected);
    document=await applyFigureCopies(this.workspace,original,document,command.value,command);
    const membershipChanged=selected.collection&&(selected.value.value===null)!==(command.value.value===null);
    let member=membershipChanged?await new RecordMemberCollections(store).changed(row,selected.collection.name,document):row;
    if(selected.collection?.kind==='relation'){
     const runOf=[];for await(const item of document.items(['relations']))if((await document.tree.selected(item.value,['role'])).value==='run-of'){
      if(runOf.length)throw new AppError('INVALID',[{field:'Choose one investigation or creative series for this run.',recordId:row.id}]);
      runOf.push((await document.tree.selected(item.value,['target'])).value);
     }
     member={...member,runOf};
    }
    const candidate=command.field==='type'?{id:row.id,type:command.value.value,sections:[],relations:row.runOf.map(target=>({role:'run-of',target}))}:selected.collection?.kind==='relation'&&command.value.value!==null?{id:row.id,type:row.type,sections:[],relations:[relationFromValue(selected.collection.id,command.value.value)]}:null;
    const summaries=candidate?await new SnapshotIndex(store).validationRows(snapshot.membership,[candidate]):[];
    const saved=await commitRecordDocument(store,{etag,snapshot,row,document,member,summaries});
    const result={etag:saved.etag,revision:digest(serialize({value:command.value.value})),saved:true,...(selected.collection?.kind==='figure'?{position:selected.position<0?memberCollectionCount(saved.member,'figures')-1:selected.position}:{})};
    if(receipt)await this.workspace.writeMetadata(receipt,serialize(result));return result;
   },{mutable:true});
  });
 }
}

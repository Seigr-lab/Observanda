import {PreparationIdentityIndex} from './record-preparation-index.js';
// Selected preparation checkpoints reuse format-six ResearchDrafts and the
// original record's encrypted value tree. Only Save appends an immutable fact.
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {ResearchDrafts} from './research-drafts.js';
import {RecordValues} from './record-values.js';
import {withRecordDocument,RecordDocument} from './record-document.js';
import {withDraftDocument} from './record-draft-document.js';
import {copyRecordValue} from './record-document-copy.js';
import {commitRecordDocument} from './record-document-commit.js';
import {RecordMemberCollections} from './record-member-collections.js';
import {SnapshotIndex} from './snapshot-index.js';
import {requireNestedAttemptCollections} from './catalogue-format.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {validRecordValueBase} from './web/record-value-model.js';
import {preparationMethodLinks} from './web/attempt-workflow.js';
import {withRecordProjectionScratch} from './record-projection-scratch.js';
import {attemptValueField} from './web/record-attempt-value.js';
import {emptyAttempt,preparationCollections,preparationHeaderFields,validPreparationHeader,validPreparationRow} from './web/attempt-model.js';
import {attemptFactPosition} from './record-attempt-context.js';
import {preparationHeader,preparationPage,validatePreparationDocument,preparationValueRevision} from './record-preparation-document.js';
const exact=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===names.slice().sort().join();
const invalid=()=>{throw new AppError('INVALID');},damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const absent=digest(serialize({value:null}));
const target=command=>researchId(command.workspaceId)&&researchId(command.recordId)&&validRecordValueBase(command.selection)&&attemptValueField(command.selection.field)?.kind==='preparation'&&command.selection.revision===absent;
const fields=['workspaceId','recordId','selection','draft'];
export class RecordPreparationDrafts{
 constructor(workspace){this.workspace=workspace;this.drafts=new ResearchDrafts(workspace);}
 async base(store,command,consume,{mutable=false}={}){
  if(!target(command))invalid();
  const history=store.historyIndex(command.recordId),found=await history.lookup(await history.head(),'version',command.selection.storageRevision),snapshot=await store.recordSnapshot(found.item.snapshotId,command.recordId);
  const member=await store.member(snapshot,command.recordId);if(!member||member.revision!==found.item.revision)damaged();
  if(snapshot.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  return withRecordDocument(store,command.recordId,command.selection.storageRevision,async document=>{
   const id=attemptValueField(command.selection.field).id;if(await attemptFactPosition(document,'preparations',id)>=0)throw new AppError('ATTEMPT_IMMUTABLE');
   return consume(document,(await history.display(found.item)).revision);
  },{mutable});
 }
 async source(store,command,consume,{mutable=false}={}){
  return this.base(store,command,async(base,baseRevision)=>{
   if(command.draft){
    if(!exact(command.draft,['id','revision'])||!researchId(command.draft.id)||!revisionId(command.draft.revision))invalid();
    const saved=await this.drafts.read(command.draft.id,{header:true});if(!saved||saved.revision!==command.draft.revision)throw new AppError('DRAFT_CHANGED');
    if(saved.draft.formatVersion!==6||saved.draft.workspaceId!==command.workspaceId||saved.draft.base.recordId!==command.recordId||serialize(saved.draft.selection)!==serialize(command.selection))invalid();
    if(!saved.draft.preparationEdit){const {RecordValueDrafts}=await import('./record-value-drafts.js');await new RecordValueDrafts(this.workspace).verify(store,saved.draft);}
    return withDraftDocument(store,saved.draft,async original=>{const use=async document=>{
     const position=await base.reference(['attempt'])?await base.tree.arrayLength(base.root,['attempt','preparations']):0,reference=await document.reference(['attempt','preparations',String(position)]);if(!reference||saved.draft.preparationEdit&&saved.draft.preparationEdit.identities.source!==reference||(await document.tree.selected(reference,['id'])).value!==attemptValueField(command.selection.field).id)damaged();
     return consume({base,baseRevision,document,reference,saved,position});
    };return mutable?use(original):withRecordProjectionScratch(original,use);});
   }
   const count=await base.reference(['attempt'])?await base.tree.arrayLength(base.root,['attempt','preparations']):0,reference=count?await base.reference(['attempt','preparations',String(count-1)]):null;
   return consume({base,baseRevision,document:base,reference,saved:null,position:count});
  },{mutable});
 }
 async envelope(command,{document,reference,saved},options={}){
  const id=attemptValueField(command.selection.field).id,header=reference?await preparationHeader(document,reference,options):{id,supersedes:null,recordedAt:new Date().toISOString(),reason:'',applicability:'',basedOn:null,protocols:[]};
  if(!saved){header.supersedes=reference?header.id:null;header.id=id;header.recordedAt=new Date().toISOString();header.reason='';}
  const collections={};for(const collection of preparationCollections)collections[collection]=reference?await preparationPage(document,reference,collection,options):{items:[],total:0,offset:0,next:null};
  return {workspaceId:command.workspaceId,recordId:command.recordId,selection:command.selection,header,collections,recordTitle:(await document.field(['title'])).value,draft:saved?{id:saved.draft.id,revision:saved.revision}:null};
 }
 async open(command,{signal}={}){
  if(!exact(command,fields)||!target(command)||command.draft!==null&&!command.draft)invalid();
  return this.workspace.catalogue(store=>this.source(store,command,source=>this.envelope(command,source,{signal})));
 }
 async window(command,{signal}={}){
  if(!exact(command,[...fields,'collection','offset'])||!preparationCollections.includes(command.collection))invalid();
  return this.workspace.catalogue(store=>this.source(store,command,async({document,reference})=>({workspaceId:command.workspaceId,recordId:command.recordId,selection:command.selection,draft:command.draft,collection:command.collection,...(reference?await preparationPage(document,reference,command.collection,{offset:command.offset,signal}):{items:[],total:0,offset:0,next:null})})));
 }
 async change(command,{signal}={}){
  if(!exact(command,[...fields,'id','commandId','operations'])||!target(command)||![command.id,command.commandId].every(researchId)||!Array.isArray(command.operations)||!command.operations.length||command.operations.length>20||command.draft&&command.draft.id!==command.id)invalid();
  const request=digest(serialize(command));
  return this.workspace.withLock(()=>this.workspace.catalogue(async store=>{
   const previous=await this.drafts.read(command.id,{header:true});
   if(previous?.draft.preparationEdit?.commandId===command.commandId){if(previous.draft.preparationEdit.request!==request)throw new AppError('DRAFT_CHANGED');return this.source(store,{...command,draft:{id:command.id,revision:previous.revision}},source=>this.envelope(command,source,{signal}));}
   if((previous?.revision??null)!==(command.draft?.revision??null))throw new AppError('DRAFT_CHANGED');
   await requireNestedAttemptCollections(store.db);await this.drafts.index.ensureLocked(command.workspaceId);
   return this.source(store,command,async source=>{
    let document=new RecordDocument(source.document.blocks,source.document.root,{mutable:true,attemptIndex:source.document.attemptIndex}),position=source.position;
    if(!source.saved){
     const opened=await this.envelope(command,source,{signal});let reference;
     if(source.reference){let preparation=new RecordDocument(document.blocks,source.reference,{mutable:true});for(const key of preparationHeaderFields)preparation=await preparation.property([],key,opened.header[key],{signal});reference=preparation.root;}
     else reference=await document.tree.retain({...opened.header,...Object.fromEntries(preparationCollections.map(name=>[name,[]]))});
     if(!await document.reference(['attempt']))document=await document.property([],'attempt',emptyAttempt(),{signal});
     document=await document.appendReference(['attempt','preparations'],reference,{signal});
    }
    const path=['attempt','preparations',String(position)],initialReference=await document.reference(path),identities=source.saved?.draft.preparationEdit?new PreparationIdentityIndex(document,structuredClone(source.saved.draft.preparationEdit?.identities)):await PreparationIdentityIndex.build(document,initialReference,{signal});if(identities.value.source!==initialReference)damaged();
    for(const operation of command.operations){
     signal?.throwIfAborted();
     if(operation.type==='header'){
      if(!exact(operation,['type','value'])||!validPreparationHeader(operation.value,{draft:true})||operation.value.id!==attemptValueField(command.selection.field).id)invalid();
      const current=await preparationHeader(document,await document.reference(path));if(current.supersedes!==operation.value.supersedes||source.saved&&current.recordedAt!==operation.value.recordedAt)invalid();
      for(const key of preparationHeaderFields)document=await document.property(path,key,operation.value[key],{signal});
     }else{
      const collection=operation.collection;if(!preparationCollections.includes(collection))invalid();const rowPath=[...path,collection],count=await document.tree.arrayLength(document.root,rowPath);
      if(operation.type==='append'){
       if(!exact(operation,['type','collection','value'])||!validPreparationRow(collection,operation.value,{draft:true}))invalid();
       if(await identities.find(collection,operation.value.id))invalid();document=await document.splice(rowPath,count,0,[operation.value],{signal});await identities.change(collection,operation.value.id,await document.reference([...rowPath,String(count)],{signal}));
      }else{
       if(!['replace','remove'].includes(operation.type)||!exact(operation,['type','collection','position','id','revision',...(operation.type==='replace'?['value']:[])])||!Number.isSafeInteger(operation.position)||operation.position<0||operation.position>=count)invalid();
       const selected=[...rowPath,String(operation.position)],reference=await document.reference(selected,{signal});if((await identities.find(collection,operation.id))?.revision!==reference)damaged();if(reference!==operation.revision||(await document.tree.selected(reference,['id'])).value!==operation.id)throw new AppError('DRAFT_CHANGED');
       if(operation.type==='replace'){if(operation.value?.id!==operation.id||!validPreparationRow(collection,operation.value,{draft:true}))invalid();document=await document.replace(selected,operation.value,{signal});await identities.change(collection,operation.id,await document.reference(selected,{signal}));}
       else {document=await document.splice(rowPath,operation.position,1,[],{signal});await identities.remove(collection,operation.id);}
      }
     }
    }
    const reference=await document.reference(path,{signal});await identities.flush(reference);await document.blocks.flush();
    const draft={formatVersion:6,id:command.id,workspaceId:command.workspaceId,updatedAt:new Date().toISOString(),count:1,titles:[(await document.field(['title'])).value.slice(0,160)],base:{recordId:command.recordId,revision:source.baseRevision},selection:command.selection,document:{notebookId:document.blocks.scopeId,generation:document.blocks.generation,root:document.root},preparationEdit:{commandId:command.commandId,request,identities:identities.value}},raw=serialize(draft),saved={draft,revision:digest(raw)};
    await this.workspace.writeMetadata('.observanda/drafts/'+draft.id+'.json',raw);if(previous)await this.drafts.index.removeLocked(previous.draft);await this.drafts.index.putLocked(saved,digest(serialize({text:raw})));
    return this.envelope(command,{document,reference,saved},{signal});
   },{mutable:true});
  }));
 }
 async save(command,{signal}={}){
  if(!exact(command,fields)||!command.draft||!target(command))invalid();
  return this.workspace.withLock(()=>this.workspace.catalogue(store=>this.source(store,command,async source=>{
   const {snapshot,row,etag}=await new RecordValues(this.workspace).select(store,command),header=await validatePreparationDocument(source.document,source.reference,{signal});if(source.saved.draft.preparationEdit)await new PreparationIdentityIndex(source.document,source.saved.draft.preparationEdit.identities).verify(source.reference,{signal});
   return withRecordDocument(store,row.id,row.revision,async original=>{
    const existing=await attemptFactPosition(original,'preparations',header.id,{signal});
    if(existing>=0){const ref=await original.reference(['attempt','preparations',String(existing)]);if(await preparationValueRevision(original,ref,{signal})!==await preparationValueRevision(source.document,source.reference,{signal}))throw new AppError('ATTEMPT_IMMUTABLE');return {saved:true,etag,revision:row.revision};}
    const count=await original.reference(['attempt'])?await original.tree.arrayLength(original.root,['attempt','preparations']):0,latest=count?(await original.field(['attempt','preparations',String(count-1),'id'])).value:null;
    if(header.supersedes!==latest)throw new AppError('ATTEMPT_CONFLICT');
    let document=original;if(!await document.reference(['attempt']))document=await document.property([],'attempt',emptyAttempt());
    const reference=await copyRecordValue(source.document,document,source.reference);document=await document.appendReference(['attempt','preparations'],reference,{signal});
    const links=preparationMethodLinks([],{preparations:[header]});
    for await(const relation of original.items(['relations'],{signal})){const item=await original.tree.read(relation.value);if(item.role==='uses-method'){const at=links.findIndex(link=>['workspaceId','kind','id','revision'].every(key=>link.target[key]===item.target[key]));if(at>=0)links.splice(at,1);}}
    let member={...row,hasAttempt:true},summaries=[];
    if(links.length){document=await document.splice(['relations'],await document.tree.arrayLength(document.root,['relations']),0,links);member=await new RecordMemberCollections(store).changed(member,'relations',document);summaries=await new SnapshotIndex(store).validationRows(snapshot.membership,[{id:row.id,type:row.type,sections:[],relations:links}]);}
    const saved=await commitRecordDocument(store,{etag,snapshot,row,document,member,summaries});return {saved:true,etag:saved.etag,revision:saved.member.revision};
   },{mutable:true});
  })));
 }
}
export async function verifyPreparationDraft(store,draft){
 const command={workspaceId:draft.workspaceId,recordId:draft.base.recordId,selection:draft.selection,draft:null},owner=new RecordPreparationDrafts(store.workspace);
 return owner.base(store,command,async(base,baseRevision)=>{
  if(baseRevision!==draft.base.revision||(await base.field(['title'])).value.slice(0,160)!==draft.titles[0])damaged();
  return withDraftDocument(store,draft,async document=>{
   const count=await base.reference(['attempt'])?await base.tree.arrayLength(base.root,['attempt','preparations']):0,path=['attempt','preparations',String(count)],reference=await document.reference(path);if(!reference)damaged();
   const header=await validatePreparationDocument(document,reference,{draft:true});await new PreparationIdentityIndex(document,draft.preparationEdit.identities).verify(reference);if(header.id!==attemptValueField(draft.selection.field).id)damaged();
   // Compare the unchanged siblings by immutable references. Reconstruct only
   // the bounded parent paths around the appended retained preparation.
   await withRecordProjectionScratch(document,async projection=>{let expected=new RecordDocument(projection.blocks,base.root,{mutable:true});if(!await expected.reference(['attempt']))expected=await expected.property([],'attempt',emptyAttempt());expected=await expected.appendReference(['attempt','preparations'],reference);if(expected.root!==document.root)damaged();});return {value:{value:header},definition:{kind:'attempt',factKind:'preparation',paged:true}};
  });
 });
}

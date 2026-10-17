import {recordTemplateChoices} from './record-template-document.js';
import {validateCurrentRecordTemplate} from './record-template-configuration.js';
import {recordOwnerDraftPlanOrigin,validDraftOriginOwner,verifyDraftPlanOrigin} from './record-owner-drafts.js';
// Durable, paged review of a full-record checkpoint. Source documents and
// decisions remain encrypted; the browser receives one conflict/value window.
import {AppError} from './errors.js';
import {attemptValueContext,validAttemptContext} from './record-attempt-context.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {ResearchDrafts} from './research-drafts.js';
import {withRecoveryDraft,recoveryRecord,recoveryRecordCount,recoveryHistoryBase} from './record-draft-source.js';
import {RecordDraftRecoveryLedger} from './record-draft-recovery-ledger.js';
import {withRecordDocument,RecordDocument} from './record-document.js';
import {withRecordBlockStore} from './record-block-store.js';
import {RecordContainerBuilder} from './record-tree-values.js';
import {ObjectIndex,validIndexRef} from './object-index.js';
import {copyRecordValue} from './record-document-copy.js';
import {mergeRecordDocuments} from './record-document-merge.js';
import {digest,serialize} from './storage-format.js';
import {validateRecordDocument} from './record-document-validation.js';
import {validateDocumentSources} from './record-document-sources.js';
import {RecordMemberCollections} from './record-member-collections.js';
import {recordDocumentSummary} from './record-document-summary.js';
import {commitRecordDocument} from './record-document-commit.js';
import {operationStage} from './operation-progress.js';
import {withRecordProjectionScratch} from './record-projection-scratch.js';
import {RecordDraftEdits,verifyRecordDraftEdits} from './record-draft-edits.js';
import {draftEditFields,selectDraftEdit} from './record-draft-edit-values.js';
import {resultFigureTargets} from './record-result-values.js';

const prefix='record-draft-review:',natural=value=>Number.isSafeInteger(value)&&value>=0;
const indexFor=store=>new ObjectIndex(store,{namespace:prefix+'index:',immutable:true});
const revision=plan=>{const {saved,...value}=plan;void saved;return digest(serialize(value));},pathKey=path=>digest(JSON.stringify(path));
const invalid=()=>{throw new AppError('INVALID');};
export class RecordDraftReview{
 constructor(workspace,media){this.workspace=workspace;this.media=media;this.drafts=new ResearchDrafts(workspace);}
 async records(command){
  if(!command||Object.keys(command).sort().join()!=='expectedRevision,id,offset,workspaceId'||![command.id,command.workspaceId].every(researchId)||!revisionId(command.expectedRevision)||!natural(command.offset))invalid();
  return this.workspace.catalogue(async store=>{
   if((await store.snapshot()).metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const result=await this.drafts.read(command.id,{expand:false,header:true});
   if(!result||result.revision!==command.expectedRevision)throw new AppError('DRAFT_CHANGED');
   const draft=result.draft;if(draft.workspaceId!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   if(![1,2,3,4].includes(draft.formatVersion))invalid();
   const total=recoveryRecordCount(draft),ledger=new RecordDraftRecoveryLedger(store),items=[];
   for(let position=command.offset;position<Math.min(total,command.offset+4);position++){
    const record=recoveryRecord(draft,position),saved=await ledger.receipt(draft.id,result.revision,position);
    items.push({position,recordId:record.recordId,title:record.title,recovered:!!saved});
   }
   return {id:draft.id,workspaceId:draft.workspaceId,revision:result.revision,offset:command.offset,total,items};
  });
 }
 async prepare(command){return this.workspace.withLock(()=>this.prepareLocked(command));}
 async prepareLocked(command){
  if(!command||Object.keys(command).filter(k=>k!=='position').sort().join()!=='expectedRevision,id,workspaceId'||![command.id,command.workspaceId].every(researchId)||!revisionId(command.expectedRevision)||!natural(command.position??0))invalid();
  return this.workspace.catalogue(async store=>{
   const snapshot=await store.snapshot();if(snapshot.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const checkpoint=await this.drafts.read(command.id,{expand:false,header:true});
   if(!checkpoint||checkpoint.revision!==command.expectedRevision)throw new AppError('DRAFT_CHANGED');
   const draft=checkpoint.draft;if(draft.workspaceId!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   if(![1,2,3,4].includes(draft.formatVersion)||snapshot.metadata.formatVersion!==21)throw new AppError('FORMAT');
   const position=command.position??0,source=recoveryRecord(draft,position),legacy=draft.formatVersion!==4,row=await store.member(snapshot,source.recordId);
   const recovered=legacy?await new RecordDraftRecoveryLedger(store).receipt(draft.id,checkpoint.revision,position):null;
   if(recovered){this.validate(recovered);return this.summary(recovered);}
   const origin=await recordOwnerDraftPlanOrigin(store,checkpoint,position,row),editOwner={workspaceId:command.workspaceId,recordId:source.recordId,draftId:draft.id,draftRevision:checkpoint.revision,sourcePosition:position,...(origin?{origin}:{})},edits=new RecordDraftEdits(store),editRevision=await edits.head(editOwner);
   const id=digest(serialize([draft.id,checkpoint.revision,row?.revision??null,...(legacy?[position]:[]),...(editRevision?[editRevision]:[])])),previous=await store.object(prefix+id);
   if(previous){this.validate(previous);return this.summary(previous);}
   let baseRevision=null;
   if(source.revision&&draft.formatVersion!==1){const found=await recoveryHistoryBase(store,source.recordId,source.revision);baseRevision=found.revision;
    const baseSnapshot=await store.recordSnapshot(found.snapshotId,source.recordId);if(baseSnapshot.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');}
   return withRecoveryDraft(store,draft,position,async(mine,inlineBase)=>{
    const withLatest=consume=>row?withRecordDocument(store,row.id,row.revision,consume,{mutable:true}):consume(new RecordDocument(mine.blocks,mine.root,{mutable:true}));
    return withLatest(async latest=>{
    const copy=source=>copyRecordValue(source,latest,source.root);
    const roots=await operationStage('read-record-bases',{},async()=>({base:inlineBase?await copy(inlineBase):baseRevision?await withRecordDocument(store,source.recordId,baseRevision,copy):null,mine:await copy(mine),stored:row?latest.root:null}));
    if(editRevision)roots.mine=await edits.document(await edits.node(editRevision),copy);
    const conflicts=new RecordContainerBuilder(latest.blocks,'array'),priorPlan=editRevision?await edits.plan((await edits.node(editRevision)).planId):origin?await edits.plan(origin.reviewId):null,index=indexFor(store);
    let choices=null,decided=0;
    await operationStage('validate-records',{},()=>mergeRecordDocuments(latest,{...roots,choose:async item=>{
     await conflicts.add({value:await latest.tree.retain(item)});
     if(priorPlan?.choices){
      const entry=await index.find({root:priorPlan.choices},pathKey(item.path)),choice=entry?await withRecordBlockStore(store,priorPlan.notebookId,priorPlan.generation,blocks=>blocks.tree().read(entry.revision)):null;
      if(choice?.basis&&serialize(choice.basis)===serialize(item)){choices=await index.change(choices,pathKey(item.path),await latest.tree.retain(choice));decided++;}
     }
     return item.stored;
    }}));
    await index.flush(choices);
    const conflictRoot=await conflicts.finish();await latest.blocks.flush();
    const plan={format:legacy?3:2,...(legacy?{sourcePosition:position,sourceCount:recoveryRecordCount(draft)}:{}),id,workspaceId:command.workspaceId,recordId:source.recordId,...(origin?{origin}:{}),draftId:draft.id,draftRevision:checkpoint.revision,storageRevision:row?.revision??null,notebookId:latest.blocks.scopeId,generation:latest.blocks.generation,roots,conflicts:conflictRoot,count:conflicts.count,choices:null,decided:0,title:(await mine.field(['title'])).value};
    if(editRevision){plan.editRevision=editRevision;plan.title=(await latest.tree.selected(roots.mine,['title'])).value;}plan.choices=choices;plan.decided=decided;
    await store.putObject(prefix+id,plan);return this.summary(plan);
    });
   });
  });
 }
 validate(plan){
  if(plan?.origin&&(!validDraftOriginOwner(plan.origin)||plan.origin.recordId!==plan.recordId||!revisionId(plan.origin.reviewId)))throw new AppError('CATALOGUE_DAMAGED');
  const optional=value=>revisionId(value)||plan?.format>=2&&value===null;
  if(Object.hasOwn(plan??{},'editRevision')&&!revisionId(plan.editRevision))throw new AppError('CATALOGUE_DAMAGED');
  if(!plan||![1,2,3].includes(plan.format)||![plan.id,plan.draftRevision,plan.conflicts,plan.roots?.mine].every(revisionId)||![plan.storageRevision,plan.roots?.base,plan.roots?.stored].every(optional)||(plan.storageRevision===null)!==(plan.roots.stored===null)||Object.keys(plan.roots??{}).sort().join()!=='base,mine,stored'||![plan.workspaceId,plan.recordId,plan.draftId,plan.notebookId].every(researchId)||!Number.isSafeInteger(plan.generation)||plan.generation<1||!natural(plan.count)||!natural(plan.decided)||plan.decided>plan.count||!validIndexRef(plan.choices)||typeof plan.title!=='string'||plan.format===3&&(!natural(plan.sourcePosition)||!natural(plan.sourceCount)||plan.sourcePosition>=plan.sourceCount))throw new AppError('CATALOGUE_DAMAGED');
 }
 summary(plan){return {id:plan.id,workspaceId:plan.workspaceId,recordId:plan.recordId,storageRevision:plan.storageRevision,revision:revision(plan),count:plan.count,decided:plan.decided,title:plan.title,source:{id:plan.draftId,workspaceId:plan.workspaceId,expectedRevision:plan.draftRevision,...(plan.format===3?{position:plan.sourcePosition}:{})},...(plan.format>=2?{newRecord:plan.roots.base===null&&plan.roots.stored===null,removedRecord:plan.roots.base!==null&&plan.roots.stored===null}:{}),...(plan.saved?{saved:plan.saved}:{})};}
 // Selected draft reads may decompose inline leaves. Keep those derived nodes
 // in bounded encrypted scratch storage, never in the saved catalogue.
 async readEdit(command,consume,{signal}={}){
  return this.workspace.catalogue(store=>this.context(store,command,(plan,document)=>new RecordDraftEdits(store).mine(plan,document,(mine,editRevision)=>withRecordProjectionScratch(mine,reader=>consume(reader,editRevision,plan),{signal}))));
 }
 async editFields(command,options){return this.readEdit(command,mine=>draftEditFields(mine,command.group,command.offset,options),options);}
 async editRead(command,options){return this.readEdit(command,async(mine,editRevision,plan)=>{
  const selected=await selectDraftEdit(mine,command.field,options);
  return {workspaceId:plan.workspaceId,recordId:plan.recordId,recordTitle:(await mine.field(['title'])).value,field:command.field,sectionId:command.field.startsWith('section:')?command.field.slice(8):null,editRevision,revision:selected.revision,value:selected.value,definition:selected.definition};
 },options);}
 async editChoices(command,{signal}={}){return this.readEdit(command,async(mine,editRevision,plan)=>{
  if(command.editRevision!==editRevision)throw new AppError('DRAFT_CHANGED');
  return {workspaceId:plan.workspaceId,recordId:plan.recordId,field:command.field,editRevision,...await recordTemplateChoices(mine,command.field,{schemaRevision:command.schemaRevision,offset:command.offset??0,query:command.query??'',signal})};
 },{signal});}
 async editAttempts(command,{signal}={}){
  if(!validAttemptContext(command))invalid();return this.readEdit(command,mine=>attemptValueContext(mine,command.field,{...command,signal}),{signal});
 }
 async editFigures(command,{signal}={}){
  if(!natural(command.offset))invalid();return this.readEdit(command,async mine=>{
   const total=await mine.tree.arrayLength(mine.root,['figures']),items=[];
   for(let i=command.offset;i<Math.min(command.offset+4,total);i++)items.push(...await resultFigureTargets(mine,i,{signal}));
   return {offset:command.offset,total,nextOffset:command.offset+4<total?command.offset+4:null,items};
  },{signal});
 }
 async editWrite(command){return this.workspace.withLock(()=>this.editWriteLocked(command));}
 async editWriteLocked(command){return this.workspace.catalogue(store=>this.context(store,command,async(plan,document)=>{
  const edits=new RecordDraftEdits(store),retry=await edits.replay(plan,command);if(retry)return retry;
  if(plan.saved)throw new AppError('DRAFT_CHANGED');
  const checkpoint=await this.drafts.read(plan.draftId,{expand:false,header:true});
  if(!checkpoint||checkpoint.revision!==plan.draftRevision)throw new AppError('DRAFT_CHANGED');
  if(plan.format===3&&await new RecordDraftRecoveryLedger(store).receipt(plan.draftId,plan.draftRevision,plan.sourcePosition))throw new AppError('DRAFT_CHANGED');
  return edits.write(plan,document,command);
 }));}
 async content(command,{signal}={}){
  if(!natural(command?.offset))invalid();
  return this.workspace.catalogue(store=>this.context(store,command,async(plan,document)=>{
   const mine=new RecordDocument(document.blocks,plan.roots.mine),title=(await mine.field(['title'],{signal})).value;
   const body=command.offset===0?(await mine.field(['body'],{signal})).value:null,sections=await mine.tree.page(mine.root,['sections'],{offset:command.offset,limit:4});
   signal?.throwIfAborted();return {id:plan.draftId,workspaceId:plan.workspaceId,revision:plan.draftRevision,recordId:plan.recordId,title,body,sections};
  }));
 }
 async context(store,command,consume,{retryChoice=false}={}){
  if(!command||!researchId(command.workspaceId)||!revisionId(command.id)||!revisionId(command.expectedRevision))invalid();
  if((await store.snapshot()).metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  const plan=await store.object(prefix+command.id);if(!plan)throw new AppError('DRAFT_CHANGED');this.validate(plan);
  if(plan.workspaceId!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');await verifyDraftPlanOrigin(store,plan);
  const stale=revision(plan)!==command.expectedRevision;
  if(stale&&!retryChoice)throw new AppError('DRAFT_CHANGED');
  return withRecordBlockStore(store,plan.notebookId,plan.generation,(blocks,owner)=>consume(plan,new RecordDocument(blocks,plan.roots.stored??plan.roots.mine,{mutable:owner===store}),stale));
 }
 async conflict(document,plan,position){
  if(!natural(position)||position>=plan.count)invalid();
  const {values}=await document.tree.page(plan.conflicts,[],{offset:position,limit:1}),value=values[0];
  if(!value||!Array.isArray(value.path)||value.path.some(part=>typeof part!=='string')||!['base','mine','stored'].every(name=>value[name]===null||revisionId(value[name])))throw new AppError('CATALOGUE_DAMAGED');return value;
 }
 async page(command){
  if(!natural(command?.offset))invalid();
  return this.workspace.catalogue(store=>this.context(store,command,async(plan,document)=>{
   const items=[],index=indexFor(store);
   for(let position=command.offset;position<Math.min(plan.count,command.offset+4);position++){
    const item=await this.conflict(document,plan,position),entry=await index.find({root:plan.choices},pathKey(item.path)),choice=entry?await document.tree.read(entry.revision):null;
    items.push({position,path:item.path,choice:choice?.version??null});
   }return {...this.summary(plan),offset:command.offset,items};
  }));
 }
 async value(command,{signal}={}){
  if(!natural(command?.position)||!natural(command?.offset)||!['base','mine','stored'].includes(command.version))invalid();
  return this.workspace.catalogue(store=>this.context(store,command,async(plan,document)=>{
   const item=await this.conflict(document,plan,command.position),ref=item[command.version];if(ref===null)return {missing:true,text:'',offset:0,next:null};
   let position=0,text='',more=false;
   for await(const chunk of document.tree.json(ref,{signal})){
    const start=Math.max(0,command.offset-position),room=4096-text.length;
    if(start<chunk.length){text+=chunk.slice(start,start+room);if(chunk.length-start>room){more=true;break;}}
    position+=chunk.length;
   }
   signal?.throwIfAborted();return {missing:false,text,offset:command.offset,next:more?command.offset+text.length:null};
  }));
 }
 async choose(command){
  if(!natural(command?.position)||!['mine','stored'].includes(command.version))invalid();
  return this.workspace.withLock(()=>this.workspace.catalogue(store=>this.context(store,command,async(plan,document,stale)=>{
   if(plan.saved)throw new AppError('DRAFT_CHANGED');
   await new RecordDraftEdits(store).assertCurrent(plan);
   const item=await this.conflict(document,plan,command.position),key=pathKey(item.path),index=indexFor(store),before=await index.find({root:plan.choices},key);
   if(stale){const choice=before?await document.tree.read(before.revision):null;if(choice?.version===command.version&&choice.value===item[command.version])return this.summary(plan);throw new AppError('DRAFT_CHANGED');}
   const choices=await index.change(plan.choices,key,await document.tree.retain({version:command.version,value:item[command.version],basis:item}));await index.flush(choices);await document.blocks.flush();
   const next={...plan,choices,decided:plan.decided+(before?0:1)};await store.putObject(prefix+plan.id,next);return this.summary(next);
  },{retryChoice:true})));
 }
 async apply(command){return this.workspace.withLock(()=>this.applyLocked(command));}
 async applyLocked(command){
  return this.workspace.catalogue(store=>this.context(store,command,async(plan,document)=>{
   if(plan.saved)return plan.saved;
   await new RecordDraftEdits(store).assertCurrent(plan);
   const ledger=new RecordDraftRecoveryLedger(store),previous=plan.format===3?await ledger.receipt(plan.draftId,plan.draftRevision,plan.sourcePosition):null;if(previous)return previous.saved;
   const finish=async saved=>{
    await store.putObject(prefix+plan.id,{...plan,saved});
    const remaining=plan.format===3?await ledger.finish(plan):0;
    if(!remaining)await this.drafts.removeLocked({id:plan.draftId,workspaceId:plan.workspaceId,expectedRevision:plan.draftRevision});
    return saved;
   };
   const snapshot=await store.snapshot(),row=await store.member(snapshot,plan.recordId),draft=await this.drafts.read(plan.draftId,{expand:false,header:true});
   if(!draft||draft.revision!==plan.draftRevision)throw new AppError('DRAFT_CHANGED');
   if((row?.revision??null)!==plan.storageRevision)throw new AppError('RECORD_CHANGED');
   if(plan.decided!==plan.count)invalid();
   const index=indexFor(store),merged=await mergeRecordDocuments(document,{...plan.roots,choose:async item=>{
    const entry=await index.find({root:plan.choices},pathKey(item.path));if(!entry)invalid();const choice=await document.tree.read(entry.revision);
    if(!['mine','stored'].includes(choice.version)||choice.value!==item[choice.version])throw new AppError('CATALOGUE_DAMAGED');return choice.value;
   }});
   if(merged===null){
    const saved={recordDraftRecovered:true,recordId:plan.recordId,etag:await store.head(),absent:true};
    return finish(saved);
   }
   // A moved notebook needs its own key and record ownership transaction.
   // Never publish content encrypted under another notebook's key.
   if((await merged.field(['notebookId'])).value!==plan.notebookId)throw new AppError('RECORD_CHANGED');
   const header=await validateRecordDocument(merged,snapshot.metadata),priorRecord=row?document:null;
   await validateDocumentSources(store,snapshot,merged,header,priorRecord,this.media);
   if(!row&&header.template)await validateCurrentRecordTemplate(store,snapshot,merged,header);
   const membership=new RecordMemberCollections(store);let member=row??{id:header.id,collections:{sections:null,contributors:null,relations:null,figures:null,attachments:null}};
   for(const field of ['sections','contributors','relations','figures','attachments'])member=await membership.changed(member,field,merged);
   member={...member,...await recordDocumentSummary(merged,header,{revision:row?.revision??plan.roots.mine,memberBytes:row?.bytes??0},{collections:member.collections})};
   const result=await commitRecordDocument(store,{etag:await store.head(),snapshot,row,document:merged,member}),saved={recordDraftRecovered:true,recordId:plan.recordId,etag:result.etag};
   return finish(saved);
  }));
 }
}

// Validate the review's meaning as well as its authenticated envelopes. Use
// scratch blocks while recomputing conflicts so backup verification is read-only.
export async function verifyRecordDraftReviews(store,{signal}={}){
 const review=new RecordDraftReview(store.workspace),workspaceId=(await store.snapshot()).metadata.id;
 await new RecordDraftRecoveryLedger(store).verify(workspaceId,{signal});
 await verifyRecordDraftEdits(store,{signal});
 const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
 for await(const id of store.objectIdEntries(prefix,{signal})){
  signal?.throwIfAborted();const plan=await store.object(id);review.validate(plan);
  if(id!==prefix+plan.id||plan.workspaceId!==workspaceId||(plan.choices?.count??0)!==plan.decided)fail();
  if(plan.format===3&&plan.saved&&(await new RecordDraftRecoveryLedger(store).receipt(plan.draftId,plan.draftRevision,plan.sourcePosition))?.id!==plan.id)fail();
  await verifyDraftPlanOrigin(store,plan);await verifyRecordDraftPlan(store,plan,{signal});
 }
}

// A transferred original plan keeps its source namespace and content addresses.
// The adapter authenticates that origin before invoking the same semantic check.
export async function verifyRecordDraftPlan(store,plan,{signal}={}){
 const review=new RecordDraftReview(store.workspace),fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};review.validate(plan);
 if((plan.choices?.count??0)!==plan.decided)fail();
 await withRecordBlockStore(store,plan.notebookId,plan.generation,blocks=>withRecordProjectionScratch(new RecordDocument(blocks,plan.roots.stored??plan.roots.mine),async document=>{
   if(plan.editRevision){const edits=new RecordDraftEdits(store),node=await edits.node(plan.editRevision),root=node.notebookId===plan.notebookId&&node.generation===plan.generation?node.root:await edits.document(node,doc=>copyRecordValue(doc,document,doc.root,{signal}));if(!edits.matches(plan,node.owner)||root!==plan.roots.mine)fail();}
   if(await document.tree.arrayLength(plan.conflicts,[])!==plan.count)fail();
   for(const root of Object.values(plan.roots)){
    if(root===null)continue;
    if((await document.tree.selected(root,['id'])).value!==plan.recordId)fail();
    for await(const chunk of document.tree.json(root,{signal}))void chunk;
   }
   let position=0,decided=0;const index=indexFor(store);
   await mergeRecordDocuments(document,{...plan.roots,signal,choose:async item=>{
    if(position>=plan.count)fail();const retained=await review.conflict(document,plan,position++);
    if(serialize(retained)!==serialize(item))fail();
    const entry=await index.find({root:plan.choices},pathKey(item.path));
    if(entry){const choice=await document.tree.read(entry.revision);if(!['mine','stored'].includes(choice?.version)||choice.value!==item[choice.version])fail();decided++;}
    return item.stored;
   }});
   if(position!==plan.count||decided!==plan.decided)fail();
   if(plan.saved&&(!plan.saved.recordDraftRecovered||plan.saved.recordId!==plan.recordId||!revisionId(plan.saved.etag)))fail();
  },{signal}));
}

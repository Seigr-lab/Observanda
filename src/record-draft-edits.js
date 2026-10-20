import {hasNestedPreparationContinuations} from './web/attempt-model.js';
import {attemptValueField} from './web/record-attempt-value.js';
import {recordOwnerDraftArchived} from './record-owner-drafts.js';
// Corrections belong to the original checkpoint, independently of whichever
// saved revision is currently being reviewed. Immutable edit receipts make
// interrupted writes retryable and retain every prior checkpoint value.
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {RecordDocument} from './record-document.js';
import {withRecordBlockStore} from './record-block-store.js';
import {copyRecordValue} from './record-document-copy.js';
import {withRecordProjectionScratch} from './record-projection-scratch.js';
import {selectDraftEdit,replaceDraftEdit,validDraftEdit} from './record-draft-edit-values.js';
import {catalogueFormat,catalogueRequiresNestedAttemptCollections,requireNestedAttemptCollections,requireDraftEdits,requireRecordTypeDrafts} from './catalogue-format.js';
const headPrefix='record-draft-edit-head:',nodePrefix='record-draft-edit:',operationPrefix='record-draft-edit-operation:';
const hash=value=>digest(serialize(value)),fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const owner=plan=>({workspaceId:plan.workspaceId,recordId:plan.recordId,draftId:plan.draftId,draftRevision:plan.draftRevision,position:plan.sourcePosition??0});
export const draftEditOwner=owner;
export class RecordDraftEdits{
 constructor(store){this.store=store;}
 async head(plan){const identity=owner(plan),value=await this.store.object(headPrefix+hash(identity))??await recordOwnerDraftArchived(this.store,'head',hash(identity));if(value&&(!revisionId(value.revision)||hash(value.owner)!==hash(identity)))fail();if(value)return value.revision;return plan.origin?this.head({...plan.origin,sourcePosition:plan.origin.position}):null;}
 matches(plan,value){return hash(value)===hash(owner(plan))||plan.origin&&hash(value)===hash(owner({...plan.origin,sourcePosition:plan.origin.position}));}
 async plan(id){return await this.store.object('record-draft-review:'+id)??await recordOwnerDraftArchived(this.store,'review',id);}
 async node(id){if(!revisionId(id))fail();const node=await this.store.object(nodePrefix+id)??await recordOwnerDraftArchived(this.store,'edit',id);if(!node||hash(node)!==id||![node.before,node.root,node.value,node.planId,node.requestHash,node.owner?.draftRevision].every(revisionId)||node.previous!==null&&!revisionId(node.previous)||![node.notebookId,node.operationId,node.owner?.workspaceId,node.owner?.recordId,node.owner?.draftId].every(researchId)||!Number.isSafeInteger(node.generation)||node.generation<1||!Number.isSafeInteger(node.owner.position)||node.owner.position<0)fail();if(node.field==='type'&&await catalogueFormat(this.store.db)<13)fail();return node;}
 async document(node,consume){return withRecordBlockStore(this.store,node.notebookId,node.generation,(blocks,owner)=>consume(new RecordDocument(blocks,node.root,{mutable:owner===this.store})));}
 async mine(plan,document,consume){
  const revision=await this.head(plan);if(!revision)return consume(new RecordDocument(document.blocks,plan.roots.mine,{mutable:true}),null);
  const node=await this.node(revision);if(!this.matches(plan,node.owner))fail();return this.document(node,doc=>consume(doc,revision));
 }
 async assertCurrent(plan){if((await this.head(plan))!==(plan.editRevision??null))throw new AppError('DRAFT_CHANGED');}
 async replay(plan,command){
  if(!researchId(command.operationId)||command.editRevision!==null&&!revisionId(command.editRevision)||!revisionId(command.valueRevision)||!validDraftEdit(command.field,command.value))throw new AppError('INVALID');
  const id=await this.store.object(operationPrefix+command.operationId);if(!id)return null;
  const node=await this.node(id.revision);if(node.requestHash!==hash(command)||hash(node.owner)!==hash(owner(plan)))throw new AppError('DRAFT_CHANGED');
  return {editRevision:id.revision,revision:hash(command.value),checkpointed:true};
 }
 async write(plan,document,command){
  return this.mine(plan,document,async(mine,previous)=>{
   if(command.editRevision!==previous)throw new AppError('DRAFT_CHANGED');
   const selected=await selectDraftEdit(mine,command.field);if(selected.revision!==command.valueRevision)throw new AppError('DRAFT_CHANGED');
   await (attemptValueField(command.field)?.kind==='preparation'&&hasNestedPreparationContinuations(command.value?.value)?requireNestedAttemptCollections:command.field==='type'?requireRecordTypeDrafts:requireDraftEdits)(this.store.db);
   const next=await replaceDraftEdit(mine,command.field,command.value,selected);await next.blocks.flush();
   const node={owner:owner(plan),operationId:command.operationId,requestHash:hash(command),planId:plan.id,previous,notebookId:next.blocks.scopeId,generation:next.blocks.generation,before:mine.root,root:next.root,field:command.field,value:await next.tree.retain(command.value)};
   await next.blocks.flush();const revision=hash(node);
   await this.store.putObject(nodePrefix+revision,node);
   await this.store.putObject(headPrefix+hash(node.owner),{owner:node.owner,revision});
   await this.store.putObject(operationPrefix+command.operationId,{revision});
   return {editRevision:revision,revision:hash(command.value),checkpointed:true};
  });
 }
}
export async function verifyRecordDraftEdits(store,{signal}={}){
 const edits=new RecordDraftEdits(store),workspaceId=(await store.snapshot()).metadata.id,format=await catalogueFormat(store.db);
 for await(const id of store.objectIdEntries(nodePrefix,{signal})){
  signal?.throwIfAborted();if(format<10)fail();const revision=id.slice(nodePrefix.length),node=await edits.node(revision),plan=await store.object('record-draft-review:'+node.planId);
  if(node.owner.workspaceId!==workspaceId||!plan||hash(owner(plan))!==hash(node.owner)||(await store.object(operationPrefix+node.operationId))?.revision!==revision)fail();
  await verifyRecordDraftEdit(store,node,{signal});
 }
 for await(const id of store.objectIdEntries(headPrefix,{signal})){
  const head=await store.object(id),node=await edits.node(head?.revision);
  if(id!==headPrefix+hash(node.owner)||hash(head.owner)!==hash(node.owner))fail();
 }
 for await(const id of store.objectIdEntries(operationPrefix,{signal})){
  const receipt=await store.object(id),node=await edits.node(receipt?.revision);if(id!==operationPrefix+node.operationId)fail();
 }
}

export async function verifyRecordDraftEdit(store,node,{signal}={}){
 const edits=new RecordDraftEdits(store),plan=await edits.plan(node.planId);if(!plan||!edits.matches(plan,node.owner))fail();
  const previous=node.previous?await edits.node(node.previous):null;
  if(previous&&!edits.matches(plan,previous.owner))fail();
  await edits.document(node,source=>withRecordProjectionScratch(source,async document=>{
   const base=previous??{...plan,root:plan.roots.mine};
   // Shared immutable roots already authenticate unchanged fields. Only a key
   // boundary needs a streaming copy; ordinary edits verify the selected path.
   const expected=base.notebookId===node.notebookId&&base.generation===node.generation?base.root:await edits.document(base,doc=>copyRecordValue(doc,document,doc.root,{signal}));
   if(expected!==node.before)fail();
   const before=new RecordDocument(document.blocks,node.before,{mutable:true}),value=await document.tree.read(node.value),selected=await selectDraftEdit(before,node.field,{signal});
   if(attemptValueField(node.field)?.kind==='preparation'&&hasNestedPreparationContinuations(value?.value)&&!catalogueRequiresNestedAttemptCollections(await catalogueFormat(store.db)))fail();
   if(!validDraftEdit(node.field,value)||(await replaceDraftEdit(before,node.field,value,selected)).root!==node.root)fail();
   if((await document.field(['id'])).value!==node.owner.recordId)fail();
  },{signal}));
}

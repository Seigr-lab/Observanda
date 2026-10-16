// Review plans and correction receipts belong to the record and lab book they
// retain, including a not-yet-saved record. Transport indexes cannot override it.
import {RecordDraftReview} from './record-draft-review.js';
import {RecordDraftEdits,draftEditOwner} from './record-draft-edits.js';
import {projectDraftRecordOwner} from './project-authoring-draft-ownership.js';
import {digest,serialize} from './storage-format.js';
import {revisionId} from './web/revision-model.js';
import {AppError} from './errors.js';
const hash=value=>digest(serialize(value)),damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export function projectDraftReviewReader(store,inventory,{signal}={}){
 const review=new RecordDraftReview(store.workspace),edits=new RecordDraftEdits(store);
 async function plan(id){if(!revisionId(id))damaged();const value=await store.object('record-draft-review:'+id);review.validate(value);if(value.id!==id||value.workspaceId!==inventory.namespaceId)damaged();return value;}
 return async(kind,id)=>{
  signal?.throwIfAborted();let value,recordId;
  if(kind==='plan'){value=await plan(id);recordId=value.recordId;}
  else if(kind==='edit'){
   value=await edits.node(id);if(value.owner.workspaceId!==inventory.namespaceId)damaged();recordId=value.owner.recordId;
   const source=await plan(value.planId);if(hash(draftEditOwner(source))!==hash(value.owner)||source.notebookId!==value.notebookId)damaged();
  }else throw new AppError('INVALID');
  const fact=await projectDraftRecordOwner(inventory,{recordId,notebookId:value.notebookId});return {value,...fact};
 };
}

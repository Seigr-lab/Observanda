import {MetadataFeed} from './metadata-feed.js';
import {revisionText} from './web/revision-model.js';
import {validMaterialReference} from './web/material-reference.js';
// Staged evidence keeps canonical revision bytes unchanged. Only the owning
// intake completion makes its heads available to ordinary material readers.
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {validIndexRef} from './object-index.js';
import {digest,serialize} from './storage-format.js';
import {readRecordOwnerTransfer,readRecordOwnerPreviousTransfer,readRecordOwnerFence} from './record-owner-transfer-state.js';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export async function materialBatch(workspace,id){
 if(!researchId(id))damaged();
 let raw=await workspace.readMetadata('.observanda/materials/intakes/'+id+'/batch.json',131072),local=false;
 if(raw===null){raw=await workspace.readMetadata('.observanda/intake/finalization/'+id+'/batch.json',131072);local=true;}
 let batch;try{batch=JSON.parse(raw);}catch{damaged();}
 if(!batch||batch.format!==1||batch.id!==id||!researchId(batch.command?.recordId)||!['open','processing','completed'].includes(batch.state))damaged();
 if(local&&(batch.owner!=='local-intake'||!revisionId(batch.pin)||!revisionId(batch.preparedIdentity)||!revisionId(batch.sourceStamp)||!Number.isFinite(Date.parse(batch.createdAt))||!['processing','completed'].includes(batch.state)||batch.acquisition?.kind!=='record'||batch.acquisition.id!==batch.command.recordId||!revisionId(batch.acquisition.revision)))damaged();
 if(!local&&batch.owner!==undefined)damaged();
 const value=batch.finalization;
 // Ordinary batches create their first frontier in the same transaction as the
 // first artifact group. Until that transaction commits they stay unpublished.
 if(!local&&value===undefined&&batch.state!=='completed')return batch;
 if(!value||value.version!==1||!Number.isSafeInteger(value.count)||value.count<0||!Number.isSafeInteger(batch.command.count)||value.count>batch.command.count||!researchId(value.segmentId)||!value.inputsIndex||value.inputsIndex.format!==1||value.inputsIndex.kind!=='references'||value.inputsIndex.count!==value.count||value.inputsIndex.chunkSize!==64||!validIndexRef(value.inputsIndex.root)||(value.inputsIndex.root?.count??0)!==Math.ceil(value.count/64))damaged();
 if(batch.state==='completed'&&(value.count!==batch.command.count||(local?!revisionId(batch.result?.recordRevision)||batch.result.pin!==batch.pin:batch.result?.kind!=='collection'||batch.result.id!==id||!revisionId(batch.result.revision))))damaged();
 if(local&&batch.state==='completed'){const proof=batch.completionProof;if(!proof||proof.pin!==batch.pin||proof.preparedIdentity!==batch.preparedIdentity||proof.finalization!==digest(serialize(batch.finalization))||!['sourceStamp','evidenceRevision','execution'].every(key=>revisionId(proof[key]))||!Number.isSafeInteger(proof.generation)||proof.generation<0)damaged();}
 return batch;
}
export async function materialOwnerTransfer(workspace,id,recordId){
 if(!researchId(id)||!researchId(recordId))damaged();
 return workspace.catalogue(async store=>{const receipt=await readRecordOwnerTransfer(store,id),snapshot=await store.snapshot();if(!receipt||receipt.targetOwner.workspaceId!==snapshot.metadata.id||receipt.command.recordId!==recordId)damaged();return receipt;});
}
export async function materialHeadVisible(workspace,head){
 if(head?.ownerTransfer!==undefined){if(head.stagedBatch!==undefined||!['artifact','dataset','analysis','collection'].includes(head.kind))damaged();return (await materialOwnerTransfer(workspace,head.ownerTransfer,head.recordId)).phase==='complete';}
 if(!head||head.stagedBatch===undefined)return true;
 const batch=await materialBatch(workspace,head.stagedBatch);
 if(head.kind!=='artifact'||head.recordId!==batch.command.recordId)damaged();
 return batch.state==='completed';
}

// Headless retained revisions (for example retired originals) need the same
// activation gate as staged current heads.
const priorKey=(id,ref)=>'record-owner-evidence-prior:'+id+':'+ref.kind+':'+ref.id+':'+ref.revision;
const returnKey=id=>'material-return-head:'+id;
const copyKey=ref=>'record-owner-evidence-copy:'+ref.kind+':'+ref.id+':'+ref.revision;
const same=(a,b)=>revisionText(a)===revisionText(b);
const assertPriorCheckpoint=(value,id,ref,recordId)=>{
 if(!value||value.version!==1||Object.keys(value).sort().join()!==['version','transferId','kind','id','revision','recordId','retained'].sort().join()||value.transferId!==id||value.kind!==ref.kind||value.id!==ref.id||value.revision!==ref.revision||value.recordId!==recordId||typeof value.retained!=='boolean')damaged();
};
export async function stageRecordOwnerMaterialIdentity(workspace,receipt,ref,doc,{store}={}){
 if(!store||!validMaterialReference(ref)||ref.kind==='record'||doc?.recordId!==receipt.command.recordId||doc.id!==ref.id||doc.kind!==ref.kind||digest(revisionText(doc))!==ref.revision)damaged();
 const saved=await materialOwnerTransfer(workspace,receipt.id,doc.recordId);if(saved.fingerprint!==receipt.fingerprint||!['copying','verified','activating'].includes(saved.phase))damaged();
 const key=priorKey(receipt.id,ref),checkpoint=await store.object(key);
 if(!checkpoint){
  const previous=await readRecordOwnerPreviousTransfer(store,saved),raw=await workspace.readMetadata('.observanda/materials/objects/'+ref.id+'/'+ref.revision+'.json',16*1024*1024);
  let retained=false;if(previous&&raw!==null){let value;try{value=JSON.parse(raw);}catch{damaged();}if(!same(value,doc))damaged();retained=await materialCopyAvailability(store,ref,doc.recordId)!==false;}
  await store.putObject(key,{version:1,transferId:receipt.id,kind:ref.kind,id:ref.id,revision:ref.revision,recordId:doc.recordId,retained});
 }else assertPriorCheckpoint(checkpoint,receipt.id,ref,doc.recordId);
 await store.putObject(copyKey(ref),{version:1,transferId:receipt.id,kind:ref.kind,id:ref.id,revision:ref.revision,recordId:doc.recordId});
 const identity='record-owner-evidence-identity:'+ref.kind+':'+ref.id,prior=await store.object(identity);
 if(prior&&prior.recordId!==doc.recordId)damaged();
 await store.putObject(identity,{version:1,kind:ref.kind,id:ref.id,recordId:doc.recordId,transferId:receipt.id});
}
export async function materialReferenceVisible(workspace,ref,head){
 if(await workspace.storageKind()!=='catalogue')return !head||materialHeadVisible(workspace,head);
 return workspace.catalogue(async store=>{
  const key='record-owner-evidence-identity:'+ref.kind+':'+ref.id,value=await store.object(key);
  if(value){
   if(value.version!==1||Object.keys(value).sort().join()!==['version','kind','id','recordId','transferId'].sort().join()||value.kind!==ref.kind||value.id!==ref.id||!researchId(value.recordId)||!researchId(value.transferId))damaged();
   const receipt=await materialOwnerTransfer(workspace,value.transferId,value.recordId);
   if(receipt.phase!=='complete'){
    const prior=await store.object(priorKey(receipt.id,ref));
    if(!prior){
     // Every incoming original gets its immutable per-revision checkpoint
     // before bytes are copied. An unvisited exact local revision therefore
     // remains a former-owner original, without pinning a mutable index root.
     if(!await readRecordOwnerPreviousTransfer(store,receipt)||await materialCopyAvailability(store,ref,value.recordId)===false)return false;
     const raw=await workspace.readMetadata('.observanda/materials/objects/'+ref.id+'/'+ref.revision+'.json',16*1024*1024);if(raw===null)return false;
     let doc;try{doc=JSON.parse(raw);}catch{damaged();}if(doc.kind!==ref.kind||doc.id!==ref.id||doc.recordId!==value.recordId||digest(revisionText(doc))!==ref.revision)damaged();return true;
    }
    assertPriorCheckpoint(prior,receipt.id,ref,value.recordId);if(!prior.retained)return false;
    if(!await readRecordOwnerPreviousTransfer(store,receipt))damaged();return true;
   }
  }
  return !head||materialHeadVisible(workspace,head);
 });
}
export async function materialReturnState(workspace,id){
 if(await workspace.storageKind()!=='catalogue')return null;
 return workspace.catalogue(async store=>{
  const value=await store.object(returnKey(id));if(!value)return null;
  if(value.version!==1||value.id!==id||!researchId(value.recordId)||!researchId(value.transferId)||typeof value.settled!=='boolean'||value.head!==null&&(!validMaterialReference(value.head)||value.head.id!==id||value.head.recordId!==value.recordId||value.head.ownerTransfer!==value.transferId||value.head.stagedBatch!==undefined))damaged();
  const placement=value.previousItem??value.previousRetired;if(!placement||placement.id!==id||value.head&&placement.kind!==value.head.kind||placement.recordId!==value.recordId)damaged();
  const receipt=await materialOwnerTransfer(workspace,value.transferId,value.recordId);if(!await readRecordOwnerPreviousTransfer(store,receipt))damaged();return {...value,receipt,placement};
 });
}
export async function stageMaterialReturnHead(materials,head){
 const workspace=materials.workspace;return workspace.catalogue(async store=>{
  const receipt=await materialOwnerTransfer(workspace,head.ownerTransfer,head.recordId),previous=await readRecordOwnerPreviousTransfer(store,receipt);if(!previous)return false;
  const fence=await readRecordOwnerFence(store,head.recordId);if(fence?.id!==receipt.id||fence.direction!=='incoming'||await store.member(await store.snapshot(),head.recordId))damaged();
  let overlay=await materialReturnState(workspace,head.id);
  if(overlay?.transferId===receipt.id){if(!same(overlay.head,head))damaged();return true;}
  if(overlay&&!overlay.settled&&overlay.receipt.phase!=='cancelled')await settleMaterialReturnHead(workspace,head.id);
  const read=async relative=>{const raw=await workspace.readMetadata(relative,16*1024*1024);if(raw===null)return null;try{return JSON.parse(raw);}catch{damaged();}};
  const previousHead=await read('.observanda/materials/objects/'+head.id+'/head.json'),previousItem=await read('.observanda/materials/index/items/'+head.id+'.json'),retired=await read('.observanda/materials/index/retired/'+head.id+'.json'),previousRetired=retired?.item??null,placement=previousItem??previousRetired;
  if(!placement){if(previousHead)damaged();return false;}
  if(placement.id!==head.id||placement.kind!==head.kind||placement.recordId!==head.recordId||previousHead&&(previousHead.id!==head.id||previousHead.kind!==head.kind||previousHead.recordId!==head.recordId)||previousItem&&!previousHead)damaged();
  await store.putObject('material-return-inherited:'+receipt.id+':'+head.id,{version:1,transferId:receipt.id,id:head.id,recordId:head.recordId,placement});
  await store.putObject(returnKey(head.id),{version:1,id:head.id,recordId:head.recordId,transferId:receipt.id,head,previousHead,previousItem,previousRetired,settled:false});return true;
 });
}
const inheritedHead=value=>{
 const {ownerTransfer,stagedBatch,...plain}=value.head;void ownerTransfer;void stagedBatch;
 return {...plain,...(value.placement.ownerTransfer?{ownerTransfer:value.placement.ownerTransfer}:{}),...(value.placement.stagedBatch?{stagedBatch:value.placement.stagedBatch}:{})};
};
export async function materialReturnedHead(workspace,id,head,{includeStaged=false}={}){
 const value=await materialReturnState(workspace,id);if(!value||value.settled)return head;
 if(!same(head,value.previousHead))damaged();
 return value.receipt.phase==='complete'?(value.head?inheritedHead(value):null):includeStaged&&value.head&&value.receipt.phase!=='cancelled'?value.head:head;
}
export async function materialReturnedItem(workspace,id,item){const value=await materialReturnState(workspace,id);return value&&!value.settled&&value.receipt.phase==='complete'?(value.head?value.placement:null):item;}
export async function materialReturnedRetired(workspace,id,item){const value=await materialReturnState(workspace,id);return value&&!value.settled&&value.receipt.phase==='complete'?(value.head?null:(value.placement.ownerTransfer||value.placement.stagedBatch?value.placement:null)):item;}
export async function materialInheritedSegment(workspace,segment,ref){return workspace.catalogue(async store=>{
 const value=await store.object('material-return-inherited:'+segment.batchId+':'+ref.id);if(!value)return false;
 if(value.version!==1||value.id!==ref.id||value.recordId!==segment.recordId||value.transferId!==segment.batchId||value.placement?.id!==ref.id||value.placement.kind!==ref.kind||value.placement.recordId!==segment.recordId)damaged();
 const receipt=await materialOwnerTransfer(workspace,value.transferId,value.recordId);if(!await readRecordOwnerPreviousTransfer(store,receipt)||receipt.phase!=='complete')damaged();return true;
 });}
export async function settleMaterialReturnHead(workspace,id){
 const value=await materialReturnState(workspace,id);if(!value||value.settled)return;
 if(value.receipt.phase!=='complete')throw new AppError('RECORD_TRANSFER_BUSY');
 if(value.head){
  await workspace.writeMetadata('.observanda/materials/objects/'+id+'/head.json',JSON.stringify(inheritedHead(value)));
  await workspace.writeMetadata('.observanda/materials/index/items/'+id+'.json',JSON.stringify(value.placement));
  if(value.previousRetired)await workspace.removeMetadata('.observanda/materials/index/retired/'+id+'.json');
 }else{
  await workspace.removeMetadata('.observanda/materials/objects/'+id+'/head.json');await workspace.removeMetadata('.observanda/materials/index/items/'+id+'.json');
  if(value.placement.ownerTransfer||value.placement.stagedBatch)await workspace.writeMetadata('.observanda/materials/index/retired/'+id+'.json',JSON.stringify({version:1,item:value.placement}));
  else for(const recordId of [null,value.recordId])for(const kind of [null,value.placement.kind]){const feed=new MetadataFeed(workspace,'.observanda/materials/index/heads/'+(recordId??'all')+'/'+(kind??'all'));await workspace.removeMetadata(feed.order+'/'+feed.key(value.placement));}
 }
 const {receipt,placement,...stored}=value;void receipt;void placement;await workspace.catalogue(store=>store.putObject(returnKey(id),{...stored,settled:true}));
}

export async function stageMaterialReturnRetirement(materials,receipt,ref){
 const workspace=materials.workspace;return workspace.catalogue(async store=>{
  if(!await readRecordOwnerPreviousTransfer(store,receipt))return false;
  const fence=await readRecordOwnerFence(store,receipt.command.recordId);if(fence?.id!==receipt.id||fence.direction!=='incoming'||await store.member(await store.snapshot(),receipt.command.recordId))damaged();
  const prior=await materialReturnState(workspace,ref.id);if(prior?.transferId===receipt.id){if(prior.head!==null)damaged();return true;}if(prior&&!prior.settled&&prior.receipt.phase!=='cancelled')await settleMaterialReturnHead(workspace,ref.id);
  const read=async name=>{const raw=await workspace.readMetadata(name,16*1024*1024);if(raw===null)return null;try{return JSON.parse(raw);}catch{damaged();}};
  const previousHead=await read('.observanda/materials/objects/'+ref.id+'/head.json'),previousItem=await read('.observanda/materials/index/items/'+ref.id+'.json'),retired=await read('.observanda/materials/index/retired/'+ref.id+'.json'),previousRetired=retired?.item??null,placement=previousItem??previousRetired;
  if(!placement){if(previousHead)damaged();return false;}if(placement.id!==ref.id||placement.kind!==ref.kind||placement.recordId!==receipt.command.recordId)damaged();
  await store.putObject(returnKey(ref.id),{version:1,id:ref.id,recordId:receipt.command.recordId,transferId:receipt.id,head:null,previousHead,previousItem,previousRetired,settled:false});return true;
 });
}

// A cancelled copy cannot become an old local original merely because a later
// return has not visited that revision yet. This pointer precedes every copy.
export async function materialCopyAvailability(store,ref,recordId){
 const value=await store.object(copyKey(ref));if(!value)return null;
 if(value.version!==1||Object.keys(value).sort().join()!==['version','transferId','kind','id','revision','recordId'].sort().join()||value.kind!==ref.kind||value.id!==ref.id||value.revision!==ref.revision||value.recordId!==recordId||!researchId(value.transferId))damaged();
 const receipt=await materialOwnerTransfer(store.workspace,value.transferId,recordId),checkpoint=await store.object(priorKey(value.transferId,ref));
 assertPriorCheckpoint(checkpoint,value.transferId,ref,recordId);
 if(receipt.phase==='complete')return true;if(!checkpoint.retained)return false;if(!await readRecordOwnerPreviousTransfer(store,receipt))damaged();return true;
}

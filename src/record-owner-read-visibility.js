// Public history follows activation, while the transfer engine retains exact
// originals through explicit raw readers. Copy checkpoints precede both saved
// history and standalone retained envelopes and use the public content hash.
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {recordContentRevision} from './record-encoding.js';
import {catalogueFormat,catalogueRequiresRecordOwnerTransfers} from './catalogue-format.js';
import {readRecordOwnerFence,readRecordOwnerTransfer,readRecordOwnerPreviousTransfer,assertRecordOwnerTransferAuthority} from './record-owner-transfer-state.js';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.slice().sort().join();
const priorPrefix='record-owner-revision-prior:',copyPrefix='record-owner-revision-copy:';
const priorKey=(transferId,recordId,revision)=>priorPrefix+transferId+':'+recordId+':'+revision;
const copyKey=(recordId,revision)=>copyPrefix+recordId+':'+revision;
function validate(value,recordId,revision,{retained=false}={}){
 if(!exact(value,['version','transferId','recordId','revision',...(retained?['retained']:[])])||value.version!==1||!researchId(value.transferId)||value.recordId!==recordId||value.revision!==revision||!researchId(recordId)||!revisionId(revision)||retained&&typeof value.retained!=='boolean')damaged();return value;
}
async function owner(store,transferId,recordId){
 const receipt=await readRecordOwnerTransfer(store,transferId);if(!receipt||receipt.command.recordId!==recordId||receipt.targetOwner.workspaceId!==(await store.snapshot()).metadata.id)damaged();return receipt;
}
async function checkpoint(store,transferId,recordId,revision){
 const value=validate(await store.object(priorKey(transferId,recordId,revision)),recordId,revision,{retained:true});if(value.transferId!==transferId)damaged();return value;
}
async function copiedVisibility(store,recordId,revision){
 const value=await store.object(copyKey(recordId,revision));if(!value)return null;validate(value,recordId,revision);
 const receipt=await owner(store,value.transferId,recordId),prior=await checkpoint(store,value.transferId,recordId,revision);
 if(prior.retained&&!await readRecordOwnerPreviousTransfer(store,receipt))damaged();
 return receipt.phase==='complete'||prior.retained;
}
async function storedRevision(store,recordId,revision){
 if(await store.db.get('SELECT 1 FROM records WHERE id=$1 LIMIT 1',recordId)){
  const index=store.historyIndex(recordId),found=await index.lookup(await index.head(),'view',revision,{optional:true});
  if(found){const view=await index.display(found.item);if(view.revision!==revision)damaged();return true;}
 }
 const text=await store.workspace.readMetadata('.observanda/materials/records/'+recordId+'/'+revision+'.json',16*1024*1024);if(text===null)return false;
 let value;try{value=JSON.parse(text);}catch{damaged();}
 // A modern pointer must have its saved history above; only a standalone old
 // envelope can authenticate a public revision without a history-index row.
 if(value?.format==='observanda-retained-record'||value?.id!==recordId||recordContentRevision(value)!==revision)damaged();return true;
}
export async function recordOwnerRevisionVisible(store,recordId,revision){
 if(!researchId(recordId)||!revisionId(revision))throw new AppError('INVALID');
 const copied=await copiedVisibility(store,recordId,revision);if(copied!==null)return copied;
 const fence=await readRecordOwnerFence(store,recordId);if(!fence)return true;
 const namespaceId=(await store.snapshot()).metadata.id,expected=fence.direction==='incoming'?fence.transfer.targetOwner:fence.transfer.sourceOwner;if(expected.workspaceId!==namespaceId)damaged();
 if(fence.direction==='outgoing'||fence.transfer.phase==='complete')return true;
 // Every new public revision is checkpointed before copying. An unvisited
 // local revision can therefore belong to the former owner, never this copy.
 return !!await readRecordOwnerPreviousTransfer(store,fence.transfer);
}
export async function assertRecordOwnerRevisionVisible(store,recordId,revision,{code='MATERIAL_INCOMPLETE'}={}){
 if(!await recordOwnerRevisionVisible(store,recordId,revision))throw new AppError(code);
}
export async function stageRecordOwnerRevision(store,receipt,revision){
 const recordId=receipt?.command?.recordId;if(!researchId(recordId)||!revisionId(revision))throw new AppError('INVALID');
 const authority=assertRecordOwnerTransferAuthority(store),saved=await owner(store,receipt.id,recordId),fence=await readRecordOwnerFence(store,recordId);
 if(authority.id!==receipt.id||authority.recordId!==recordId||saved.fingerprint!==receipt.fingerprint||!['copying','verified','activating'].includes(saved.phase)||fence?.id!==receipt.id||fence.direction!=='incoming')damaged();
 const key=priorKey(receipt.id,recordId,revision),prior=await store.object(key);
 if(prior){validate(prior,recordId,revision,{retained:true});if(prior.transferId!==receipt.id||prior.retained&&!await readRecordOwnerPreviousTransfer(store,saved))damaged();}
 else{
  const retained=!!await readRecordOwnerPreviousTransfer(store,saved)&&await storedRevision(store,recordId,revision)&&await recordOwnerRevisionVisible(store,recordId,revision);
  await store.putObject(key,{version:1,transferId:receipt.id,recordId,revision,retained});
 }
 await store.putObject(copyKey(recordId,revision),{version:1,transferId:receipt.id,recordId,revision});
}
export async function verifyRecordOwnerRevisionVisibility(store,{signal}={}){
 let admitted=false;const admit=async()=>{if(!admitted){if(!catalogueRequiresRecordOwnerTransfers(await catalogueFormat(store.db)))damaged();admitted=true;}};
 for await(const key of store.objectIdEntries(priorPrefix,{signal})){
  signal?.throwIfAborted();await admit();const value=await store.object(key);validate(value,value?.recordId,value?.revision,{retained:true});if(key!==priorKey(value.transferId,value.recordId,value.revision))damaged();
  const receipt=await owner(store,value.transferId,value.recordId);if(value.retained&&!await readRecordOwnerPreviousTransfer(store,receipt))damaged();
  if((value.retained||receipt.phase==='complete')&&!await storedRevision(store,value.recordId,value.revision))damaged();
  const pointer=await store.object(copyKey(value.recordId,value.revision));validate(pointer,value.recordId,value.revision);
 }
 for await(const key of store.objectIdEntries(copyPrefix,{signal})){
  signal?.throwIfAborted();await admit();const value=await store.object(key);validate(value,value?.recordId,value?.revision);if(key!==copyKey(value.recordId,value.revision))damaged();await copiedVisibility(store,value.recordId,value.revision);
 }
}

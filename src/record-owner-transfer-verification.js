// Verify portable transfer authority against retained local originals. A later
// edit or move does not invalidate the immutable activation receipt.
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {revisionId,revisionText} from './web/revision-model.js';
import {validMaterialReference} from './web/material-reference.js';
import {catalogueFormat,catalogueRequiresRecordOwnerTransfers} from './catalogue-format.js';
import {readRecordOwnerTransfer,readRecordOwnerFence,readRecordOwnerPreviousTransfer,validRecordOwner} from './record-owner-transfer-state.js';
import {readRecordOwnerHistory} from './record-owner-history.js';
import {retainedRecordDisplay} from './record-history-display.js';
import {validRecordOrigin} from './record-owner-provenance.js';
import {withRecordOwnerDocument} from './record-owner-document.js';
import {withRecordDocument} from './record-document.js';
import {verifyStoredRecord} from './record-storage.js';
import {RecordMemberCollections,memberCollectionFields,memberCollectionCount} from './record-member-collections.js';
import {recordDocumentSummary} from './record-document-summary.js';
import {attemptDocumentHeader} from './record-attempt-document.js';
import {recordTemplateHeader} from './record-template-document.js';
import {validMember} from './snapshot-index.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const same=(a,b)=>revisionText(a)===revisionText(b);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.slice().sort().join();
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const terminal=value=>value.phase==='complete'||value.phase==='cancelled'&&value.progress.reclamation?.state!=='pending';
async function verifyMember(store,document,member,{signal}={}){
 if(!validMember(member))fail();const header={};
 for(const field of ['id','notebookId','type','share','occurredOn','updatedAt'])header[field]=(await document.field([field],{signal})).value;
 header.attempt=await attemptDocumentHeader(document,{signal});header.template=await recordTemplateHeader(document,{signal});
 const encoding=await document.encoding({signal}),expected=await recordDocumentSummary(document,header,encoding,{signal,collections:member.collections});
 const {position,queryRevision,summaryRevision,...stored}=member;void position;void queryRevision;void summaryRevision;
 for(const key of ['notebookId','share','occurredOn','updatedAt','template','cardItems'])if(member[key]===undefined)delete expected[key];
 if(!same(stored,expected))fail();
 if(member.collections){const collections=new RecordMemberCollections(store);
  for(const field of memberCollectionFields){
   if(memberCollectionCount(member,field)!==await document.tree.arrayLength(document.root,[field]))fail();let position=0;
   for await(const id of collections.ids(member,field)){signal?.throwIfAborted();if((await document.field([field,String(position++),'id'],{signal})).value!==id)fail();}
  }
 }
 return encoding;
}
export async function verifyRecordOwnerTransfers(store,{signal,verified}={}){
 const current=await store.snapshot(),namespaceId=current.metadata.id,format=await catalogueFormat(store.db);
 const {readRecordOwnerReclamation,verifyRecordOwnerResources}=await import('./record-owner-resources.js');await verifyRecordOwnerResources(store,{signal});
 const capability=()=>{if(!catalogueRequiresRecordOwnerTransfers(format))fail();};
 for await(const {slot} of store.db.rows("SELECT slot FROM state WHERE slot LIKE 'record-owner-transfer:%' ORDER BY slot")){
  signal?.throwIfAborted();capability();const id=slot.slice('record-owner-transfer:'.length);if(!researchId(id))fail();
  const receipt=await readRecordOwnerTransfer(store,id),{command,progress,result}=receipt;
  const cleanupSlot='record-owner-transfer-cleanup:'+id,cleanup=await store.db.get('SELECT payload FROM state WHERE slot=$1',cleanupSlot);
  if(receipt.phase==='cancelled'&&progress.reclamation?.state==='pending'){if(!cleanup||!same(store.decode('state',cleanupSlot,cleanup.payload),{version:1,id,recordId:command.recordId}))fail();}else if(cleanup)fail();
  const activeSlot='record-owner-transfer-active:'+id,active=await store.db.get('SELECT payload FROM state WHERE slot=$1',activeSlot);
  if(!terminal(receipt)){if(!active||!same(store.decode('state',activeSlot,active.payload),{version:1,id,recordId:command.recordId}))fail();}else if(active)fail();
  const source=receipt.sourceOwner.workspaceId===namespaceId,target=receipt.targetOwner.workspaceId===namespaceId;if(source===target)fail();
  let reclaiming=false;
  if(target&&receipt.phase==='cancelled'){
   const reclamation=await readRecordOwnerReclamation(store,id);
   if(reclamation&&(reclamation.version!==1||reclamation.id!==id||reclamation.recordId!==command.recordId||reclamation.namespaceId!==namespaceId))fail();
   if(progress.reclamation&&(!reclamation||progress.reclamation.state==='complete'&&reclamation.state!=='complete'))fail();
   reclaiming=!!reclamation&&['cleaning','complete'].includes(reclamation.state);
  }
  if(progress.previousOwnerTransfer!==undefined){if(!researchId(progress.previousOwnerTransfer))fail();if(target)await readRecordOwnerPreviousTransfer(store,receipt);}
  if(!natural(progress.history)||progress.historyAfter!==null&&progress.historyAfter!==undefined&&!revisionId(progress.historyAfter))fail();
  const fence=await readRecordOwnerFence(store,command.recordId);
  if(!fence||fence.id!==id&&!terminal(receipt))fail();
  if(fence.id===id){
   if(fence.direction!==(source?'outgoing':'incoming'))fail();
   const member=await store.member(current,command.recordId);
   if(source&&['copying','verified','activating'].includes(receipt.phase)&&(!member||member.revision!==command.expectedStorageRevision||member.notebookId!==command.sourceNotebookId))fail();
   if(source&&receipt.phase==='complete'&&member||target&&receipt.phase!=='complete'&&receipt.phase!=='cancelled'&&member)fail();
  }
  if(source){
   const snapshot=await store.snapshot(receipt.sourceSnapshotId),member=await store.member(snapshot,command.recordId);
   if(snapshot.metadata.id!==namespaceId||!member||member.revision!==command.expectedStorageRevision||member.notebookId!==command.sourceNotebookId)fail();
  }
  if(['verified','activating','retiring','complete'].includes(receipt.phase)&&(!progress.prepared||!progress.evidence||!progress.drafts))fail();
  if(['retiring','complete'].includes(receipt.phase)){
   if(!exact(result,['recordId','notebookId','workspaceId','projectId','labBookId','storageRevision'])||result.recordId!==command.recordId||result.notebookId!==command.targetNotebookId||result.workspaceId!==command.targetWorkspaceId||result.projectId!==receipt.targetOwner.projectId||result.labBookId!==receipt.targetOwner.labBookId||result.storageRevision!==progress.prepared?.member?.revision||!revisionId(progress.activatedSnapshotId))fail();
  }else if(result!==null)fail();
  if(target&&progress.prepared&&!reclaiming){
   const {descriptor,member,view}=progress.prepared;
   if(!descriptor||descriptor.notebookId!==command.targetNotebookId||!Number.isSafeInteger(descriptor.generation)||descriptor.generation<1||!revisionId(descriptor.root)||!validMember(member)||member.id!==command.recordId||member.notebookId!==command.targetNotebookId||!view||view.revision!==descriptor.encoding?.contentRevision)fail();
   await withRecordOwnerDocument(store,descriptor,async document=>{const encoding=await verifyMember(store,document,member,{signal});if(!same(encoding,descriptor.encoding))fail();});
   if(receipt.phase==='complete'){
    const snapshot=await store.snapshot(progress.activatedSnapshotId),activated=await store.member(snapshot,command.recordId);
    if(snapshot.metadata.id!==namespaceId||!activated||activated.revision!==result.storageRevision)fail();
    const {position,...retained}=activated;void position;if(!same(retained,member))fail();
    const {verifyRecordOwnerEvidence}=await import('./record-owner-evidence.js');await verifyRecordOwnerEvidence(store.workspace,receipt,progress.evidence,{signal});
   }
  }
 }
 for await(const {slot} of store.db.rows("SELECT slot FROM state WHERE slot LIKE 'record-owner-transfer-cleanup:%' ORDER BY slot")){
  signal?.throwIfAborted();capability();const id=slot.slice('record-owner-transfer-cleanup:'.length);if(!researchId(id)||!await readRecordOwnerTransfer(store,id))fail();
 }
 for await(const {slot} of store.db.rows("SELECT slot FROM state WHERE slot LIKE 'record-owner-transfer-active:%' ORDER BY slot")){
  signal?.throwIfAborted();capability();const id=slot.slice('record-owner-transfer-active:'.length);if(!researchId(id)||!await readRecordOwnerTransfer(store,id))fail();
 }
 for await(const {slot} of store.db.rows("SELECT slot FROM state WHERE slot LIKE 'record-owner-transfer-record:%' ORDER BY slot")){
  signal?.throwIfAborted();capability();const id=slot.slice('record-owner-transfer-record:'.length);if(!researchId(id))fail();
  const fence=await readRecordOwnerFence(store,id),owner=fence.direction==='outgoing'?fence.transfer.sourceOwner:fence.transfer.targetOwner;if(owner.workspaceId!==namespaceId)fail();
 }
 for await(const key of store.objectIdEntries('record-owner-history:')){
  signal?.throwIfAborted();capability();const id=key.slice('record-owner-history:'.length),value=await store.object(key);if(!revisionId(id)||!researchId(value?.recordId))fail();
  const snapshot=await readRecordOwnerHistory(store,id,value.recordId,{verifyConfigurations:true,signal,verified});if(!snapshot)fail();const member=snapshot.records[0];
  await verifyStoredRecord(store,member.id,member.revision,{signal});
  if(snapshot.metadata.formatVersion===21)await withRecordDocument(store,member.id,member.revision,document=>verifyMember(store,document,member,{signal}));
  else await retainedRecordDisplay(store,member.id,member.revision,snapshot.metadata,{signal});
 }
 for await(const key of store.objectIdEntries('record:reference-origin:')){
  signal?.throwIfAborted();capability();const value=await store.object(key);
  if(!validRecordOrigin(value)||key!=='record:reference-origin:'+value.kind+':'+value.id+':'+value.sourceNamespace||value.namespaceId!==namespaceId)fail();
  const receipt=await readRecordOwnerTransfer(store,value.transferId);if(!receipt||receipt.targetOwner.workspaceId!==namespaceId||value.kind==='record'&&receipt.command.recordId!==value.id)fail();
 }
 for await(const key of store.objectIdEntries('record-owner-external:')){
  signal?.throwIfAborted();capability();const value=await store.object(key);
  if(!exact(value,['version','reference','namespaceId','sourceOwner','recordId','transferId'])||value.version!==1||!validMaterialReference(value.reference)||!validRecordOwner(value.sourceOwner)||value.sourceOwner.workspaceId===namespaceId||value.reference.workspaceId&&value.reference.workspaceId!==value.sourceOwner.workspaceId||value.namespaceId!==namespaceId||!researchId(value.recordId)||!researchId(value.transferId))fail();
  const ref=value.reference,expected='record-owner-external:'+digest(serialize({kind:ref.kind,id:ref.id,revision:ref.revision,workspaceId:ref.workspaceId??null}));if(key!==expected)fail();
  const receipt=await readRecordOwnerTransfer(store,value.transferId);if(!receipt||receipt.targetOwner.workspaceId!==namespaceId||receipt.command.recordId!==value.recordId)fail();
 }
 const {verifyRecordOwnerEvidenceReceipts}=await import('./record-owner-audit-metadata.js');await verifyRecordOwnerEvidenceReceipts(store,{signal});
 const {verifyRecordOwnerRevisionVisibility}=await import('./record-owner-read-visibility.js');await verifyRecordOwnerRevisionVisibility(store,{signal});
 for await(const key of store.objectIdEntries('record-owner-reference:')){
  signal?.throwIfAborted();capability();const value=await store.object(key);
  if(!exact(value,['version','id','kind','sourceOwner','targetOwner','recordId','transferId'])||value.version!==1||!['record','artifact','dataset','analysis','collection'].includes(value.kind)||![value.id,value.recordId,value.transferId].every(researchId)||!validRecordOwner(value.sourceOwner)||!validRecordOwner(value.targetOwner)||value.sourceOwner.workspaceId===value.targetOwner.workspaceId||key!=='record-owner-reference:'+value.sourceOwner.workspaceId+':'+value.kind+':'+value.id)fail();
 }
}

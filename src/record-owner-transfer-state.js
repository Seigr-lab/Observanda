// Durable per-record transfer authority. Only the transfer engine's scoped
// transaction may change a fenced record; unrelated records stay writable.
import {AsyncLocalStorage} from 'node:async_hooks';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {digest,serialize} from './storage-format.js';
const permitted=new AsyncLocalStorage();
export const recordOwnerReclamationPending=value=>value?.phase==='cancelled'&&value.progress?.reclamation?.state==='pending';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.slice().sort().join();
export const recordOwnerTransferSlot=id=>'record-owner-transfer:'+id;
export const recordOwnerFenceSlot=id=>'record-owner-transfer-record:'+id;
const cleanupSlot=id=>'record-owner-transfer-cleanup:'+id;
const activeSlot=id=>'record-owner-transfer-active:'+id;
const activeTransfer=value=>!['complete','cancelled'].includes(value.phase)||recordOwnerReclamationPending(value);
export const recordOwnerTransferPhases=Object.freeze(['copying','verified','activating','retiring','complete','cancelled']);
export const validRecordOwner=value=>exact(value,['projectId','labBookId','workspaceId'])&&researchId(value.workspaceId)&&[value.projectId,value.labBookId].every(id=>id===null||researchId(id))&&(value.labBookId===null||value.projectId!==null);
export function validRecordOwnerTransferCommand(value){
 return exact(value,['id','workspaceId','recordId','sourceNotebookId','expectedStorageRevision','targetWorkspaceId','targetNotebookId'])&&['id','workspaceId','recordId','sourceNotebookId','targetWorkspaceId','targetNotebookId'].every(key=>researchId(value[key]))&&revisionId(value.expectedStorageRevision)&&value.workspaceId!==value.targetWorkspaceId;
}
export const recordOwnerTransferFingerprint=(command,sourceOwner,targetOwner)=>digest(serialize({command,sourceOwner,targetOwner}));
export function validRecordOwnerTransfer(value){
 return exact(value,['version','id','fingerprint','command','sourceOwner','targetOwner','phase','sourceSnapshotId','createdAt','updatedAt','progress','result'])&&value.version===1&&validRecordOwnerTransferCommand(value.command)&&value.id===value.command.id&&validRecordOwner(value.sourceOwner)&&validRecordOwner(value.targetOwner)&&value.sourceOwner.workspaceId===value.command.workspaceId&&value.targetOwner.workspaceId===value.command.targetWorkspaceId&&value.fingerprint===recordOwnerTransferFingerprint(value.command,value.sourceOwner,value.targetOwner)&&recordOwnerTransferPhases.includes(value.phase)&&revisionId(value.sourceSnapshotId)&&[value.createdAt,value.updatedAt].every(value=>typeof value==='string'&&Number.isFinite(Date.parse(value)))&&value.progress&&typeof value.progress==='object'&&!Array.isArray(value.progress)&&(value.progress.reclamation===undefined||value.phase==='cancelled'&&exact(value.progress.reclamation,['version','state'])&&value.progress.reclamation.version===1&&['pending','complete'].includes(value.progress.reclamation.state))&&(value.result===null||typeof value.result==='object'&&!Array.isArray(value.result));
}
export async function readRecordOwnerTransfer(store,id){
 if(!researchId(id))throw new AppError('INVALID');const slot=recordOwnerTransferSlot(id),row=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot);if(!row)return null;
 const value=store.decode('state',slot,row.payload);if(!validRecordOwnerTransfer(value)||value.id!==id)throw new AppError('CATALOGUE_DAMAGED');return value;
}
export async function writeRecordOwnerTransfer(store,value){
 if(!validRecordOwnerTransfer(value))throw new AppError('INVALID');const slot=recordOwnerTransferSlot(value.id);
 await store.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload',slot,store.encode('state',slot,value));
 const pending=cleanupSlot(value.id);
 if(recordOwnerReclamationPending(value)){const marker={version:1,id:value.id,recordId:value.command.recordId};await store.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload',pending,store.encode('state',pending,marker));}
 else await store.db.run('DELETE FROM state WHERE slot=$1',pending);
 const active=activeSlot(value.id);
 if(activeTransfer(value))await store.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload',active,store.encode('state',active,{version:1,id:value.id,recordId:value.command.recordId}));
 else await store.db.run('DELETE FROM state WHERE slot=$1',active);
}
export async function readRecordOwnerFence(store,recordId){
 if(!researchId(recordId))throw new AppError('INVALID');const slot=recordOwnerFenceSlot(recordId),row=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot);if(!row)return null;
 const value=store.decode('state',slot,row.payload);
 if(!exact(value,['version','id','recordId','direction'])||value.version!==1||!researchId(value.id)||value.recordId!==recordId||!['outgoing','incoming'].includes(value.direction))throw new AppError('CATALOGUE_DAMAGED');
 const transfer=await readRecordOwnerTransfer(store,value.id);if(!transfer||transfer.command.recordId!==recordId)throw new AppError('CATALOGUE_DAMAGED');return {...value,transfer};
}
export async function setRecordOwnerFence(store,transfer,direction){
 if(!validRecordOwnerTransfer(transfer)||!['outgoing','incoming'].includes(direction))throw new AppError('INVALID');const recordId=transfer.command.recordId,previous=await readRecordOwnerFence(store,recordId);
 if(previous&&previous.id!==transfer.id&&(!['cancelled','complete'].includes(previous.transfer.phase)||recordOwnerReclamationPending(previous.transfer)))throw new AppError('CONFLICT');
 const slot=recordOwnerFenceSlot(recordId),value={version:1,id:transfer.id,recordId,direction};
 await store.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload',slot,store.encode('state',slot,value));
}
export async function assertRecordOwnerWritable(store,recordId){
 const fence=await readRecordOwnerFence(store,recordId);if(!fence)return;
 const allowed=permitted.getStore();if(allowed?.workspace===store.workspace&&allowed.id===fence.id&&allowed.recordId===recordId)return;
 if(fence.transfer.phase==='cancelled'||fence.direction==='incoming'&&fence.transfer.phase==='complete')return;
 throw new AppError(fence.direction==='outgoing'&&['retiring','complete'].includes(fence.transfer.phase)?'RECORD_RELOCATED':'RECORD_TRANSFER_BUSY',[{recordId,id:fence.id,target:fence.transfer.targetOwner}]);
}
export function withRecordOwnerTransferWrite(store,transfer,operation){
 if(!validRecordOwnerTransfer(transfer))throw new AppError('INVALID');
 return permitted.run({workspace:store.workspace,id:transfer.id,recordId:transfer.command.recordId},operation);
}
export function recordOwnerTransferStatus(value){
 if(!value)return null;
 return {id:value.id,workspaceId:value.command.workspaceId,recordId:value.command.recordId,sourceNotebookId:value.command.sourceNotebookId,expectedStorageRevision:value.command.expectedStorageRevision,sourceOwner:structuredClone(value.sourceOwner),targetOwner:structuredClone(value.targetOwner),targetNotebookId:value.command.targetNotebookId,phase:value.phase,progress:structuredClone(value.progress),canResume:!['complete','cancelled'].includes(value.phase)||recordOwnerReclamationPending(value),canCancel:['copying','verified'].includes(value.phase),result:structuredClone(value.result)};
}

export function assertRecordOwnerTransferAuthority(store){
 const allowed=permitted.getStore();if(allowed?.workspace!==store.workspace)throw new AppError('RECORD_TRANSFER_BUSY');return allowed;
}
// A returned identity may reuse only the former owner's completed outgoing
// authority. The engine additionally proves that exact original at its source.
export async function readRecordOwnerPreviousTransfer(store,receipt){
 const id=receipt.progress.previousOwnerTransfer;if(id===undefined||id===null)return null;
 const previous=await readRecordOwnerTransfer(store,id);
 if(!previous||previous.id===receipt.id||previous.phase!=='complete'||previous.command.recordId!==receipt.command.recordId||serialize(previous.sourceOwner)!==serialize(receipt.targetOwner)||(await store.snapshot()).metadata.id!==receipt.targetOwner.workspaceId)throw new AppError('CATALOGUE_DAMAGED');
 return previous;
}

// Copy admission reads one indexed pending marker, before allocating a target.
// The marker and cancelled receipt commit together; ordinary editing is separate.
export async function assertRecordOwnerReclamationSettled(store){
 const row=await store.db.get('SELECT slot,payload FROM state WHERE slot COLLATE "C">=$1 AND slot COLLATE "C"<$2 ORDER BY slot COLLATE "C" LIMIT 1','record-owner-transfer-cleanup:','record-owner-transfer-cleanup:~');if(!row)return assertRecordOwnerTransferSettled(store);
 const value=store.decode('state',row.slot,row.payload);
 if(!exact(value,['version','id','recordId'])||value.version!==1||!researchId(value.id)||!researchId(value.recordId)||row.slot!==cleanupSlot(value.id))throw new AppError('CATALOGUE_DAMAGED');
 const receipt=await readRecordOwnerTransfer(store,value.id);if(!recordOwnerReclamationPending(receipt)||receipt.command.recordId!==value.recordId)throw new AppError('CATALOGUE_DAMAGED');
 throw new AppError('RECORD_TRANSFER_CLEANUP_PENDING',[{id:value.id,recordId:value.recordId}]);
}

async function assertRecordOwnerTransferSettled(store){
 const prefix='record-owner-transfer-active:',row=await store.db.get('SELECT slot,payload FROM state WHERE slot COLLATE "C">=$1 AND slot COLLATE "C"<$2 ORDER BY slot COLLATE "C" LIMIT 1',prefix,prefix+'~');
 if(row){
  const value=store.decode('state',row.slot,row.payload);
  if(!exact(value,['version','id','recordId'])||value.version!==1||!researchId(value.id)||!researchId(value.recordId)||row.slot!==activeSlot(value.id))throw new AppError('CATALOGUE_DAMAGED');
  const receipt=await readRecordOwnerTransfer(store,value.id);if(!receipt||!activeTransfer(receipt)||receipt.command.recordId!==value.recordId)throw new AppError('CATALOGUE_DAMAGED');
  throw new AppError('RECORD_TRANSFER_COPY_PENDING',[{id:value.id,recordId:value.recordId}]);
 }
 const {recordOwnerResourcesPending}=await import('./record-owner-resources.js');if(await recordOwnerResourcesPending(store))throw new AppError('RECORD_TRANSFER_COPY_PENDING');
}

// Portable identity-specific provenance grants only the transferred identity.
// A former namespace is never blanket authority over unrelated source data.
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {validRecordOwner,readRecordOwnerTransfer} from './record-owner-transfer-state.js';
import {validMaterialReference} from './web/material-reference.js';
import {requireRecordOwnerTransfers} from './catalogue-format.js';
import {LabBookDirectory} from './lab-book-directory.js';
const kinds=['record','artifact','dataset','analysis','collection'];
const originPrefix=(kind,id)=>'record:reference-origin:'+kind+':'+id+':';
const redirectKey=ref=>'record-owner-reference:'+ref.workspaceId+':'+ref.kind+':'+ref.id;
const exact=(value,keys)=>value&&Object.keys(value).sort().join()===keys.slice().sort().join();
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export function validRecordOrigin(value){return exact(value,['version','kind','id','namespaceId','sourceNamespace','transferId','sourceOwner'])&&value.version===1&&kinds.includes(value.kind)&&['id','namespaceId','sourceNamespace','transferId'].every(key=>researchId(value[key]))&&value.namespaceId!==value.sourceNamespace&&validRecordOwner(value.sourceOwner)&&value.sourceOwner.workspaceId===value.sourceNamespace;}
export async function recordOrigin(store,ref){
 if(!kinds.includes(ref.kind)||!researchId(ref.id)||!researchId(ref.workspaceId))return null;
 const value=await store.object(originPrefix(ref.kind,ref.id)+ref.workspaceId);if(!value)return null;
 if(!validRecordOrigin(value)||value.id!==ref.id||value.kind!==ref.kind||value.sourceNamespace!==ref.workspaceId||value.namespaceId!==(await store.snapshot()).metadata.id)damaged();return value;
}
export async function* recordOrigins(store,kind,id){
 if(!kinds.includes(kind)||!researchId(id))throw new AppError('INVALID');
 for await(const key of store.objectIdEntries(originPrefix(kind,id))){const value=await store.object(key);if(!validRecordOrigin(value)||key!==originPrefix(kind,id)+value.sourceNamespace||value.namespaceId!==(await store.snapshot()).metadata.id)damaged();yield value;}
}
export async function retainRecordOrigin(store,{kind,id,sourceOwner,transferId}){
 const namespaceId=(await store.snapshot()).metadata.id;if(sourceOwner.workspaceId===namespaceId)return;
 const value={version:1,kind,id,namespaceId,sourceNamespace:sourceOwner.workspaceId,transferId,sourceOwner:structuredClone(sourceOwner)};if(!validRecordOrigin(value))throw new AppError('INVALID');
 const key=originPrefix(kind,id)+value.sourceNamespace,previous=await store.object(key);
 if(previous){if(!validRecordOrigin(previous)||previous.namespaceId!==namespaceId||previous.sourceNamespace!==value.sourceNamespace||previous.kind!==kind||previous.id!==id)damaged();return;}
 await store.putObject(key,value);
}
export async function registerRecordOwnerReference(registry,receipt,ref,sourceOwner=receipt.sourceOwner){
 if(!registry||!kinds.includes(ref.kind)||!researchId(ref.id)||!validRecordOwner(sourceOwner))throw new AppError('INVALID');
 const workspace=registry.workspace,key=redirectKey({...ref,workspaceId:sourceOwner.workspaceId}),value={version:1,id:ref.id,kind:ref.kind,sourceOwner,targetOwner:receipt.targetOwner,recordId:receipt.command.recordId,transferId:receipt.id};
 await workspace.withLock(()=>workspace.catalogue(async store=>{
  await requireRecordOwnerTransfers(store.db);const previous=await store.object(key);
  if(sourceOwner.workspaceId===receipt.targetOwner.workspaceId){if(previous){if(serialize(previous.targetOwner)!==serialize(receipt.sourceOwner))throw new AppError('CONFLICT');await store.deleteObject(key);}return;}
  if(previous&&serialize(previous)!==serialize(value)&&serialize(previous.targetOwner)!==serialize(receipt.sourceOwner))throw new AppError('CONFLICT');
  if(!previous||serialize(previous)!==serialize(value))await store.putObject(key,value);
 }));
}
export async function resolveRecordOwnerReference(registry,ref){
 if(!kinds.includes(ref.kind))return null;
 const value=await registry.workspace.catalogue(store=>store.object(redirectKey(ref)));if(!value)return null;
 if(!exact(value,['version','id','kind','sourceOwner','targetOwner','recordId','transferId'])||value.version!==1||value.id!==ref.id||value.kind!==ref.kind||!researchId(value.recordId)||!researchId(value.transferId)||!validRecordOwner(value.sourceOwner)||!validRecordOwner(value.targetOwner)||value.sourceOwner.workspaceId!==ref.workspaceId)damaged();
 const owner=value.targetOwner;
 if(owner.projectId===null){
  if(owner.workspaceId!==registry.workspaceId)throw new AppError('DATABASE_LOCATION');
  return {projectId:null,labBookId:null,namespaceId:registry.workspaceId};
 }
 const entry=owner.labBookId?await new LabBookDirectory(registry).locate(owner.workspaceId):await registry.namespace(owner.workspaceId);
 if(!entry||entry.projectId!==owner.projectId||(entry.labBookId??null)!==owner.labBookId)throw new AppError('DATABASE_LOCATION');return entry;
}

const externalKey=ref=>'record-owner-external:'+digest(serialize({kind:ref.kind,id:ref.id,revision:ref.revision,workspaceId:ref.workspaceId??null}));
export async function retainRecordOwnerExternalReference(store,receipt,ref,{sourceOwner=receipt.sourceOwner}={}){
 if(!validMaterialReference(ref)||!validRecordOwner(sourceOwner)||sourceOwner.workspaceId===receipt.targetOwner.workspaceId||ref.workspaceId&&ref.workspaceId!==sourceOwner.workspaceId)throw new AppError('INVALID');
 const saved=await readRecordOwnerTransfer(store,receipt.id);if(!saved||saved.fingerprint!==receipt.fingerprint||(await store.snapshot()).metadata.id!==receipt.targetOwner.workspaceId)damaged();
 const reference={kind:ref.kind,id:ref.id,revision:ref.revision,...(ref.workspaceId?{workspaceId:ref.workspaceId}:{})};
 const value={version:1,reference,namespaceId:receipt.targetOwner.workspaceId,sourceOwner:structuredClone(sourceOwner),recordId:receipt.command.recordId,transferId:receipt.id},key=externalKey(reference),prior=await store.object(key);
 if(prior&&serialize(prior)!==serialize(value)){if(prior.namespaceId!==value.namespaceId||serialize(prior.reference)!==serialize(reference)||serialize(prior.sourceOwner)!==serialize(sourceOwner))damaged();return;}
 if(!prior)await store.putObject(key,value);
}
export async function recordOwnerExternalReference(workspace,ref){
 if(!validMaterialReference(ref)||await workspace.storageKind()!=='catalogue')return null;
 return workspace.catalogue(async store=>{
  let selectedKey=externalKey(ref),value=await store.object(selectedKey);if(!value&&ref.workspaceId){const unqualified={kind:ref.kind,id:ref.id,revision:ref.revision};const alias=await store.object(externalKey(unqualified));if(alias?.sourceOwner?.workspaceId===ref.workspaceId){value=alias;selectedKey=externalKey(unqualified);}}if(!value)return null;
  if(!exact(value,['version','reference','namespaceId','sourceOwner','recordId','transferId'])||value.version!==1||!validRecordOwner(value.sourceOwner)||!validMaterialReference(value.reference)||externalKey(value.reference)!==selectedKey||(value.reference.kind!==ref.kind||value.reference.id!==ref.id||value.reference.revision!==ref.revision||ref.workspaceId&&value.sourceOwner.workspaceId!==ref.workspaceId)||!validRecordOwner(value.sourceOwner)||value.reference.workspaceId&&value.reference.workspaceId!==value.sourceOwner.workspaceId||!researchId(value.recordId)||!researchId(value.transferId)||value.namespaceId!==(await store.snapshot()).metadata.id)damaged();
  const receipt=await readRecordOwnerTransfer(store,value.transferId);if(!receipt||receipt.command.recordId!==value.recordId||receipt.targetOwner.workspaceId!==value.namespaceId)damaged();
  // A later authenticated adoption of this identity supersedes the external
  // witness only for revisions that are actually retained in this catalogue.
  const origin=await recordOrigin(store,{...ref,workspaceId:value.sourceOwner.workspaceId});
  if(origin){
   if(ref.kind==='record'){const index=store.historyIndex(ref.id);if(await store.db.get('SELECT 1 FROM records WHERE id=$1 LIMIT 1',ref.id)){if(await index.lookup(await index.head(),'view',ref.revision,{optional:true}))return null;}}
   else if(await store.object('metadata:.observanda/materials/objects/'+ref.id+'/'+ref.revision+'.json'))return null;
  }
  return {...ref,workspaceId:value.sourceOwner.workspaceId};
 });
}
import {materialReturnState,materialCopyAvailability} from './material-visibility.js';
import {revisionText} from './web/revision-model.js';
import {validMaterialReference} from './web/material-reference.js';
// Exact completed receipt reads after a selected record changes owner. These
// aliases authenticate retained text; they never read the former database.
import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {readRecordOwnerTransfer,readRecordOwnerPreviousTransfer} from './record-owner-transfer-state.js';
import {MaterialSequence} from './material-sequence.js';
import {withScratch} from './scratch-work.js';
const prefix='record-owner-evidence-audit-path:';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.slice().sort().join();
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const uuid='[a-f0-9-]{36}',hash='[a-f0-9]{64}';
const paths=new RegExp('^\\.observanda/(?:materials/(?:imports/'+uuid+'/session\\.json|intakes/'+uuid+'/(?:batch\\.json|accepted/(?:0|[1-9][0-9]*)\\.json|(?:paths|fingerprints)/'+hash+'\\.json|(?:prepared|attached)/'+uuid+'\\.json)|associations/'+uuid+'\\.json|corrections/(?:events/'+uuid+'|receipts/'+hash+'|state/'+uuid+')\\.json)|intake/(?:proposals/'+uuid+'\\.json|finalization/'+uuid+'/batch\\.json)|jobs/'+uuid+'\\.json)$');
const draftPaths=new RegExp('^\\.observanda/materials/drafts/'+uuid+'/(?:draft\\.json|(?:members|accepted)/(?:inputs|outputs)/(?:'+hash+'|0|[1-9][0-9]*)\\.json)$');
const runPaths=new RegExp('^\\.observanda/run-readiness/(?:(?:records|completed)/'+uuid+'\\.json|receipts/'+uuid+'(?:\\.json|/(?:items/'+uuid+'\\.json|basis/'+hash+'/'+hash+'/(?:validation|publication|git)\\.json)))$');
export const validRecordOwnerAuditPath=relative=>typeof relative==='string'&&(paths.test(relative)||draftPaths.test(relative)||runPaths.test(relative));
export const recordOwnerAuditMutablePath=relative=>typeof relative==='string'&&(new RegExp('^\\.observanda/materials/corrections/state/'+uuid+'\\.json$').test(relative)||new RegExp('^\\.observanda/run-readiness/(?:completed/'+uuid+'\\.json|receipts/'+uuid+'(?:\\.json|/basis/'+hash+'/'+hash+'/(?:validation|publication|git)\\.json))$').test(relative));
export const recordOwnerAuditPathKey=relative=>prefix+digest(relative);
export const recordOwnerAuditPartKey=(id,relative)=>'record-owner-evidence-audit:'+id+':'+digest(relative);
async function selected(store,relative,{recordId,limit=16*1024*1024,staged=false}={}){
 const alias=await store.object(recordOwnerAuditPathKey(relative));if(!alias)return null;
 if(!exact(alias,['version','relative','recordId','transferId','sha256','bytes',...(alias.previousSha256===undefined?[]:['previousSha256']),...(alias.previousTransferId===undefined?[]:['previousTransferId'])])||alias.version!==1||alias.relative!==relative||!validRecordOwnerAuditPath(relative)||!researchId(alias.recordId)||!researchId(alias.transferId)||!revisionId(alias.sha256)||!Number.isSafeInteger(alias.bytes)||alias.bytes<0||alias.bytes>16*1024*1024||recordId!==undefined&&alias.recordId!==recordId)damaged();
 const receipt=await readRecordOwnerTransfer(store,alias.transferId),namespaceId=(await store.snapshot()).metadata.id;
 if(!receipt||receipt.targetOwner.workspaceId!==namespaceId||receipt.command.recordId!==alias.recordId)damaged();
 if(alias.previousSha256!==undefined||alias.previousTransferId!==undefined){
  if(!recordOwnerAuditMutablePath(relative)||alias.previousSha256!==undefined&&!revisionId(alias.previousSha256)||alias.previousTransferId!==undefined&&!researchId(alias.previousTransferId)||!await readRecordOwnerPreviousTransfer(store,receipt))damaged();
 }
 if(!staged&&receipt.phase!=='complete'){
  if(!alias.previousTransferId)return null;
  const prior=await readRecordOwnerTransfer(store,alias.previousTransferId),part=await store.object(recordOwnerAuditPartKey(alias.previousTransferId,relative));
  if(!prior||prior.phase!=='complete'||prior.command.recordId!==alias.recordId||prior.targetOwner.workspaceId!==namespaceId||!exact(part,['version','transferId','recordId','relative','text'])||part.version!==1||part.transferId!==prior.id||part.recordId!==alias.recordId||part.relative!==relative||typeof part.text!=='string')damaged();
  if(Buffer.byteLength(part.text)>limit)throw new AppError('LIMIT');return {text:part.text,recordId:alias.recordId,transferId:prior.id,sourceOwner:prior.sourceOwner,targetOwner:prior.targetOwner,previousSha256:alias.previousSha256};
 }
 const part=await store.object(recordOwnerAuditPartKey(alias.transferId,relative));
 if(!exact(part,['version','transferId','recordId','relative','text'])||part.version!==1||part.transferId!==alias.transferId||part.recordId!==alias.recordId||part.relative!==relative||typeof part.text!=='string'||Buffer.byteLength(part.text)!==alias.bytes||digest(part.text)!==alias.sha256)damaged();
 if(alias.bytes>limit)throw new AppError('LIMIT');
 return {text:part.text,recordId:alias.recordId,transferId:alias.transferId,sourceOwner:receipt.sourceOwner,targetOwner:receipt.targetOwner,previousSha256:alias.previousSha256};
}
export async function readRecordOwnerAuditMetadata(workspace,relative,options={}){
 if(!validRecordOwnerAuditPath(relative)||await workspace.storageKind()!=='catalogue')return null;
 return workspace.catalogue(store=>selected(store,relative,options));
}
export async function readRecordOwnerMetadata(workspace,relative,limit,options={}){
 const text=await workspace.readMetadata(relative,limit);if(text!==null&&!recordOwnerAuditMutablePath(relative))return text;
 const audit=await readRecordOwnerAuditMetadata(workspace,relative,{...options,limit});
 if(text!==null)return audit?.previousSha256===digest(text)?audit.text:text;return audit?.text??null;
}
// The transfer copier calls this only for retained metadata candidates. Record
// feed trees are safe direct copies; shared mutable headers use audit aliases.
export async function classifyRecordOwnerAuditMetadata(workspace,relative){
 const feed=/^\.observanda\/(?:materials\/(?:corrections\/records|intakes\/by-record|associations\/by-record|drafts\/by-record)|intake\/by-record)\/([a-f0-9-]{36})(?:-order\.json|(?:-order)?\/[^/]+\.json)$/.exec(relative);
 if(feed){if(!researchId(feed[1]))damaged();return {recordId:feed[1],direct:true};}
 if(!validRecordOwnerAuditPath(relative))return null;
 const json=async name=>{const text=await readRecordOwnerMetadata(workspace,name,16*1024*1024);if(text===null)damaged();try{return JSON.parse(text);}catch{damaged();}};
 let value=await json(relative),recordId,terminal=true;
 if(relative.startsWith('.observanda/run-readiness/')){const id=relative.split('/')[3].replace(/\.json$/,'');if(!researchId(id))damaged();return {recordId:id,direct:!recordOwnerAuditMutablePath(relative)};}
 if(relative.includes('/corrections/')){
  if(relative.includes('/receipts/'))value=await json('.observanda/materials/corrections/events/'+value.id+'.json');
  else if(relative.includes('/state/'))value=await json('.observanda/materials/corrections/events/'+value.lastEvent+'.json');
  recordId=value.command?.recordId;
 }else if(relative.includes('/imports/')){
  recordId=value.recordId;terminal=!!value.completed;
  if(!terminal&&value.batchId)terminal=(await json('.observanda/materials/intakes/'+value.batchId+'/batch.json')).state==='completed';
 }else if(relative.startsWith('.observanda/materials/intakes/')){
  const id=relative.split('/')[3];value=await json('.observanda/materials/intakes/'+id+'/batch.json');recordId=value.command?.recordId;terminal=value.state==='completed';
 }else if(relative.startsWith('.observanda/materials/drafts/')){const id=relative.split('/')[3];value=await json('.observanda/materials/drafts/'+id+'/draft.json');recordId=value.command?.recordId;terminal=['completed','cancelled'].includes(value.state);}
 else if(relative.startsWith('.observanda/materials/associations/')){recordId=value.recordId;terminal=['completed','cancelled'].includes(value.state);}
 else if(relative.startsWith('.observanda/intake/')){
  const id=relative.split('/')[3].replace(/\.json$/,'');value=await json('.observanda/intake/proposals/'+id+'.json');recordId=value.manifest?.recordId;terminal=value.state==='completed'&&!!value.receipt;
 }else {recordId=value.scope;terminal=['completed','failed','cancelled'].includes(value.state);}
 if(!researchId(recordId))damaged();return terminal?{recordId,direct:false}:null;
}
export async function verifyRecordOwnerEvidenceReceipts(store,{signal}={}){
 const workspace=store.workspace,namespaceId=(await store.snapshot()).metadata.id,sequences=new MaterialSequence(workspace);
 return withScratch(async ledger=>{
  for await(const key of store.objectIdEntries(prefix,{signal})){
   signal?.throwIfAborted();const alias=await store.object(key);if(!alias||key!==recordOwnerAuditPathKey(alias.relative))damaged();await selected(store,alias.relative,{staged:true});
  }
  // Previous cancelled/returned transfers may retain their own immutable parts
  // after a current alias selects a newer authenticated receipt.
  for await(const key of store.objectIdEntries('record-owner-evidence-audit:',{signal})){
   signal?.throwIfAborted();const part=await store.object(key);
   if(!exact(part,['version','transferId','recordId','relative','text'])||part.version!==1||!researchId(part.transferId)||!researchId(part.recordId)||!validRecordOwnerAuditPath(part.relative)||key!==recordOwnerAuditPartKey(part.transferId,part.relative)||typeof part.text!=='string'||Buffer.byteLength(part.text)>16*1024*1024)damaged();
   const receipt=await readRecordOwnerTransfer(store,part.transferId);if(!receipt||receipt.targetOwner.workspaceId!==namespaceId||receipt.command.recordId!==part.recordId)damaged();
   await ledger.put(part.transferId+':'+part.relative,{name:part.relative,sha256:digest(part.text),bytes:Buffer.byteLength(part.text)});
  }
  for await(const key of store.objectIdEntries('record-owner-evidence-identity:',{signal})){
   signal?.throwIfAborted();const value=await store.object(key);
   if(!exact(value,['version','kind','id','recordId','transferId'])||value.version!==1||!['artifact','dataset','analysis','collection'].includes(value.kind)||![value.id,value.recordId,value.transferId].every(researchId)||key!=='record-owner-evidence-identity:'+value.kind+':'+value.id)damaged();
   const receipt=await readRecordOwnerTransfer(store,value.transferId);if(!receipt||receipt.targetOwner.workspaceId!==namespaceId||receipt.command.recordId!==value.recordId)damaged();
   if(receipt.phase==='complete')await ledger.put('identity:'+value.transferId+':'+value.kind+':'+value.id,value);
  }
  for await(const key of store.objectIdEntries('record-owner-evidence-prior:',{signal})){
   signal?.throwIfAborted();const value=await store.object(key);
   if(!exact(value,['version','transferId','kind','id','revision','recordId','retained'])||value.version!==1||!validMaterialReference(value)||value.kind==='record'||!researchId(value.recordId)||!researchId(value.transferId)||typeof value.retained!=='boolean'||key!=='record-owner-evidence-prior:'+value.transferId+':'+value.kind+':'+value.id+':'+value.revision)damaged();
   const receipt=await readRecordOwnerTransfer(store,value.transferId);if(!receipt||receipt.targetOwner.workspaceId!==namespaceId||receipt.command.recordId!==value.recordId)damaged();
   if(value.retained){
    if(!await readRecordOwnerPreviousTransfer(store,receipt))damaged();const raw=await workspace.readMetadata('.observanda/materials/objects/'+value.id+'/'+value.revision+'.json',16*1024*1024);let doc;try{doc=JSON.parse(raw);}catch{damaged();}
    if(doc?.kind!==value.kind||doc.id!==value.id||doc.recordId!==value.recordId||digest(revisionText(doc))!==value.revision)damaged();
   }
   if(receipt.phase==='complete')await ledger.put('prior:'+value.transferId+':'+value.kind+':'+value.id+':'+value.revision,true);
  }
  for await(const key of store.objectIdEntries('record-owner-evidence-copy:',{signal})){
   signal?.throwIfAborted();const value=await store.object(key);if(!value||!validMaterialReference(value)||value.kind==='record'||key!=='record-owner-evidence-copy:'+value.kind+':'+value.id+':'+value.revision)damaged();await materialCopyAvailability(store,value,value.recordId);
  }
  for await(const key of store.objectIdEntries('material-return-head:',{signal})){
   signal?.throwIfAborted();const raw=await store.object(key),value=await materialReturnState(workspace,key.slice('material-return-head:'.length));
   if(!value||!exact(raw,['version','id','recordId','transferId','head','previousHead','previousItem','previousRetired','settled']))damaged();
   if(!value.settled){
    const read=async path=>{const text=await workspace.readMetadata(path,16*1024*1024);return text===null?null:JSON.parse(text);};
    if(revisionText(await read('.observanda/materials/objects/'+value.id+'/head.json'))!==revisionText(value.previousHead)||revisionText(await read('.observanda/materials/index/items/'+value.id+'.json'))!==revisionText(value.previousItem)||revisionText((await read('.observanda/materials/index/retired/'+value.id+'.json'))?.item??null)!==revisionText(value.previousRetired))damaged();
   }
   if(value.head&&value.receipt.phase==='complete')await ledger.put('return:'+value.transferId+':'+value.head.kind+':'+value.id+':'+value.head.revision,true);
  }
  for await(const key of store.objectIdEntries('material-return-inherited:',{signal})){
   signal?.throwIfAborted();const value=await store.object(key);
   if(!exact(value,['version','transferId','id','recordId','placement'])||value.version!==1||![value.transferId,value.id,value.recordId].every(researchId)||key!=='material-return-inherited:'+value.transferId+':'+value.id||value.placement?.id!==value.id||value.placement.recordId!==value.recordId||!['artifact','dataset','analysis','collection'].includes(value.placement.kind))damaged();
   const receipt=await readRecordOwnerTransfer(store,value.transferId);if(!receipt||receipt.targetOwner.workspaceId!==namespaceId||receipt.command.recordId!==value.recordId||!await readRecordOwnerPreviousTransfer(store,receipt))damaged();
   if(receipt.phase==='complete')await ledger.put('inherited:'+receipt.id+':'+value.placement.kind+':'+value.id,true);
  }
  for await(const {slot} of store.db.rows("SELECT slot FROM state WHERE slot LIKE 'record-owner-transfer:%' ORDER BY slot")){
   signal?.throwIfAborted();const receipt=await readRecordOwnerTransfer(store,slot.slice('record-owner-transfer:'.length));if(receipt.targetOwner.workspaceId!==namespaceId)continue;
   const evidence=receipt.progress.evidence??await store.object('record-owner-evidence-progress:'+receipt.id),audit=evidence?.audit;
   if(receipt.phase==='complete'&&evidence?.revisions){sequences.validate(evidence.revisions);if(evidence.revisions.kind!=='references')damaged();for await(const ref of sequences.items(evidence.revisions)){signal?.throwIfAborted();await ledger.remove('identity:'+receipt.id+':'+ref.kind+':'+ref.id);await ledger.remove('inherited:'+receipt.id+':'+ref.kind+':'+ref.id);await ledger.remove('prior:'+receipt.id+':'+ref.kind+':'+ref.id+':'+ref.revision);await ledger.remove('return:'+receipt.id+':'+ref.kind+':'+ref.id+':'+ref.revision);}}
   if(!audit)continue;
   sequences.validate(audit);if(audit.kind!=='files')damaged();
   for await(const entry of sequences.items(audit)){
    signal?.throwIfAborted();if(!exact(entry,['name','sha256','bytes'])||!validRecordOwnerAuditPath(entry.name))damaged();
    const key=receipt.id+':'+entry.name,part=await ledger.get(key);if(!part||part.sha256!==entry.sha256||part.bytes!==entry.bytes||!await ledger.remove(key))damaged();
   }
  }
  if(ledger.size)damaged();
 },{signal});
}

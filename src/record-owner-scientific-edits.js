// Scientific checkpoints move with the record. Acknowledgements stay bound
// to the exact projected envelope, including when the record moves back.
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {ResearchMaterials} from './research-materials.js';
import {ScientificEditDrafts,scientificEditFiles as files,validScientificEnvelope} from './scientific-edit-drafts.js';
import {journalRecordOwnerMutations,retainRecordOwnerResource} from './record-owner-resources.js';
import {readRecordOwnerTransfer} from './record-owner-transfer-state.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';

const hash=value=>digest(serialize(value));
const manifest=id=>'record-owner-scientific-edits:'+id;
const archives=id=>'record-owner-scientific-origin:'+id+':';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
async function exactObject(store,key,value){
 const earlier=await store.object(key),revision=hash(value);
 if(earlier&&hash(earlier)!==revision)damaged();
 const resource={kind:'object',key,revision};
 await retainRecordOwnerResource(store,resource,{present:!!earlier});
 if(!earlier)await store.putObject(key,value);
 return resource;
}
function projection(origin,targetId){
 return {...origin.original,workspaceId:targetId,recordRevision:origin.targetRecordRevision,parentRevision:null};
}
export async function prepareScientificEdits(source,target,receipt,{write,signal,checkpoint}){
 const {recordId}=receipt.command,sourceId=receipt.sourceOwner.workspaceId,targetId=receipt.targetOwner.workspaceId;
 const prior=await target.catalogue(store=>store.object(manifest(receipt.id)));
 if(prior)return prior;
 const drafts=new ScientificEditDrafts(new ResearchMaterials(source)),incoming=new ScientificEditDrafts(new ResearchMaterials(target));
 const previous=receipt.progress.previousOwnerTransfer,sourceRevision=(await drafts.materials.recordSummary(recordId)).revision;
 const targetRevision=receipt.progress.prepared.view.revision;
 let count=0;
 async function copy(found){
  signal?.throwIfAborted();
  const {draft,revision}=found,id=draft.id;
  const sourceReceipt=await drafts.receipt({workspaceId:sourceId,recordId,id,expectedRevision:revision});
  const targetRecordRevision=draft.recordRevision===sourceRevision?targetRevision:draft.recordRevision;
  const origin={version:1,transferId:receipt.id,recordId,original:draft,sourceRevision:revision,targetRecordRevision,sourceReceipt};
  const projected=projection(origin,targetId),raw=serialize(projected),projectedRevision=digest(raw);
  const command=sourceReceipt&&{...sourceReceipt,workspaceId:targetId,checkpoint:projectedRevision};
  const returned=previous?await source.catalogue(store=>store.object(archives(previous)+id)):null;
  await write(async store=>{
   const originKey=archives(receipt.id)+id,staged=await store.object(originKey);
   if(staged){if(hash(staged)!==hash(origin)||(await incoming.raw(id))?.revision!==projectedRevision)damaged();return;}
   const existing=await incoming.raw(id);
   if(existing&&(!returned||returned.original.workspaceId!==targetId||returned.sourceRevision!==existing.revision||existing.draft.recordId!==recordId))throw new AppError('RECORD_DRAFT_EXISTS');
   const indices=[incoming.index,incoming.ownerIndex];
   for(const index of indices)await index.ensureLocked(targetId,{signal});
   const metadata=new Map();
   if(existing&&!existing.draft.discarded)for(const index of indices)metadata.set(index.path(existing.draft),null);
   metadata.set(files.draft(id),raw);
   const result={draft:projected,revision:projectedRevision},sourceDigest=hash({text:raw});
   for(const index of indices){
    const summary=index.summary(result,sourceDigest);
    if(summary)metadata.set(index.path(summary),serialize(summary));
   }
   if(command)metadata.set(files.receipt(id,projectedRevision),serialize(command));
   const resource=await exactObject(store,originKey,origin);
   const changes=[];
   for(const [relative,text] of metadata){
    const key='metadata:'+relative;
    changes.push({address:{kind:'object',key},before:await store.object(key),after:text===null?null:{text}});
   }
   await journalRecordOwnerMutations(store,receipt,changes,{dependencies:[resource],chain:{kind:'object',key:'metadata:'+files.draft(id)}});
   for(const [relative,text] of metadata){if(text===null)await target.removeMetadata(relative);else await target.writeMetadata(relative,text);}
  });
  count++;await checkpoint('scientific-edit',{count});
 }
 for await(const found of drafts.forTransfer(sourceId,recordId,{signal}))await copy(found);
 // A returned record must also retire copies discarded while it was away.
 if(previous)await source.catalogue(async store=>{
  const prefix=archives(previous);
  for await(const key of store.objectIdEntries(prefix,{signal})){
   const id=key.slice(prefix.length),found=await drafts.raw(id);
   if(!found||found.draft.recordId!==recordId)damaged();
   if(found.draft.discarded)await copy(found);
  }
 });
 const descriptor={version:1,id:receipt.id,recordId,sourceRecordRevision:sourceRevision,count};
 await write(store=>exactObject(store,manifest(receipt.id),descriptor));
 await target.catalogue(store=>verifyScientificTransfer(store,receipt,descriptor,{signal,current:true}));
 return descriptor;
}
export async function verifyScientificTransfer(store,receipt,descriptor,{signal,current=false}={}){
 if(descriptor?.version!==1||descriptor.id!==receipt.id||descriptor.recordId!==receipt.command.recordId||
    !revisionId(descriptor.sourceRecordRevision)||!Number.isSafeInteger(descriptor.count)||descriptor.count<0||hash(await store.object(manifest(receipt.id)))!==hash(descriptor))damaged();
 const targetId=receipt.targetOwner.workspaceId,prefix=archives(receipt.id),drafts=new ScientificEditDrafts(new ResearchMaterials(store.workspace));
 let count=0;
 for await(const key of store.objectIdEntries(prefix,{signal})){
  signal?.throwIfAborted();const origin=await store.object(key),id=key.slice(prefix.length);
  if(!researchId(id)||origin?.version!==1||origin.transferId!==receipt.id||origin.recordId!==descriptor.recordId||
     origin.original?.recordId!==origin.recordId||origin.original.id!==id||origin.original.workspaceId!==receipt.sourceOwner.workspaceId||
     !validScientificEnvelope(origin.original,id)||hash(origin.original)!==origin.sourceRevision||
     origin.targetRecordRevision!==(origin.original.recordRevision===descriptor.sourceRecordRevision?receipt.progress.prepared.view.revision:origin.original.recordRevision))damaged();
  const projected=projection(origin,targetId),revision=hash(projected),command=origin.sourceReceipt;
  if(command&&(command.id!==id||command.checkpoint!==origin.sourceRevision||command.workspaceId!==receipt.sourceOwner.workspaceId||command.recordId!==origin.recordId))damaged();
  if(current){
   const selected=await drafts.original({id,workspaceId:targetId,recordId:origin.recordId});
   if(!selected||selected.revision!==revision)damaged();
  }
  if(command){
   const mapped=await drafts.receipt({id,workspaceId:targetId,recordId:origin.recordId,expectedRevision:revision});
   if(hash(mapped)!==hash({...command,workspaceId:targetId,checkpoint:revision}))damaged();
  }
  count++;
 }
 if(count!==descriptor.count)damaged();
}
export async function activateScientificTransfer(store,receipt){
 const descriptor=receipt.progress.scientific;
 if(!descriptor)return; // Earlier transfers predate scientific checkpoints.
 if((await readRecordOwnerTransfer(store,receipt.id))?.fingerprint!==receipt.fingerprint||
    hash(await store.object(manifest(receipt.id)))!==hash(descriptor))damaged();
}

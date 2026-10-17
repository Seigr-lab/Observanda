// Durable, unpublished artifact checkpoints. Only the final batch publication
// exposes these heads; ordinary discovery expands its registered segment.
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {validMaterialReference} from './web/material-reference.js';
import {requireStagedEvidence} from './catalogue-format.js';
import {withWorkspaceMetadataBatch} from './metadata-batch.js';
const hash=value=>digest(serialize(value));
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const empty=()=>({format:1,kind:'references',root:null,count:0,chunkSize:64});
export class EvidenceIntakeFinalization{
 constructor(intake){this.intake=intake;this.materials=intake.materials;this.workspace=intake.workspace;}
 validate(batch){
  const value=batch.finalization;if(value===undefined)return null;
  if(!value||Object.keys(value).sort().join()!=='count,inputsIndex,segmentId,version'||value.version!==1||!researchId(value.segmentId)||!Number.isSafeInteger(value.count)||value.count<0||value.count>batch.files.count)damaged();
  this.materials.sequences.validate(value.inputsIndex);if(value.inputsIndex.kind!=='references'||value.inputsIndex.count!==value.count)damaged();return value;
 }
 async receipt(batch,session){
  const receipt=await this.intake.json(this.intake.file(batch.id,'attached/'+session.id+'.json'));
  if(!receipt||Object.keys(receipt).sort().join()!=='ref,sessionHash,version'||receipt.version!==1||!validMaterialReference(receipt.ref)||receipt.ref.kind!=='artifact'||receipt.ref.id!==session.id||receipt.sessionHash!==digest(JSON.stringify({...session,completed:null})))damaged();
  return receipt;
 }
 async stage(job,{signal,progress=async()=>{}}={},write){
  let batch=await this.intake.authorize(job),state=this.validate(batch);
  while((state?.count??0)<batch.files.count){
   signal?.throwIfAborted();
   await write(()=>withWorkspaceMetadataBatch(this.workspace,async()=>{
    batch=await this.intake.authorize(job);if(batch.state==='completed'){state=this.validate(batch);return;}
    await this.workspace.catalogue(store=>requireStagedEvidence(store.db));
    state=this.validate(batch)??{version:1,count:0,inputsIndex:empty(),segmentId:randomUUID()};
    const page=await this.materials.sequences.page(batch.files,{offset:state.count,limit:32}),refs=[];
    for(const file of page.items){
     signal?.throwIfAborted();const session=await this.materials.importState(file.id,{raw:true}),prepared=await this.intake.json(this.intake.file(batch.id,'prepared/'+file.id+'.json'));
     if(!prepared||prepared.sessionHash!==digest(JSON.stringify(session)))throw new AppError('MATERIAL_CHANGED');
     const ref=await this.materials.stageImport(file.id,prepared,batch.id);refs.push(ref);
     await this.intake.put(this.intake.file(batch.id,'attached/'+file.id+'.json'),{version:1,ref,sessionHash:prepared.sessionHash});
     const reuse='.observanda/materials/intakes/reuse/'+job.scope+'/'+file.fingerprint+'.json';
     if(!await this.intake.json(reuse))await this.intake.put(reuse,{...ref,stagedBatch:batch.id});
    }
    state={...state,count:state.count+refs.length,inputsIndex:await this.materials.sequences.append(state.inputsIndex,refs)};
    batch.finalization=state;await this.intake.put(this.intake.file(batch.id),batch);
   }));
   await progress({stage:'Attaching verified files',done:state.count,total:batch.files.count,unit:'files'});
  }
  return {manifest:hash(batch.files),finalization:hash(state)};
 }
 async publish(job,prepared){
  const batch=await this.intake.authorize(job);if(batch.state==='completed')return batch.result;
  const state=this.validate(batch);
  if(prepared.manifest!==hash(batch.files)||!state||state.count!==batch.files.count||prepared.finalization!==hash(state))throw new AppError('MATERIAL_CHANGED');
  await this.materials.assertOwner(job.scope,{write:true});
  await this.materials.index.publishBatch({id:batch.id,segmentId:state.segmentId,recordId:job.scope,createdAt:new Date().toISOString(),inputsIndex:state.inputsIndex});
  batch.result=await this.materials.commit({kind:'collection',id:batch.id,recordId:job.scope,title:batch.command.title,
   content:{inputsIndex:state.inputsIndex,acquisition:batch.acquisition,intake:{id:batch.id,files:batch.files,bytes:batch.bytes,provenance:batch.command.provenance,...(batch.command.purpose?{purpose:batch.command.purpose}:{})}}});
  batch.state='completed';await this.intake.put(this.intake.file(batch.id),batch);
  const feed=this.intake.feed(job.scope);await this.workspace.removeMetadata(feed.order+'/'+feed.key(batch));
  return batch.result;
 }
 // Called after the queue transaction and its observers have completed. The
 // metadata already owns the originals; retrying physical cleanup is harmless.
 async cleanup(id){
  await this.materials.readSnapshot(async()=>{
   const batch=await this.intake.authorized(id);if(batch.state!=='completed')return;
   for await(const file of this.materials.sequences.items(batch.files))await this.materials.cleanImport(await this.materials.importState(file.id));
  }).catch(()=>{});
 }
 async verifyFile(batch,file,position,session,prepared){
  const state=this.validate(batch),raw=await this.intake.json(this.intake.file(batch.id,'attached/'+file.id+'.json'));
  if(position>=(state?.count??0)){if(raw!==null)damaged();return;}
  const receipt=await this.receipt(batch,session),expected=await this.materials.sequences.item(state.inputsIndex,position);
  if(hash(expected)!==hash(receipt.ref)||!prepared)damaged();
  const doc=await this.materials.readStored(receipt.ref),command=await this.materials.importCommand({...session,completed:null},prepared);
  if(doc.kind!==command.kind||doc.id!==command.id||doc.recordId!==command.recordId||doc.title!==command.title||doc.previous!==null||hash(doc.content)!==hash(command.content))damaged();
  if(hash(await this.materials.index.inputSetStored(receipt.ref))!==hash(this.materials.referenceSet(doc.content)))damaged();
  const head=await this.materials.current(file.id,{includeStaged:true});
  if(batch.state!=='completed'&&(!head||head.stagedBatch!==batch.id||head.revision!==receipt.ref.revision))damaged();
 }
}

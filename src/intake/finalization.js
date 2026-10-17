// Reusable local intake uses the same unpublished heads and atomic segment
// publication as file-set intake. Checkpoints own originals across interruption;
// only a completed batch receipt makes those heads visible.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AppError} from '../errors.js';
import {digest,serialize} from '../storage-format.js';
import {revisionText,revisionId} from '../web/revision-model.js';
import {researchId} from '../web/research-reference.js';
import {materialBatch} from '../material-visibility.js';
import {requireStagedEvidence} from '../catalogue-format.js';
import {evidenceDigest} from '../run-receipts.js';
import {RunReadiness} from '../run-readiness.js';
import {LocalIntake} from './service.js';
import {assertPreparedIntakeUnchanged,preparedIntakeIdentity} from './prepared.js';
const hash=value=>digest(serialize(value)),proofs=new WeakMap();
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const changed=()=>{throw new AppError('INTAKE_CHANGED');};
const empty=()=>({format:1,kind:'references',root:null,count:0,chunkSize:64});
const root='.observanda/intake/finalization/';
function artifactCommand(proposal,batch,file,prepared){
 if(!prepared||prepared.id!==file.id||prepared.sha256!==file.sha256||prepared.size!==file.size)damaged();
 return {kind:'artifact',id:file.id,recordId:batch.command.recordId,title:path.posix.basename(file.path),content:{name:path.posix.basename(file.path),size:file.size,sha256:file.sha256,storageId:prepared.storageId,provenance:file.provenance,acquisition:batch.acquisition,inputs:[]}};
}
export class LocalIntakeFinalization{
 constructor(service){this.service=service;this.workspace=service.workspace;this.materials=service.materials;}
 file(id){if(!researchId(id))damaged();return root+id+'/batch.json';}
 async read(proposal,{optional=false}={}){
  if(await this.workspace.readMetadata(this.file(proposal.id),131072)===null){if(optional)return null;damaged();}
  const batch=await materialBatch(this.workspace,proposal.id);
  if(batch.owner!=='local-intake'||batch.pin!==proposal.pin||batch.preparedIdentity!==preparedIntakeIdentity(proposal)||batch.command.recordId!==proposal.manifest.recordId||batch.command.count!==proposal.manifest.files.length||batch.acquisition.revision!==proposal.manifest.expectedRevision)damaged();
  if(batch.state==='completed'){const proof=batch.completionProof;if(!proof||proof.pin!==batch.pin||proof.preparedIdentity!==batch.preparedIdentity||proof.finalization!==hash(batch.finalization)||!['sourceStamp','evidenceRevision','execution'].every(key=>revisionId(proof[key]))||!Number.isSafeInteger(proof.generation)||proof.generation<0)damaged();}
  return batch;
 }
 async save(batch){await this.workspace.writeMetadata(this.file(batch.id),JSON.stringify(batch));}
 async stage(job,report,{signal,progress=async()=>{}}={}){
  const service=this.service,queue=service.queue,write=fn=>queue.transaction(async()=>{await queue.held(job.id,job.lease.token);signal?.throwIfAborted();return fn();});
  let proposal=await service.read(job.input.id),batch=await this.read(proposal,{optional:true});
  if(!batch)await write(async()=>{
   proposal=await service.read(job.input.id);batch=await this.read(proposal,{optional:true});if(batch)return;
   await service.bind(proposal.manifest);await this.materials.assertOwner(proposal.manifest.recordId,{write:true});
   if(await this.workspace.readMetadata('.observanda/materials/intakes/'+proposal.id+'/batch.json',131072)!==null)throw new AppError('MATERIAL_CHANGED');
   await this.workspace.catalogue(store=>requireStagedEvidence(store.db));await this.materials.index.ensureLocked();
   batch={format:1,owner:'local-intake',id:proposal.id,pin:proposal.pin,preparedIdentity:preparedIntakeIdentity(proposal),sourceStamp:hash(report.files),command:{recordId:proposal.manifest.recordId,count:proposal.manifest.files.length},state:'processing',createdAt:new Date().toISOString(),acquisition:await this.materials.retainCurrentRecordLocked(proposal.manifest.recordId),finalization:{version:1,count:0,inputsIndex:empty(),segmentId:randomUUID()}};
   await this.save(batch);
  });
  const retained=new Map(proposal.prepared.map(item=>[item.id,item]));
  while(batch.finalization.count<proposal.manifest.files.length){
   signal?.throwIfAborted();
   await write(async()=>{
    proposal=await service.read(job.input.id);batch=await this.read(proposal);if(batch.state!=='processing')changed();
    await service.bind(proposal.manifest);const start=batch.finalization.count;
    await assertPreparedIntakeUnchanged(this.workspace,proposal,report,{offset:start,limit:32,signal});
    const refs=[];for(const file of proposal.manifest.files.slice(start,start+32)){
     signal?.throwIfAborted();refs.push(await this.materials.commit(artifactCommand(proposal,batch,file,retained.get(file.id)),{stagedBatch:batch.id}));
    }
    batch.finalization={...batch.finalization,count:start+refs.length,inputsIndex:await this.materials.sequences.append(batch.finalization.inputsIndex,refs)};await this.save(batch);
   });
   await progress({stage:'Preparing retained files',done:batch.finalization.count,total:proposal.manifest.files.length,unit:'files'});
  }
  return report;
 }
 async beforeComplete(job,report,{signal}={}){
  const service=this.service,proposal=await service.read(job.input.id),batch=await this.read(proposal);
  if(batch.state!=='processing'||batch.finalization.count!==proposal.manifest.files.length)changed();
  await service.validateTargets(proposal.manifest);await assertPreparedIntakeUnchanged(this.workspace,proposal,report,{signal});
  const files=[];for await(const ref of this.materials.sequences.items(batch.finalization.inputsIndex)){signal?.throwIfAborted();files.push(ref);}
  const fileRefs=new Map(files.map(ref=>[ref.id,ref])),analyses=[];
  const checkReference=async ref=>{
   const local=fileRefs.get(ref.id);
   if(local&&ref.kind===local.kind&&ref.revision===local.revision){const head=await this.materials.current(ref.id,{includeStaged:true});if(!head||head.revision!==ref.revision||head.stagedBatch!==batch.id)changed();await this.materials.readStored(ref);}
   else await this.materials.checkReference(ref,{signal});
  };
  const write=fn=>service.queue.transaction(async()=>{await service.queue.held(job.id,job.lease.token);signal?.throwIfAborted();return fn();});
  for(const source of proposal.manifest.analyses){
   signal?.throwIfAborted();const resolve=ref=>ref.file?fileRefs.get(ref.file):ref;
   const command=await this.materials.prepareAnalysis({...source,recordId:batch.command.recordId,inputs:source.inputs.map(resolve),outputs:source.outputs.map(resolve)},{checkReference,write});
   const createdAt=new Date().toISOString(),doc={format:1,kind:'analysis',id:command.id,recordId:command.recordId,title:command.title,createdAt,previous:command.expectedRevision??null,content:command.content};
   analyses.push({command,createdAt,ref:{kind:'analysis',id:command.id,revision:digest(revisionText(doc))}});
  }
  const prepared=await this.workspace.catalogue(async()=>{
   signal?.throwIfAborted();await service.bind(proposal.manifest);const generation=(await this.materials.index.state()).generation;
   const segment={version:1,id:batch.finalization.segmentId,batchId:batch.id,recordId:batch.command.recordId,createdAt:batch.createdAt,inputsIndex:batch.finalization.inputsIndex},hashing=evidenceDigest();
   for await(const item of this.materials.index.projectedHeads({recordId:batch.command.recordId,segment,heads:analyses.map(item=>({...item.ref,recordId:item.command.recordId,createdAt:item.createdAt,title:item.command.title})),signal}))hashing.add(item);
   return {generation,evidenceRevision:hashing.finish(),execution:hash(await service.executionManifest(proposal.manifest))};
  });
  // Stat every owned retained file after dependency/digest preparation, outside
  // the writer. External filesystem editors are not locked by metadata commits;
  // this proof records the exact checked boundary, not a filesystem lock claim.
  await assertPreparedIntakeUnchanged(this.workspace,proposal,report,{signal});signal?.throwIfAborted();
  const proof=Object.freeze({pin:proposal.pin,preparedIdentity:report.identity,sourceStamp:hash(report.files),finalization:hash(batch.finalization),...prepared});
  proofs.set(proof,{root:this.workspace.root,id:proposal.id,job:job.id,token:job.lease.token,files,analyses});return proof;
 }
 async commit(job,proof){
  const owned=proofs.get(proof);
  if(!owned||owned.root!==this.workspace.root||owned.id!==job.input.id||owned.job!==job.id||owned.token!==job.lease.token)changed();
  const service=this.service,proposal=await service.read(owned.id),batch=await this.read(proposal);
  if(proof.pin!==proposal.pin||proof.preparedIdentity!==preparedIntakeIdentity(proposal)||proof.finalization!==hash(batch.finalization)||batch.state!=='processing'||batch.finalization.count!==proposal.manifest.files.length)changed();
  if((await this.materials.index.state()).generation!==proof.generation)throw new AppError('MATERIAL_CHANGED');
  const manifest=await service.executionManifest(proposal.manifest);if(hash(manifest)!==proof.execution)changed();
  await service.bind(proposal.manifest);await this.materials.assertOwner(manifest.recordId,{write:true});
  const analyses=[];for(const item of owned.analyses){const ref=await this.materials.commit(item.command,{createdAt:item.createdAt});if(hash(ref)!==hash(item.ref))damaged();analyses.push(ref);}
  await this.materials.index.publishBatch({id:batch.id,segmentId:batch.finalization.segmentId,recordId:manifest.recordId,createdAt:batch.createdAt,inputsIndex:batch.finalization.inputsIndex});
  batch.state='completed';batch.result={pin:proposal.pin,recordRevision:manifest.expectedRevision};batch.completionProof=proof;await this.save(batch);
  if(manifest.record)await service.records().saveLocked({workspaceId:manifest.workspaceId,changes:[{id:manifest.recordId,expectedRevision:manifest.expectedRevision,record:manifest.record}]},{receipt:true});
  const {revision}=await service.bind(proposal.manifest,{checkRevision:false}),receipt={version:1,id:proposal.id,pin:proposal.pin,workspaceId:manifest.workspaceId,recordId:manifest.recordId,priorRevision:manifest.expectedRevision,recordRevision:revision,source:manifest.source,verification:manifest.verification,files:owned.files,analyses,committedAt:new Date().toISOString()};
  batch.state='completed';batch.result={pin:proposal.pin,recordRevision:revision};batch.completionProof=proof;await this.save(batch);
  await new RunReadiness(this.workspace).appendLocked(manifest.recordId,{id:proposal.id,kind:'validation',recordRevision:revision,evidenceRevision:proof.evidenceRevision,source:manifest.source,verification:manifest.verification,intakeId:proposal.id,pin:proposal.pin,recordedAt:receipt.committedAt,declared:true});
  proposal.receipt=receipt;proposal.state='completed';await service.write(proposal);await this.workspace.afterCommit(()=>proofs.delete(proof));return receipt;
 }
}
export async function verifyLocalIntakeFinalizations(workspace,check){
 const service=new LocalIntake(workspace),owner=new LocalIntakeFinalization(service),materials=service.materials;
 for await(const id of workspace.metadataNames(root.slice(0,-1))){
  if(!researchId(id))damaged();const proposal=await service.read(id),batch=await owner.read(proposal),retained=new Map(proposal.prepared.map(item=>[item.id,item]));
  if((batch.state==='completed')!==(proposal.state==='completed')||batch.state==='completed'&&(proposal.receipt?.pin!==batch.pin||proposal.receipt.recordRevision!==batch.result.recordRevision||proposal.receipt.files.length!==batch.finalization.count))damaged();
  await check(batch.acquisition);let position=0;
  for await(const ref of materials.sequences.items(batch.finalization.inputsIndex)){
   const file=proposal.manifest.files[position],command=artifactCommand(proposal,batch,file,retained.get(file.id)),doc=await materials.readStored(ref);
   if(ref.kind!=='artifact'||ref.id!==file.id||doc.previous!==null||doc.recordId!==command.recordId||doc.title!==command.title||hash(doc.content)!==hash(command.content)||hash(await materials.index.inputSetStored(ref))!==hash(materials.referenceSet(doc.content)))damaged();
   if(batch.state==='completed'){if(hash(proposal.receipt.files[position])!==hash(ref))damaged();await check(ref);}
   else{const head=await materials.current(ref.id,{includeStaged:true});if(!head||head.stagedBatch!==id||head.revision!==ref.revision)damaged();await (await service.preparedContent(proposal,retained.get(file.id))).verify();}
   position++;
  }
  if(position!==batch.finalization.count)damaged();
  if(batch.state!=='completed')for(const file of proposal.manifest.files.slice(position))await (await service.preparedContent(proposal,retained.get(file.id))).verify();
  if(batch.state==='completed')for(const ref of proposal.receipt.analyses)await check(ref);
 }
}

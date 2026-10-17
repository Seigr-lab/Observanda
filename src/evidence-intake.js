import {readRecordOwnerMetadata} from './record-owner-audit-metadata.js';
import {withScratch} from './scratch-work.js';
import {EvidenceFileChoices} from './evidence-file-choices.js';
import {EvidenceIntakeFinalization} from './evidence-intake-finalization.js';
import {materialBatch} from './material-visibility.js';
import {withWorkspaceMetadataBatch} from './metadata-batch.js';
// File sets stage private originals through the existing chunk importer. A
// fenced job checkpoints hidden artifacts and publishes their sequence atomically.
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {MetadataFeed} from './metadata-feed.js';
import {researchId} from './web/research-reference.js';
import {validFingerprint,fileFingerprint} from './web/evidence-fingerprint.js';
import {validEvidenceFile,evidenceFileMetadata,evidencePurposes} from './web/evidence-files.js';
const root='.observanda/materials/intakes';
const fail=code=>{throw new AppError(code??'MATERIAL_INVALID');};
const hash=value=>digest(serialize(value));
const text=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f]/u.test(value);
const empty=kind=>({format:1,kind,root:null,count:0,chunkSize:64});
export class EvidenceIntake{
 constructor(materials){this.materials=materials;this.workspace=materials.workspace;this.choices=new EvidenceFileChoices(this.workspace);this.finalization=new EvidenceIntakeFinalization(this);}
 file(id,suffix='batch.json'){if(!researchId(id))fail();return root+'/'+id+'/'+suffix;}
 feed(recordId){if(!researchId(recordId))fail();return new MetadataFeed(this.workspace,root+'/by-record/'+recordId);}
 async json(file){const raw=await readRecordOwnerMetadata(this.workspace,file,131072);if(raw===null)return null;try{return JSON.parse(raw);}catch{fail('CATALOGUE_DAMAGED');}}
 async put(file,value){await this.workspace.writeMetadata(file,serialize(value));}
 validate(command){
  if(!researchId(command.recordId)||!text(command.title,300)||!command.title.trim()||typeof command.provenance!=='string'||command.provenance.length>10000||
   !Number.isSafeInteger(command.count)||command.count<1||!Number.isSafeInteger(command.bytes)||command.bytes<0||command.purpose!==undefined&&!evidencePurposes.includes(command.purpose)||command.sourceMode!==undefined&&!['files','folder'].includes(command.sourceMode))fail();
 }
 async read(id){
  const batch=await this.json(this.file(id));if(!batch)fail('NOT_FOUND');
  if(batch.format!==1||batch.id!==id||hash(batch.command)!==batch.intent||!['open','processing','completed'].includes(batch.state))fail('CATALOGUE_DAMAGED');
  try{this.validate(batch.command);}catch{fail('CATALOGUE_DAMAGED');}
  this.materials.sequences.validate(batch.files);
  if(!Number.isSafeInteger(batch.ready)||batch.ready<0||batch.ready>batch.files.count||batch.files.kind!=='files'||batch.files.count>batch.command.count||!Number.isSafeInteger(batch.bytes)||batch.bytes<0||batch.bytes>batch.command.bytes||
   batch.state!=='open'&&(batch.files.count!==batch.command.count||batch.bytes!==batch.command.bytes))fail('CATALOGUE_DAMAGED');
  if(batch.state==='completed'&&(batch.result?.kind!=='collection'||batch.result.id!==id||!validFingerprint(batch.result.revision)))fail('CATALOGUE_DAMAGED');
  const finalization=this.finalization.validate(batch);
  if(finalization&&(batch.state==='open'||batch.state==='completed'&&finalization.count!==batch.files.count))fail('CATALOGUE_DAMAGED');
  return batch;
 }
 async authorized(id){const batch=await this.read(id);await this.materials.assertOwner(batch.command.recordId);return batch;}
 summary(batch){return {id:batch.id,...batch.command,state:batch.state,registered:batch.files.count,ready:batch.ready,receivedManifestBytes:batch.bytes,result:batch.result,createdAt:batch.createdAt};}
 async start({id=randomUUID(),recordId,title,provenance='',count,bytes,purpose,sourceMode}){
  const command={recordId,title,provenance,count,bytes,...(purpose===undefined?{}:{purpose}),...(sourceMode===undefined?{}:{sourceMode})};this.validate(command);
  return this.workspace.withLock(async()=>{
   await this.materials.assertOwner(recordId);const file=this.file(id),prior=await this.json(file);
   if(prior){const batch=await this.read(id);if(batch.intent!==hash(command))fail('MATERIAL_CHANGED');return this.summary(batch);}
   if(await this.materials.current(id)||await this.workspace.readMetadata('.observanda/intake/finalization/'+id+'/batch.json',131072)!==null)fail('MATERIAL_CHANGED');
   await this.materials.index.ensureLocked();
   const acquisition=await this.materials.retainCurrentRecordLocked(recordId);
   const batch={format:1,id,command,intent:hash(command),files:empty('files'),bytes:0,ready:0,acquisition,state:'open',result:null,createdAt:new Date().toISOString()};
   await this.put(file,batch);const feed=this.feed(recordId);await feed.putLocked(batch);await this.put(feed.marker,{version:1});return this.summary(batch);
  });
 }
 async append({id,offset,items}){
  if(!Number.isSafeInteger(offset)||offset<0||!Array.isArray(items)||!items.length||items.length>64||!items.every(validEvidenceFile))fail();
  const normalized=items.map(evidenceFileMetadata);
  return this.workspace.withLock(()=>withWorkspaceMetadataBatch(this.workspace,async()=>{
   const batch=await this.authorized(id),receipt=this.file(id,'accepted/'+offset+'.json'),prior=await this.json(receipt);
   if(prior){
    if(prior.hash!==hash(normalized)||prior.count!==items.length)fail('MATERIAL_CHANGED');
    const saved=(await this.materials.sequences.page(batch.files,{offset,limit:prior.count})).items.map(evidenceFileMetadata);
    if(hash(saved)!==prior.hash)fail('CATALOGUE_DAMAGED');return this.summary(batch);
   }
   if(batch.state!=='open'||offset!==batch.files.count||offset+items.length>batch.command.count)fail('MATERIAL_CHANGED');
   const entries=[];
   for(const file of normalized){
    if(batch.command.sourceMode==='folder'&&!file.sourcePath)fail();
    if(file.sourcePath){
     const location=this.file(id,'paths/'+digest(file.sourcePath)+'.json');
     if(await this.json(location))fail('MATERIAL_CHANGED');await this.put(location,{path:file.sourcePath});
    }
    if(!Number.isSafeInteger(batch.bytes+file.size)||batch.bytes+file.size>batch.command.bytes)fail();
    const seenFile=this.file(id,'fingerprints/'+file.fingerprint+'.json'),seen=await this.json(seenFile);
    let cached=await this.json(root+'/reuse/'+batch.command.recordId+'/'+file.fingerprint+'.json');
    if(cached?.stagedBatch){const owner=await materialBatch(this.workspace,cached.stagedBatch);if(owner.command.recordId!==batch.command.recordId)fail('CATALOGUE_DAMAGED');if(owner.state!=='completed')cached=null;}
    let reuse=null;
    if(seen)reuse={importId:seen.id};
    else if(cached){
     const doc=await this.materials.read(cached);
     if(doc.kind!=='artifact'||doc.recordId!==batch.command.recordId||doc.content.fingerprint!==file.fingerprint||doc.content.size!==file.size)fail('MATERIAL_MISSING');
     reuse={ref:{kind:cached.kind,id:cached.id,revision:cached.revision}};
    }
    const session=await this.materials.startImportLocked({recordId:batch.command.recordId,name:file.name,size:file.size,provenance:batch.command.provenance,derivesFrom:[]},
     {batchId:id,acquisition:batch.acquisition,fingerprint:file.fingerprint,reuse,...(file.sourcePath?{sourcePath:file.sourcePath}:{}),...(batch.command.purpose?{sourcePurpose:batch.command.purpose}:{})});
    entries.push({...file,id:session.id});batch.bytes+=file.size;if(reuse||!file.size)batch.ready++;
    if(!seen)await this.put(seenFile,{id:session.id});
   }
   batch.files=await this.materials.sequences.append(batch.files,entries);
   await this.put(receipt,{hash:hash(normalized),count:items.length});await this.put(this.file(id),batch);return this.summary(batch);
  }));
 }
 async page({id,offset=0,limit=20}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>50)fail();
  return this.materials.readSnapshot(async()=>{
   const batch=await this.authorized(id),page=await this.materials.sequences.page(batch.files,{offset,limit}),items=[];
   for(const file of page.items){
    const session=await this.session(batch,file),prepared=await this.json(this.file(id,'prepared/'+file.id+'.json'));
    items.push({...file,received:this.materials.uploads.bytes(session),reused:!!session.reuse,sha256:prepared?.sha256??null,completed:session.completed});
   }
   return {...page,items,batch:this.summary(batch)};
  });
 }
 async session(batch,file){
  const session=await this.materials.importState(file.id);
  if(session.batchId!==batch.id||session.recordId!==batch.command.recordId||session.name!==file.name||session.size!==file.size||session.fingerprint!==file.fingerprint||
   session.sourcePath!==file.sourcePath||session.sourcePurpose!==batch.command.purpose||hash(session.acquisition)!==hash(batch.acquisition))fail('CATALOGUE_DAMAGED');return session;
 }
 async uploadedLocked(session){
  const batch=await this.authorized(session.batchId);if(batch.state!=='open')fail('MATERIAL_CHANGED');batch.ready++;await this.put(this.file(batch.id),batch);
 }
 async enqueue(id,queue){
  // Validate the frozen file set without monopolizing the writer. Admission
  // rechecks its immutable manifest and upload counters in the transaction.
  const inspected=await this.materials.readSnapshot(async()=>{
   const batch=await this.authorized(id);
   if(batch.files.count!==batch.command.count||batch.bytes!==batch.command.bytes||batch.ready!==batch.command.count)fail('MATERIAL_INCOMPLETE');
   // A processing/completed batch has already admitted this immutable
   // manifest; replay must not walk its files again just to find its job.
   if(batch.state==='open')for await(const file of this.materials.sequences.items(batch.files)){
    const session=await this.session(batch,file);
    if(!session.reuse&&!session.completed){
     if(this.materials.uploads.count(session)!==Math.ceil(session.size/session.chunkSize))fail('MATERIAL_INCOMPLETE');
     if(await fileFingerprint(session.size,this.materials.uploads.entries(session),digest)!==file.fingerprint)fail('MATERIAL_SOURCE_CHANGED');
    }
   }
   return {manifest:hash(batch.files),intent:batch.intent,ready:batch.ready,bytes:batch.bytes};
  });
  return queue.transaction(()=>withWorkspaceMetadataBatch(this.workspace,async()=>{
   const batch=await this.authorized(id);
   if(hash(batch.files)!==inspected.manifest||batch.intent!==inspected.intent||batch.ready!==inspected.ready||batch.bytes!==inspected.bytes)fail('MATERIAL_CHANGED');
   if(batch.state==='open'){batch.state='processing';await this.put(this.file(id),batch);}
   return queue.enqueueLocked({id,type:'evidence.batch',scope:batch.command.recordId,input:{manifest:inspected.manifest}});
  }));
 }
 async authorize(job){
  const batch=await this.authorized(job.id);
  if(batch.command.recordId!==job.scope||batch.state==='open'||job.input.manifest!==hash(batch.files))fail('JOB_CHANGED');return batch;
 }
 async preparedContent(session,prepared){
  if(!prepared||prepared.sessionHash!==digest(JSON.stringify({...session,completed:null}))||prepared.size!==session.size||!researchId(prepared.originalId)||!researchId(prepared.storageId)||!validFingerprint(prepared.sha256))fail('MATERIAL_MISSING');
  return this.materials.originalContent({kind:'artifact',id:session.id,recordId:session.recordId,content:{originalId:prepared.originalId,storageId:prepared.storageId,size:prepared.size,sha256:prepared.sha256}});
 }
 async verifyPrepared(session,prepared,{signal,verified}={}){
  const content=await this.preparedContent(session,prepared),identity=content.file+':'+prepared.size+':'+prepared.sha256;
  if(verified?.has(identity))return prepared;
  try{await content.verify({signal});}catch(error){if(error.code==='MEDIA_INVALID')fail('MATERIAL_MISSING');throw error;}
  if(verified){if(verified.size>=64)verified.delete(verified.values().next().value);verified.add(identity);}
  return prepared;
 }
 async prepare(job,{signal,progress=async()=>{}}={},write){
  const batch=await this.authorize(job);let done=0,bytes=0;const verified=new Set();
  // Sessions are frozen by enqueue. Pin at most 64 per read snapshot and
  // checkpoint at most 32 verified originals in each fenced transaction.
  // Uncheckpointed files can be rebuilt from their durable uploaded chunks.
  for(let offset=0;offset<batch.files.count;offset+=64)await this.materials.readSnapshot(async()=>{
   const page=await this.materials.sequences.page(batch.files,{offset,limit:64}),preparedHere=new Map(),pending=[];
   await write(async()=>{
    signal?.throwIfAborted();
    for(const file of page.items){
     // Read receipts under the current writer fence before deleting old
     // attempts. A retained receipt may belong to an earlier successful lease.
     if(await this.json(this.file(batch.id,'prepared/'+file.id+'.json')))continue;
     const session=await this.session(batch,file);
     if(!session.reuse)await this.materials.cleanAttempts(file.id);
    }
   });
   const checkpoint=async()=>{
    if(!pending.length)return;
    await write(()=>withWorkspaceMetadataBatch(this.workspace,async()=>{
     signal?.throwIfAborted();
     for(const {receipt,prepared} of pending)await this.put(receipt,prepared);
    }));
    pending.length=0;
   };
   for(const file of page.items){
    signal?.throwIfAborted();const receipt=this.file(batch.id,'prepared/'+file.id+'.json');
    const result=await (async()=>{
    const session=await this.session(batch,file);let prepared=await this.json(receipt);
    if(prepared){await this.verifyPrepared(session,prepared,{signal,verified});return {prepared,persist:false};}
    if(session.reuse){
     let source;
     if(session.reuse.importId){
      if(!researchId(session.reuse.importId))fail('MATERIAL_MISSING');
      const original=await this.materials.importState(session.reuse.importId);
      if(original.batchId!==batch.id||original.fingerprint!==file.fingerprint)fail('MATERIAL_MISSING');
      source=await this.verifyPrepared(original,preparedHere.get(original.id)??await this.json(this.file(batch.id,'prepared/'+original.id+'.json')),{signal,verified});
     }else{
      const {doc,content}=await this.materials.artifact(session.reuse.ref,{signal});
      if(doc.recordId!==job.scope||doc.content.fingerprint!==file.fingerprint)fail('MATERIAL_MISSING');
      source={size:content.size,sha256:content.sha256,storageId:doc.content.storageId,originalId:doc.content.originalId??doc.id};
     }
     prepared={...source,sessionHash:digest(JSON.stringify(session))};
    }else{
     if(await fileFingerprint(session.size,this.materials.uploads.entries(session),digest)!==file.fingerprint)fail('MATERIAL_SOURCE_CHANGED');
     prepared={...await this.materials.prepareImport(session.id,{signal,storageId:job.lease.token,
      progress:p=>progress({stage:'Verifying file '+(done+1)+' of '+batch.command.count,done:bytes+p.done,total:batch.command.bytes,unit:'bytes'})}),originalId:session.id};
    }
    return {prepared,persist:true};
    })();
    if(result.persist){pending.push({receipt,prepared:result.prepared});if(pending.length===32)await checkpoint();}
    preparedHere.set(file.id,result.prepared);bytes+=file.size;
    await progress({stage:'Verified files',done:++done,total:batch.command.count});
   }
   await checkpoint();
  });
  return this.finalization.stage(job,{signal,progress},write);
 }
 async commit(job,prepared){
  return withWorkspaceMetadataBatch(this.workspace,()=>this.finalization.publish(job,prepared));
 }
 async list(recordId,options={}){
  await this.materials.assertOwner(recordId);return this.materials.readSnapshot(async()=>{
   const feed=this.feed(recordId);if(!await feed.initialized())return {items:[],next:null};
   const page=await feed.page(options),items=[];
   for(const pointer of page.items){const batch=await this.read(pointer.id);if(batch.command.recordId!==recordId||batch.state==='completed')fail('CATALOGUE_DAMAGED');items.push(this.summary(batch));}
   return {...page,items};
  });
 }
 async verify(check,{verified=new Set()}={}){
  for await(const id of this.workspace.metadataNames(root)){
   if(!researchId(id))continue;const batch=await this.read(id);await check(batch.acquisition);
   await withScratch(async ids=>{
   let bytes=0,ready=0,position=0;
   for await(const file of this.materials.sequences.items(batch.files)){
    if(!researchId(file.id)||!validEvidenceFile(file)||!await ids.add(file.id))fail('CATALOGUE_DAMAGED');bytes+=file.size;
    const session=await this.session(batch,file),prepared=await this.json(this.file(id,'prepared/'+file.id+'.json'));
    if(session.reuse||this.materials.uploads.bytes(session)===session.size)ready++;
    if(prepared)await this.verifyPrepared(session,prepared,{verified});
    await this.finalization.verifyFile(batch,file,position++,session,prepared);
    if(batch.state==='completed'){
     if(!session.completed||!prepared)fail('CATALOGUE_DAMAGED');await check(session.completed);
     const doc=await this.materials.read(session.completed),c=doc.content;
     if(doc.id!==session.id||doc.recordId!==batch.command.recordId||c.name!==file.name||c.sourcePath!==file.sourcePath||c.sourcePurpose!==batch.command.purpose||c.size!==file.size||c.fingerprint!==file.fingerprint||c.sha256!==prepared.sha256||c.originalId!==prepared.originalId||c.storageId!==prepared.storageId||c.intakeId!==id)fail('CATALOGUE_DAMAGED');
    }else if(session.completed)fail('CATALOGUE_DAMAGED');
   }
   if(bytes!==batch.bytes||ready!==batch.ready)fail('CATALOGUE_DAMAGED');
   let attached=0;for await(const name of this.workspace.metadataNames(this.file(id,'attached'))){if(!/^[a-f0-9-]{36}\.json$/.test(name)||!await ids.has(name.slice(0,-5)))fail('CATALOGUE_DAMAGED');attached++;}
   if(attached!==(batch.finalization?.count??0))fail('CATALOGUE_DAMAGED');
   let accepted=0;
   while(accepted<batch.files.count){
    const receipt=await this.json(this.file(id,'accepted/'+accepted+'.json'));
    if(!receipt||!Number.isSafeInteger(receipt.count)||receipt.count<1||receipt.count>64||accepted+receipt.count>batch.files.count)fail('CATALOGUE_DAMAGED');
    const values=(await this.materials.sequences.page(batch.files,{offset:accepted,limit:receipt.count})).items.map(evidenceFileMetadata);
    if(hash(values)!==receipt.hash)fail('CATALOGUE_DAMAGED');accepted+=receipt.count;
   }
   const feed=this.feed(batch.command.recordId),pointer=await this.json(feed.order+'/'+feed.key(batch));
   if(batch.state==='completed'){
    if(pointer!==null)fail('CATALOGUE_DAMAGED');
    await check(batch.result);const doc=await this.materials.read(batch.result);
    if(hash(doc.content.intake?.files)!==hash(batch.files)||doc.content.inputsIndex?.count!==ids.size)fail('CATALOGUE_DAMAGED');
    for await(const ref of this.materials.references(doc.content)){if(!await ids.remove(ref.id))fail('CATALOGUE_DAMAGED');const session=await this.materials.importState(ref.id);if(hash(ref)!==hash(session.completed))fail('CATALOGUE_DAMAGED');}
    if(ids.size)fail('CATALOGUE_DAMAGED');
   }else if(pointer?.id!==id)fail('CATALOGUE_DAMAGED');
   });
  }
 }
}

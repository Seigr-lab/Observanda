import {test} from 'node:test';
import {JobWorker} from '../src/jobs.js';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {intakeFixture,hash} from './fixtures/local-intake.js';
import {LocalIntake} from '../src/intake/service.js';
import {LocalIntakeFinalization,verifyLocalIntakeFinalizations} from '../src/intake/finalization.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {RecordValues} from '../src/record-values.js';
import {RunReadiness} from '../src/run-readiness.js';
import {runEvidenceRevision} from '../src/run-receipts.js';
import {MaterialIndex} from '../src/material-index.js';
import {catalogueContext} from '../src/research-catalogue.js';
import {projectSourceIntakeOwner} from '../src/project-source-intake-owner.js';
import {projectSourceEvidenceOwner} from '../src/project-source-evidence-owner.js';
const options=()=>({signal:new AbortController().signal,progress:async()=>{}});
async function staged(f){
 const preview=await f.service.preview(f.command),command={...f.command,expectedPin:preview.pin};await f.service.stage(command);await f.worker.runOnce();assert.equal((await f.service.status(command)).state,'prepared');await f.service.apply(command);return command;
}
async function claimed(f){const job=await f.queue.claim();assert.equal(job?.type,'intake.apply');return {job,prepared:await f.queue.definition(job).prepare(job,options())};}
async function hidden(f,ref){const materials=new ResearchMaterials(f.ws);assert.equal(await materials.current(ref.id),null);await assert.rejects(materials.read(ref),{code:'MATERIAL_INCOMPLETE'});await assert.rejects(materials.index.inputSet(ref),{code:'MATERIAL_INCOMPLETE'});assert.equal((await materials.list({recordId:f.record.id})).items.some(item=>item.id===ref.id),false);}

test('local intake checkpoints 65 files privately, resumes once, and publishes an exact digest after independent authoring', {timeout:180000},async t=>{
 const f=await intakeFixture(t);f.queue.leaseMs=120000;
 for(let i=1;i<65;i++){const bytes=Buffer.from('independent acquisition '+i),file={id:randomUUID(),path:'source-'+i+'.bin',size:bytes.length,sha256:hash(bytes),provenance:'Synthetic acquisition'};f.manifest.files.push(file);await writeFile(path.join(f.source,file.path),bytes);}
 await f.write();const command=await staged(f),materials=new ResearchMaterials(f.ws),job=await f.queue.claim(),definition=f.queue.definition(job);let checkpoint=false;
 await assert.rejects(definition.prepare(job,{...options(),progress:async progress=>{if(progress.stage==='Preparing retained files'&&progress.done===32){checkpoint=true;assert.equal(catalogueContext.getStore(),undefined);throw new Error('checkpoint interruption');}}}),/checkpoint interruption/);assert.ok(checkpoint);
 await f.queue.release(job.id,job.lease.token,{error:new Error('interrupted')});const owner=new LocalIntakeFinalization(f.service),proposal=await f.service.read(f.manifest.id),batch=await owner.read(proposal);assert.equal(batch.finalization.count,32);
 const first=await materials.sequences.item(batch.finalization.inputsIndex,0);await hidden(f,first);
 await f.ws.catalogue(()=>verifyLocalIntakeFinalizations(f.ws,ref=>materials.checkReference(ref)));
 await f.ws.catalogue(async store=>{const record=id=>({id});assert.deepEqual(await projectSourceIntakeOwner(store,{namespaceId:f.book.id},record)('metadata:'+owner.file(proposal.id)),{id:f.record.id});assert.deepEqual(await projectSourceEvidenceOwner(store,record)('metadata:.observanda/materials/objects/'+first.id+'/head.json'),{id:f.record.id});});
 const other=f.book.entries.find(entry=>entry.id!==f.record.id),values=new RecordValues(f.ws),target={workspaceId:f.book.id,recordId:other.id,field:'title'},base=await values.read(target);await values.save({...target,expectedRevision:base.revision,value:{value:'Foreground work while intake is interrupted'}});
 await rename(f.source,f.source+' unavailable');await f.service.control(command,'retry');
 let artifacts=0,finalizing=false;const commit=ResearchMaterials.prototype.commit,finish=LocalIntakeFinalization.prototype.commit,projected=MaterialIndex.prototype.projectedHeads;
 t.mock.method(ResearchMaterials.prototype,'commit',async function(command,...rest){if(command.kind==='artifact'){assert.equal(finalizing,false);artifacts++;}return commit.call(this,command,...rest);});
 t.mock.method(LocalIntakeFinalization.prototype,'commit',async function(...args){finalizing=true;try{return await finish.apply(this,args);}finally{finalizing=false;}});
 t.mock.method(MaterialIndex.prototype,'projectedHeads',function(...args){assert.equal(catalogueContext.getStore(),undefined,'Digest preparation must not hold the writer');return projected.apply(this,args);});
 await f.worker.runOnce();const status=await f.service.status(command);assert.equal(status.state,'completed',JSON.stringify(status));assert.equal(artifacts,33);assert.equal(status.receipt.files.length,65);assert.deepEqual(status.receipt.files[0],first);
 const receipt=(await new RunReadiness(f.ws).receiptPage(f.record.id)).items[0];assert.equal(receipt.evidenceRevision,await runEvidenceRevision(f.ws,f.record.id));
 let cursor=null,seen=[];do{const page=await materials.list({recordId:f.record.id,limit:7,cursor});seen.push(...page.items);cursor=page.next;}while(cursor);assert.equal(seen.length,66);assert.equal(new Set(seen.map(item=>item.id)).size,66);
 await f.ws.catalogue(()=>verifyLocalIntakeFinalizations(f.ws,ref=>materials.checkReference(ref)));await f.ws.catalogue(()=>materials.index.verify({initialize:false}));
 assert.deepEqual((await f.service.apply(command)).receipt,status.receipt);
});

test('local intake final receipt failure leaves staged artifacts hidden and retry retains their exact revisions',async t=>{
 const f=await intakeFixture(t),command=await staged(f),materials=new ResearchMaterials(f.ws),write=LocalIntake.prototype.write;
 t.mock.method(LocalIntake.prototype,'write',async function(value){await write.call(this,value);if(value.state==='completed')throw new Error('receipt interruption');});await f.worker.runOnce();LocalIntake.prototype.write.mock.restore();
 let status=await f.service.status(command);assert.equal(status.job.state,'failed');assert.equal(status.receipt,null);const head=await materials.current(f.manifest.files[0].id,{includeStaged:true});await hidden(f,head);assert.equal((await new RunReadiness(f.ws).receiptPage(f.record.id)).total,0);
 await f.service.control(command,'retry');await f.worker.runOnce();status=await f.service.status(command);assert.equal(status.state,'completed',JSON.stringify(status));assert.equal(status.receipt.files[0].revision,head.revision);assert.equal((await new RunReadiness(f.ws).receiptPage(f.record.id)).total,1);
 // A subsequent file-free analysis amendment reuses the existing feed position.
 const previous=status.receipt.analyses[0];f.manifest.id=randomUUID();f.manifest.files=[];f.manifest.analyses[0].expectedRevision=previous.revision;f.manifest.analyses[0].inputs=[status.receipt.files[0]];f.manifest.analyses[0].version='2';f.command={...f.command,id:f.manifest.id};await f.write();const next=await staged(f);await f.worker.runOnce();const amended=(await f.service.status(next)).receipt;assert.ok(amended);assert.equal((await materials.read(amended.analyses[0])).previous,previous.revision);
 const receipt=(await new RunReadiness(f.ws).receiptPage(f.record.id)).items.find(item=>item.id===f.manifest.id);assert.equal(receipt.evidenceRevision,await runEvidenceRevision(f.ws,f.record.id));
});

test('retained-byte tampering, forged preparation and receipt-ID collisions cannot publish a local intake',async t=>{
 const f=await intakeFixture(t),command=await staged(f),{job,prepared}=await claimed(f),proposal=await f.service.read(f.manifest.id),content=await f.service.preparedContent(proposal,proposal.prepared[0]),bytes=await readFile(content.file);
 assert.ok(Object.isFrozen(prepared)&&Object.isFrozen(prepared.files[0].stamp));await assert.rejects(f.queue.complete(job.id,job.lease.token,structuredClone(prepared)),{code:'INTAKE_CHANGED'});
 await assert.rejects(new ResearchMaterials(f.ws).intakes.start({id:f.manifest.id,recordId:f.record.id,title:'Duplicate local owner',count:1,bytes:21}),{code:'MATERIAL_CHANGED'});bytes[bytes.length-1]^=1;await writeFile(content.file,bytes);
 await assert.rejects(f.queue.complete(job.id,job.lease.token,prepared),{code:'INTAKE_CHANGED'});const materials=new ResearchMaterials(f.ws),head=await materials.current(f.manifest.files[0].id,{includeStaged:true});await hidden(f,head);assert.equal((await f.service.status(command)).receipt,null);
});

test('local intake final admission fences material changes, cancellation and lease replacement after pre-completion proof',async t=>{
 const f=await intakeFixture(t),command=await staged(f),materials=new ResearchMaterials(f.ws);let attempt=await claimed(f);const definition=f.queue.definition(attempt.job),before=definition.beforeComplete;
 definition.beforeComplete=async(...args)=>{const proof=await before(...args),acquisition=await materials.pinRecord(f.record.id,f.manifest.expectedRevision);await materials.analysis({recordId:f.record.id,title:'Concurrent evidence',tool:'Synthetic',version:'1',parameters:'',inputs:[acquisition]});return proof;};
 await assert.rejects(f.queue.complete(attempt.job.id,attempt.job.lease.token,attempt.prepared),{code:'MATERIAL_CHANGED'});await f.queue.release(attempt.job.id,attempt.job.lease.token,{error:new Error('retry')});await f.service.control(command,'retry');attempt=await claimed(f);
 definition.beforeComplete=async(...args)=>{const proof=await before(...args);await f.queue.control(attempt.job.id,'cancel');return proof;};await assert.rejects(f.queue.complete(attempt.job.id,attempt.job.lease.token,attempt.prepared),{code:'JOB_CANCELLED'});await f.queue.release(attempt.job.id,attempt.job.lease.token);await f.service.control(command,'retry');attempt=await claimed(f);
 definition.beforeComplete=async(...args)=>{const proof=await before(...args);await f.queue.transaction(async()=>{const job=await f.queue.read(attempt.job.id);job.lease={token:randomUUID(),until:job.lease.until};await f.queue.write(job);});return proof;};await assert.rejects(f.queue.complete(attempt.job.id,attempt.job.lease.token,attempt.prepared),{code:'JOB_LEASE'});definition.beforeComplete=before;
 const head=await materials.current(f.manifest.files[0].id,{includeStaged:true});await hidden(f,head);assert.equal((await f.service.status(command)).receipt,null);assert.equal((await new RunReadiness(f.ws).receiptPage(f.record.id)).total,0);
});

// No database is needed to prove the final heartbeat lifetime: completion may
// finish while a queued heartbeat still owns credentials and must be awaited.
test('a pre-completion worker waits for its final deferred heartbeat before discard',async()=>{
 let resolvePulse,entered;const pulseEntered=new Promise(resolve=>entered=resolve),pending=new Promise(resolve=>resolvePulse=resolve);let discarded=false,finished=false;
 const job={id:randomUUID(),lease:{token:randomUUID()}},definition={beforeComplete:async()=>{},prepare:async()=>({}),discard:async()=>{discarded=true;}};
 const queue={leaseMs:300,claim:async()=>job,definition:()=>definition,pulse:async()=>{entered();await pending;},complete:async()=>{await pulseEntered;},release:async()=>{throw new Error('Unexpected release');}};
 const worker=new JobWorker(queue);worker.enabled=true;const running=worker.runOnce().then(()=>finished=true);await pulseEntered;await delay(20);assert.equal(finished,false);assert.equal(discarded,false);assert.equal(worker.active,job);resolvePulse();await running;assert.equal(discarded,true);assert.equal(worker.active,null);await worker.stop();
});

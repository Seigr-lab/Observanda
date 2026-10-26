import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,readFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {recordRevision,ResearchRecords} from '../src/research.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {LocalIntake} from '../src/intake/service.js';
import {validateIntake} from '../src/intake/contract.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {contentBuffer} from '../src/file-content.js';
import {RunReadiness} from '../src/run-readiness.js';
import {watchIntake} from '../src/intake/watch.js';
import {intakeFixture,hash} from './fixtures/local-intake.js';
import {RecordValues} from '../src/record-values.js';
import {RetainedRecordDocuments} from '../src/retained-record-documents.js';
test('preview shares target admission after hashing and fresh checks reject later conflicts',async t=>{
 const f=await intakeFixture(t),bytes=Buffer.alloc(4096,17);f.manifest.files=[];f.manifest.analyses=[];
 for(let i=0;i<64;i++){const file={id:randomUUID(),path:'sample-'+i+'.bin',size:bytes.length,sha256:hash(bytes),provenance:'Synthetic target validation'};f.manifest.files.push(file);await writeFile(path.join(f.source,file.path),bytes);}
 await f.write();const open=f.ws.openCatalogue.bind(f.ws),current=f.service.materials.current.bind(f.service.materials);let admissions=0,lookups=0,pulses=0;
 const admission=t.mock.method(f.ws,'openCatalogue',(...args)=>{admissions++;return open(...args);}),lookup=t.mock.method(f.service.materials,'current',(...args)=>{lookups++;return current(...args);});
 let preview;
 try{
  preview=await f.service.preview(f.command,{progress:async()=>{pulses++;assert.equal(admissions,0,'source streaming must not hold a metadata snapshot');}});
  assert.equal(admissions,1,'file count must not multiply catalogue admission');assert.equal(lookups,64);assert.ok(pulses>=64);assert.deepEqual(preview.files.map(file=>file.id),f.manifest.files.map(file=>file.id));
 }finally{admission.mock.restore();lookup.mock.restore();}
 assert.equal(await f.service.read(f.manifest.id,{optional:true}),null);
 const controller=new AbortController(),cancelled=Error('Preview target validation cancelled');let checked=0;
 const interrupted=t.mock.method(f.service.materials,'current',async(...args)=>{const value=await current(...args);checked++;controller.abort(cancelled);return value;});
 try{await assert.rejects(f.service.preview(f.command,{signal:controller.signal}),error=>error===cancelled);assert.equal(checked,1);}finally{interrupted.mock.restore();}
 const materials=new ResearchMaterials(f.ws),last=f.manifest.files.at(-1);
 await materials.collection({id:last.id,recordId:f.record.id,title:'Concurrent material identity',inputs:[]});
 await assert.rejects(f.service.preview(f.command),{code:'MATERIAL_CHANGED'});
 await assert.rejects(f.service.stage({...f.command,expectedPin:preview.pin}),{code:'MATERIAL_CHANGED'});
 assert.equal(await f.service.read(f.manifest.id,{optional:true}),null,'preview cannot admit a conflicting later stage');
 last.id=randomUUID();await f.write();let changed=false;
 await assert.rejects(f.service.preview(f.command,{progress:async()=>{
  if(changed)return;changed=true;
  await new ResearchRecords(f.ws,{}).save({workspaceId:f.book.id,changes:[{id:f.record.id,expectedRevision:f.manifest.expectedRevision,record:{...f.record,title:'Changed while source bytes were read'}}]},{receipt:true});
 }}),{code:'RECORD_CHANGED'});
 assert.equal(changed,true);
});

test('versioned intake previews without writing, stages privately, applies atomically and replays lost acknowledgements',async t=>{
 const f=await intakeFixture(t),before=await f.ws.read(),materials=new ResearchMaterials(f.ws),read=ResearchCatalogue.prototype.read;
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Intake reconstructed its owning record');});
 t.mock.method(ResearchMaterials.prototype,'owner',()=>{throw Error('Intake read a complete evidence owner');});
 ResearchCatalogue.prototype.read=()=>{throw Error('Whole workspace read during intake');};
 try{
  const preview=await f.service.preview(f.command);assert.equal(preview.files.length,1);assert.equal(await f.service.read(f.manifest.id,{optional:true}),null);
  const command={...f.command,expectedPin:preview.pin};await f.service.stage(command);await f.worker.runOnce();
  let status=await f.service.status(command);assert.equal(status.state,'prepared',JSON.stringify(status));assert.equal(await materials.current(f.manifest.files[0].id),null);
  assert.deepEqual((await f.service.stage(command)).pin,preview.pin);
  await f.service.apply(command);await f.worker.runOnce();status=await f.service.status(command);assert.equal(status.state,'completed',JSON.stringify(status));assert.equal(status.receipt.analyses.length,1);
  const replay=await f.service.apply(command);assert.deepEqual(replay.receipt,status.receipt);
  assert.deepEqual((await f.service.stage(command)).receipt,status.receipt);
  const analysis=await materials.read(status.receipt.analyses[0]);assert.equal(analysis.content.toolSha256,f.manifest.analyses[0].toolSha256);
  const {content}=await materials.artifact(status.receipt.files[0]);assert.equal((await contentBuffer(content)).toString(),'PRIVATE native source');
  assert.equal((await f.service.list(command)).items.length,1);
 }finally{ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.record.mock.restore();ResearchMaterials.prototype.owner.mock.restore();}
 assert.deepEqual(await f.ws.read(),before);
 await assert.rejects(f.service.stage({...f.command,expectedPin:hash('different request')}),{code:'INTAKE_CHANGED'});
});

test('large-record intake retains exact sources, rolls back failed admission and replays after later authoring',async t=>{
 const f=await intakeFixture(t,{large:true}),materials=new ResearchMaterials(f.ws),ref=await materials.pinRecord(f.record.id,f.manifest.expectedRevision);
 f.manifest.analyses[0].inputs.push({kind:ref.kind,id:ref.id,revision:ref.revision});await f.write();
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Intake reconstructed a large record');});t.mock.method(ResearchMaterials.prototype,'owner',()=>{throw Error('Intake loaded a complete evidence owner');});
 const read=ResearchMaterials.prototype.read;t.mock.method(ResearchMaterials.prototype,'read',function(r,...args){if(r.kind==='record')throw Error('Intake reconstructed a retained source');return read.call(this,r,...args);});
 const preview=await f.service.preview(f.command),command={...f.command,expectedPin:preview.pin};await f.service.stage(command);await f.worker.runOnce();await f.service.apply(command);
 const write=LocalIntake.prototype.write;t.mock.method(LocalIntake.prototype,'write',async function(p){await write.call(this,p);if(p.state==='completed')throw Error('Interrupted intake receipt');});await f.worker.runOnce();LocalIntake.prototype.write.mock.restore();
 let status=await f.service.status(command);assert.equal(status.job.state,'failed');assert.equal(status.receipt,null);assert.equal(await materials.current(f.manifest.files[0].id),null);assert.equal((await new RunReadiness(f.ws).receiptPage(f.record.id)).total,0);
 await f.service.control(command,'retry');await f.worker.runOnce();status=await f.service.status(command);assert.equal(status.state,'completed',JSON.stringify(status));assert.equal(status.receipt.recordRevision,ref.revision);
 const artifact=await materials.read(status.receipt.files[0]);assert.deepEqual(artifact.content.acquisition,{kind:'record',id:ref.id,revision:ref.revision});
 const values=new RecordValues(f.ws),target={workspaceId:f.book.id,recordId:f.record.id,field:'title'},base=await values.read(target);await values.save({...target,expectedRevision:base.revision,value:{value:'Later interpretation'}});
 assert.deepEqual((await f.service.apply(command)).receipt,status.receipt);const page=await f.service.list(command);assert.notEqual(page.recordRevision,ref.revision);assert.equal(page.items.length,1);
 const retained=await new RetainedRecordDocuments(f.ws).read({ref});assert.equal(retained.previous.sections.total,73);assert.equal(retained.previous.header.title,f.record.title);assert.equal((await materials.read(status.receipt.analyses[0])).content.toolSha256,f.manifest.analyses[0].toolSha256);
});
test('changed sources cannot stage; retained reviewed bytes apply and stale targets still conflict',async t=>{
 const f=await intakeFixture(t),preview=await f.service.preview(f.command),command={...f.command,expectedPin:preview.pin};
 await f.service.stage(command);await writeFile(path.join(f.source,'capture.bin'),'CHANGED native source');
 await f.worker.runOnce();let status=await f.service.status(command);assert.equal(status.job.state,'failed');assert.equal(status.job.error,'INTAKE_CHANGED');
 assert.equal(await new ResearchMaterials(f.ws).current(f.manifest.files[0].id),null);
 await writeFile(path.join(f.source,'capture.bin'),'PRIVATE native source');await f.service.control(command,'retry');await f.worker.runOnce();assert.equal((await f.service.status(command)).state,'prepared');
 await writeFile(path.join(f.source,'capture.bin'),'CHANGED native source');await f.service.apply(command);await f.worker.runOnce();status=await f.service.status(command);assert.equal(status.state,'completed',JSON.stringify(status));assert.equal((await contentBuffer((await new ResearchMaterials(f.ws).artifact(status.receipt.files[0])).content)).toString(),'PRIVATE native source');
 await writeFile(path.join(f.source,'capture.bin'),'PRIVATE native source');
 f.manifest.id=randomUUID();f.manifest.files[0].id=randomUUID();f.manifest.analyses=[];await f.write();const next={...f.command,id:f.manifest.id},p=await f.service.preview(next);
 await f.service.stage({...next,expectedPin:p.pin});await f.worker.runOnce();
 await new ResearchRecords(f.ws,{}).save({workspaceId:f.book.id,changes:[{id:f.record.id,expectedRevision:recordRevision(f.record),record:{...f.record,title:'Concurrent authoring'}}]},{receipt:true});
 await assert.rejects(f.service.apply({...next,expectedPin:p.pin}),{code:'RECORD_CHANGED'});
});
test('record amendment receipt reflects the authoritative revision and failed amendment attaches nothing',async t=>{
 const f=await intakeFixture(t);f.manifest.record={...f.record,title:'Amended run',share:false};await f.write();
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Amendment reconstructed the saved record');});
 t.mock.method(ResearchMaterials.prototype,'owner',()=>{throw Error('Amendment reconstructed its evidence owner');});
 const preview=await f.service.preview(f.command),command={...f.command,expectedPin:preview.pin};await f.service.stage(command);await f.worker.runOnce();await f.service.apply(command);await f.worker.runOnce();
 const status=await f.service.status(command);assert.equal(status.state,'completed',JSON.stringify(status));ResearchCatalogue.prototype.record.mock.restore();const record=(await f.ws.read()).book.entries.find(r=>r.id===f.record.id);
 assert.equal(status.receipt.recordRevision,recordRevision(record));assert.equal(record.title,'Amended run');assert.equal(record.share,false);
});
test('contract rejects path traversal, ambiguous targets, publication and execution instructions',async t=>{
 const f=await intakeFixture(t);
 for(const mutate of [m=>m.files[0].path='../escape',m=>m.files[0].path='C:/secret',m=>m.files[0].path='NUL.txt',m=>m.files[0].path='/absolute',m=>m.runScript='decoder.exe',m=>m.record={...f.record,share:true},m=>m.version=2,m=>m.analyses[0].toolSha256='unverified']){
  const changed=structuredClone(f.manifest);mutate(changed);assert.throws(()=>validateIntake(changed),{code:'INTAKE_INVALID'});
 }
 await assert.rejects(f.service.preview({...f.command,recordId:randomUUID()}),{code:'INTAKE_TARGET'});
 assert.equal((await readFile(path.join(f.source,'capture.bin'))).toString(),'PRIVATE native source');
});
test('a change after validation but before commit rolls the entire application back',async t=>{
 const f=await intakeFixture(t),preview=await f.service.preview(f.command),command={...f.command,expectedPin:preview.pin};
 await f.service.stage(command);await f.worker.runOnce();await f.service.apply(command);
 const job=await f.queue.claim(),prepared=await f.queue.definition(job).prepare(job,{signal:new AbortController().signal,progress:async()=>{}});
 const proposal=await f.service.read(f.manifest.id),content=await f.service.preparedContent(proposal,proposal.prepared[0]),bytes=await readFile(content.file);bytes[bytes.length-1]^=1;await writeFile(content.file,bytes);
 await assert.rejects(f.queue.complete(job.id,job.lease.token,prepared),{code:'INTAKE_CHANGED'});
 assert.equal(await new ResearchMaterials(f.ws).current(f.manifest.files[0].id),null);assert.equal((await f.service.status(command)).receipt,null);
});
test('cancellation, process restart and analysis amendments preserve identities and exact sources',async t=>{
 const f=await intakeFixture(t),preview=await f.service.preview(f.command),command={...f.command,expectedPin:preview.pin};
 await f.service.stage(command);await f.service.control(command,'cancel');assert.equal((await f.service.status(command)).job.state,'cancelled');
 const restarted=workspaceJobs(f.ws);restarted.worker.enabled=true;t.after(()=>restarted.worker.stop());const intake=new LocalIntake(f.ws,restarted.queue);
 await intake.control(command,'retry');await restarted.worker.runOnce();await intake.apply(command);await restarted.worker.runOnce();const first=(await intake.status(command)).receipt;
 f.manifest.id=randomUUID();f.manifest.purpose='amendment';f.manifest.files=[];f.manifest.analyses[0].expectedRevision=first.analyses[0].revision;f.manifest.analyses[0].inputs=[first.files[0]];f.manifest.analyses[0].version='2.0';await f.write();
 const next={...f.command,id:f.manifest.id},p=await intake.preview(next);next.expectedPin=p.pin;await intake.stage(next);await restarted.worker.runOnce();await intake.apply(next);await restarted.worker.runOnce();
 const last=(await intake.status(next)).receipt,materials=new ResearchMaterials(f.ws);assert.ok(last,JSON.stringify(await intake.status(next)));
 assert.equal(last.analyses[0].id,first.analyses[0].id);assert.notEqual(last.analyses[0].revision,first.analyses[0].revision);assert.equal((await materials.read(first.analyses[0])).content.version,'1.0');assert.equal((await materials.read(last.analyses[0])).previous,first.analyses[0].revision);
});
test('readiness receipts remain private and optional project policy is enforced by ordinary record saves',async t=>{
 const f=await intakeFixture(t),ready=new RunReadiness(f.ws),command=f.command;
 let view=await ready.view(command);assert.equal(view.counts.artifacts,0);assert.deepEqual(view.policy.required,[]);
 await ready.setPolicy({...command,expectedPolicy:view.policy.etag,required:['validation']});
 const records=new ResearchRecords(f.ws,{}),save=record=>records.save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(f.record),record}]},{receipt:true});
 await assert.rejects(save({...f.record,status:'completed'}),{code:'INTAKE_COMPLETION'});
 const p=await f.service.preview(command),c={...command,expectedPin:p.pin};await f.service.stage(c);await f.worker.runOnce();await f.service.apply(c);await f.worker.runOnce();
 view=await ready.view(command);assert.equal(view.counts.artifacts,1);assert.equal(view.receipts.length,1);assert.deepEqual(view.missing,[]);
 await save({...f.record,status:'completed'});view=await ready.view(command);assert.ok(view.receipts[0].current);assert.deepEqual(view.missing,[]);
 const current=(await f.ws.read()).book.entries.find(r=>r.id===f.record.id);
 await assert.rejects(records.save({workspaceId:f.book.id,changes:[{id:current.id,expectedRevision:recordRevision(current),record:{...current,body:'New work still marked complete'}}]},{receipt:true}),{code:'INTAKE_COMPLETION'});
 await records.save({workspaceId:f.book.id,changes:[{id:current.id,expectedRevision:recordRevision(current),record:{...current,body:'New work saved as a draft',status:'draft'}}]},{receipt:true});
 assert.deepEqual((await ready.view(command)).missing,['validation']);
});
test('watching only notifies and never stages or executes acquired files',async t=>{
 const f=await intakeFixture(t),notices=[];
 await watchIntake(f.directory,source=>f.service.preview({...f.command,source}),{once:true,onNotice:n=>notices.push(n)});
 assert.ok(notices.some(n=>n.ok&&n.proposal.id===f.manifest.id));assert.equal(await f.service.read(f.manifest.id,{optional:true}),null);assert.equal(await f.queue.hasActive(),false);
});


test('prepared intake applies after the external source folder is unavailable',async t=>{
 const f=await intakeFixture(t),preview=await f.service.preview(f.command),command={...f.command,expectedPin:preview.pin};await f.service.stage(command);await f.worker.runOnce();assert.equal((await f.service.status(command)).state,'prepared');
 const source=path.resolve(f.source);assert.equal(path.dirname(source),path.resolve(f.directory));await rename(source,source+' unavailable');
 await f.service.apply(command);await f.worker.runOnce();const result=await f.service.status(command);assert.equal(result.state,'completed',JSON.stringify(result));
 assert.equal((await contentBuffer((await new ResearchMaterials(f.ws).artifact(result.receipt.files[0])).content)).toString(),'PRIVATE native source');assert.deepEqual((await f.service.apply(command)).receipt,result.receipt);
});

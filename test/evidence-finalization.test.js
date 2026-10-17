import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {EvidenceCorrections} from '../src/evidence-corrections.js';
import {EvidenceIntakeFinalization} from '../src/evidence-intake-finalization.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {fileFingerprint} from '../src/web/evidence-fingerprint.js';
import {digest} from '../src/storage.js';

async function fixture(t){
 const temporary=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(temporary,'observanda-evidence-finalize-'));
 const value=await encryptedFixture(directory,sampleNotebook()),materials=new ResearchMaterials(value.workspace),jobs=workspaceJobs(value.workspace),book=(await value.workspace.read()).book;
 t.after(async()=>{await jobs.worker.stop();clearVault(value.vault);assert.equal(path.dirname(directory),temporary);assert.ok(path.basename(directory).startsWith('observanda-evidence-finalize-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 return {...value,...jobs,materials,book};
}
async function listed(materials,recordId){
 const items=[];let cursor=null,pages=0;
 do{const page=await materials.index.page({recordId,kind:'artifact',limit:7,cursor});assert.ok(page.items.length>0||page.next===null,'Published discovery must not require empty staging pages');assert.ok(page.scanned<=200);items.push(...page.items);cursor=page.next;assert.ok(++pages<30);}while(cursor);
 assert.equal(new Set(items.map(item=>item.id)).size,items.length);return items;
}
async function correct(materials,reference,action,metadata=null){
 const corrections=new EvidenceCorrections(materials),source=await materials.read(reference),command={recordId:source.recordId,ref:reference,action,reason:'Synthetic acquisition review',metadata,replacementRecordId:null},preview=await corrections.preview(command);
 return corrections.apply({command,review:preview.review});
}

test('file-set staging checkpoints stay private, resume exactly and publish pageable corrected evidence', {timeout:120000},async t=>{
 const f=await fixture(t),m=f.materials,recordId=f.book.entries[0].id,other=f.book.entries[1];
 const baseline=await m.startImport({recordId,name:'existing.bin',size:1});await m.appendImport(baseline.id,0,[Buffer.from([9])]);const existing=await m.finishImport(baseline.id);
 const fingerprint=await fileFingerprint(0,[],digest),files=Array.from({length:65},(_,i)=>({name:'capture-'+i+'.bin',size:0,fingerprint}));
 const batch=await m.intakes.start({recordId,title:'Checkpointed acquisition',count:files.length,bytes:0});
 await m.intakes.append({id:batch.id,offset:0,items:files.slice(0,64)});await m.intakes.append({id:batch.id,offset:64,items:files.slice(64)});
 await m.intakes.enqueue(batch.id,f.queue);let job=await f.queue.claim();assert.equal(job.id,batch.id);
 const initialGeneration=(await m.index.state()).generation,pause=new Error('Synthetic interruption after a durable checkpoint');let prefix;
 const write=operation=>f.queue.transaction(async()=>{await f.queue.held(job.id,job.lease.token);return operation();});
 await assert.rejects(m.intakes.prepare(job,{progress:async progress=>{
  if(progress.stage!=='Attaching verified files')return;
  assert.equal(progress.done,32);const staged=await m.intakes.read(batch.id);assert.equal(staged.finalization.count,32);
  prefix=(await m.sequences.page(staged.finalization.inputsIndex,{limit:32})).items;
  assert.equal(await m.current(prefix[0].id),null);
  await assert.rejects(m.read(prefix[0]),{code:'MATERIAL_INCOMPLETE'});await assert.rejects(m.index.inputSet(prefix[0]),{code:'MATERIAL_INCOMPLETE'});
  assert.equal((await m.importState(prefix[0].id)).completed,null);assert.equal((await m.importState(prefix[0].id,{raw:true})).completed,null);
  assert.deepEqual((await listed(m,recordId)).map(item=>item.id),[existing.id]);assert.equal((await m.index.state()).generation,initialGeneration);
  const record={...other,title:'Foreground authoring between intake checkpoints'};
  await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:other.id,expectedRevision:recordRevision(other),record}]},{compact:true});
  assert.equal((await f.workspace.read()).book.entries.find(item=>item.id===other.id).title,record.title);
  throw pause;
 }},write),error=>error===pause);
 await f.queue.release(job.id,job.lease.token,{paused:true});const oldLease=job.lease.token;
 await m.verify();
 job=await f.queue.claim();assert.notEqual(job.lease.token,oldLease);
 await assert.rejects(f.queue.transaction(()=>f.queue.held(job.id,oldLease)),{code:'JOB_LEASE'});
 const stage=m.stageImport.bind(m),resumed=[];t.mock.method(m,'stageImport',async(id,...args)=>{resumed.push(id);return stage(id,...args);});
 const prepared=await m.intakes.prepare(job,{progress:async progress=>{if(progress.stage==='Attaching verified files')await f.queue.pulse(job.id,job.lease.token,progress);}},write);
 assert.equal(resumed.length,33);assert.equal(resumed.some(id=>prefix.some(ref=>ref.id===id)),false);
 const staged=await m.intakes.read(batch.id),refs=(await m.sequences.page(staged.finalization.inputsIndex,{limit:65})).items;
 assert.equal(staged.finalization.count,65);assert.deepEqual(refs.slice(0,32),prefix);
 assert.deepEqual((await listed(m,recordId)).map(item=>item.id),[existing.id]);assert.equal(await m.current(refs.at(-1).id),null);
 const completed=await f.queue.complete(job.id,job.lease.token,prepared);assert.equal(completed.state,'completed');assert.equal(completed.result.id,batch.id);
 const published=await listed(m,recordId);assert.equal(published.length,66);assert.deepEqual(new Set(published.map(item=>item.id)),new Set([existing.id,...refs.map(ref=>ref.id)]));
 assert.deepEqual((await m.importState(refs[0].id)).completed,refs[0]);assert.equal((await m.importState(refs[0].id,{raw:true})).completed,null);
 const original=await m.read(refs[0]),edited=await correct(m,refs[0],'metadata',{title:'Reviewed capture',provenance:'Reviewed acquisition metadata',sourcePath:'',sourcePurpose:''});
 assert.equal(edited.after.stagedBatch,batch.id);assert.deepEqual(await m.read(refs[0]),original);
 assert.equal((await listed(m,recordId)).find(item=>item.id===refs[0].id).title,'Reviewed capture');
 const corrected={kind:edited.after.kind,id:edited.after.id,revision:edited.after.revision};
 await correct(m,corrected,'retire');assert.equal((await listed(m,recordId)).length,65);assert.equal(await m.current(corrected.id),null);assert.equal((await m.read(corrected)).title,'Reviewed capture');
 await m.verify();
 await correct(m,corrected,'restore');assert.equal((await listed(m,recordId)).length,66);assert.equal((await m.current(corrected.id)).stagedBatch,batch.id);
 await m.verify();
 const descriptor=await m.index.segments.read(batch.id),feed=m.index.segments.feed(recordId,'artifact'),file=feed.order+'/'+feed.key({id:descriptor.id,createdAt:descriptor.createdAt}),pointer=await f.workspace.readMetadata(file,8192);
 await f.workspace.withLock(()=>f.workspace.removeMetadata(file));await assert.rejects(m.index.verify({initialize:false}),{code:'CATALOGUE_DAMAGED'});
 await f.workspace.withLock(()=>f.workspace.writeMetadata(file,pointer));await m.index.verify({initialize:false});
 t.diagnostic(JSON.stringify({files:65,firstCheckpoint:32,resumedArtifacts:resumed.length,publishedArtifacts:66,foregroundRecordSaved:true}));
});


test('completed intake cleanup releases queued writes before the direct completion returns', {timeout:60000},async t=>{
 const f=await fixture(t),m=f.materials,recordId=f.book.entries[0].id,fingerprint=await fileFingerprint(0,[],digest);
 const batch=await m.intakes.start({recordId,title:'Post-commit cleanup boundary',count:2,bytes:0});
 await m.intakes.append({id:batch.id,offset:0,items:[{name:'first.bin',size:0,fingerprint},{name:'second.bin',size:0,fingerprint}]});
 await m.intakes.enqueue(batch.id,f.queue);const job=await f.queue.claim();
 const prepared=await f.queue.definition(job).prepare(job,{}),observed=[];
 t.mock.method(f.queue,'observe',value=>observed.push(value));
 let entered,release,settled=false;const started=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve);
 const cleanup=EvidenceIntakeFinalization.prototype.cleanup;
 t.mock.method(EvidenceIntakeFinalization.prototype,'cleanup',async function(id){if(id===batch.id){entered();await held;}return cleanup.call(this,id);});
 const completion=f.queue.complete(job.id,job.lease.token,prepared).then(value=>{settled=true;return value;});
 try{
  await Promise.race([started,completion.then(()=>assert.fail('Completion must enter its cleanup hook'))]);
  assert.equal(settled,false,'Direct completion still awaits physical cleanup');
  assert.equal(observed.filter(value=>value.id===batch.id&&value.state==='completed').length,1,'Committed completion is announced before cleanup');
  assert.equal(await f.queue.transaction(()=>42),42,'Cleanup must not occupy the serialized job writer');
  assert.equal((await f.queue.control(batch.id,'cancel')).state,'completed');
  const items=m.sequences.items;t.mock.method(m.sequences,'items',()=>{throw Error('A frozen enqueue replay must not scan files');});
  assert.equal((await m.intakes.enqueue(batch.id,f.queue)).state,'completed');
  m.sequences.items=items;
  assert.equal(settled,false);
 }finally{release();}
 assert.equal((await completion).state,'completed');assert.equal(settled,true);
 assert.equal((await m.intakes.read(batch.id)).state,'completed');
});

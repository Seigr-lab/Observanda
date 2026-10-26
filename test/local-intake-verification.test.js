import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {intakeFixture,hash} from './fixtures/local-intake.js';
import {LocalIntake} from '../src/intake/service.js';
import {workspaceJobs} from '../src/workspace-jobs.js';

test('source validation checkpoints survive restart before staging and retained originals are reused on retry',{timeout:180000},async t=>{
 const f=await intakeFixture(t),size=128*1024;f.queue.leaseMs=120000;f.manifest.files=[];f.manifest.analyses=[];
 for(let i=0;i<34;i++){const bytes=Buffer.alloc(size,i),file={id:randomUUID(),path:'capture-'+i+'.bin',size,sha256:hash(bytes),provenance:'Synthetic restart verification'};f.manifest.files.push(file);await writeFile(path.join(f.source,file.path),bytes);}
 await f.write();const preview=await f.service.preview(f.command),command={...f.command,expectedPin:preview.pin};await f.service.stage(command);
 let proposal=await f.service.read(f.manifest.id);assert.equal(proposal.sourceVerification.files.length,34);
 // A proposal created by an earlier release has no validation checkpoint.
 delete proposal.sourceVerification;await f.queue.transaction(()=>f.service.write(proposal));
 const writes=[],write=LocalIntake.prototype.write;
 t.mock.method(LocalIntake.prototype,'write',async function(value){if(value.id===f.manifest.id&&!value.prepared.length&&value.sourceVerification)writes.push({files:value.sourceVerification.files.length,bytes:Buffer.byteLength(JSON.stringify(value))});return write.call(this,value);});
 let job=await f.queue.claim();
 await assert.rejects(f.queue.definition(job).prepare(job,{signal:t.signal,progress:async p=>{if(p.stage==='validating'&&p.done>32*size)throw Error('Interrupted validation');}}),/Interrupted validation/);
 await f.queue.release(job.id,job.lease.token,{error:Error('Interrupted validation')});proposal=await f.service.read(f.manifest.id);
 assert.equal(proposal.sourceVerification.files.length,32);assert.equal(proposal.prepared.length,0);assert.deepEqual(writes.map(value=>value.files),[32]);
 const restarted=workspaceJobs(f.ws,undefined,{leaseMs:120000}),service=new LocalIntake(f.ws,restarted.queue);t.after(()=>restarted.worker.stop());
 await service.control(command,'retry');job=await restarted.queue.claim();let validations=0;
 await assert.rejects(restarted.queue.definition(job).prepare(job,{signal:t.signal,progress:async p=>{if(p.stage==='validating')validations++;if(p.stage==='staging'&&p.done>size)throw Error('Interrupted staging');}}),/Interrupted staging/);
 await restarted.queue.release(job.id,job.lease.token,{error:Error('Interrupted staging')});proposal=await service.read(f.manifest.id);
 assert.equal(validations,36,'32 checked identities plus four 64 KiB hash reads for the remaining two files');assert.equal(proposal.sourceVerification.files.length,34);assert.equal(proposal.prepared.length,1);
 const retained=proposal.prepared[0];assert.deepEqual(writes.map(value=>value.files),[32,34]);
 const next=workspaceJobs(f.ws,undefined,{leaseMs:120000}),resumed=new LocalIntake(f.ws,next.queue);next.worker.enabled=true;t.after(()=>next.worker.stop());
 await resumed.control(command,'retry');await next.worker.runOnce();proposal=await resumed.read(f.manifest.id);
 assert.equal(proposal.state,'prepared',JSON.stringify(await resumed.status(command)));assert.equal(proposal.prepared.length,34);assert.deepEqual(proposal.prepared[0],retained);
 await (await resumed.preparedContent(proposal,retained)).verify({signal:t.signal});assert.deepEqual(writes.map(value=>value.files),[32,34]);
 t.diagnostic(JSON.stringify({sourceFiles:34,sourceBytes:34*size,validationCheckpointWrites:writes.length,validationCheckpointSerializedBytes:writes.reduce((sum,value)=>sum+value.bytes,0),resumedValidationReadBytes:2*size,reusedValidationBytes:32*size,retainedOriginalsReused:1}));
});

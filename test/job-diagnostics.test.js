import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {withJobDiagnosticContext,jobFailureDiagnostic} from '../src/job-diagnostics.js';
import {DurableJobs,JobWorker,jobSummary} from '../src/jobs.js';
import {AppError} from '../src/errors.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {Workspace} from '../src/storage.js';
import {clearVault} from '../src/encryption.js';

test('private diagnostic causes are bounded, redact credential forms and keep the innermost operation',async()=>{
 const recordId=randomUUID(),job={id:randomUUID(),type:'publication.prepare',attempt:2,updatedAt:new Date().toISOString(),progress:{stage:'capturing-selected-edition'}};
 const cause=new Error('password=do-not-retain\nhttps://user:secret@example.test/private');cause.code='25006';
 const error=new Error('token=also-private\nRetained figure admission failed',{cause});error.stack+='\n'+('x'.repeat(100000));
 try{await withJobDiagnosticContext({operation:'capture-record',recordId,secret:'not-allowed'},()=>withJobDiagnosticContext({operation:'capture-retained-figures'},()=>{throw error;}));}catch(found){assert.equal(found,error);}
 const diagnostic=jobFailureDiagnostic(job,error),raw=JSON.stringify(diagnostic);
 assert.deepEqual(diagnostic.context,{operation:'capture-retained-figures',recordId});assert.equal(diagnostic.causes[1].code,'25006');
 assert.ok(raw.length<12000);assert.doesNotMatch(raw,/do-not-retain|user:secret|also-private|not-allowed/);
 const hostile=new Error('readable');Object.defineProperty(hostile,'cause',{get(){throw Error('Accessor');}});assert.equal(jobFailureDiagnostic(job,hostile).causes.length,1);
 const unicode=new Error('\u0000'.repeat(10000));unicode.stack='\u0000'.repeat(10000);unicode.path='\u0000'.repeat(10000);unicode.cause=unicode;assert.ok(Buffer.byteLength(JSON.stringify(jobFailureDiagnostic(job,unicode)))<65536);
});

test('worker failure diagnostics survive reopening and successful retry without entering status or changing research',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-private-diagnostic-')),f=await encryptedFixture(directory,sampleNotebook()),before=await f.workspace.read(),recordId=before.book.entries[0].id;
 let fail=true,authorized=true;
 const definitions={'test.capture':{authorize:async()=>{if(!authorized)throw new AppError('ACCESS_LOCKED');},prepare:()=>withJobDiagnosticContext({operation:'capture-retained-figures',recordId},()=>{if(fail){const error=new Error('Synthetic private location');error.code='25006';throw error;}return {captured:true};}),commit:async(_job,value)=>value}};
 const queue=new DurableJobs(f.workspace,definitions),worker=new JobWorker(queue),observations=[];queue.observe=value=>observations.push(value);
 t.after(async()=>{await worker.stop();clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const job=await queue.enqueue({id:randomUUID(),type:'test.capture',scope:before.book.id,input:{}});worker.enabled=true;await worker.runOnce();worker.enabled=false;
 const failed=await queue.read(job.id);assert.equal(failed.state,'failed');assert.equal(failed.error,'IO');assert.equal(failed.diagnostic.attempt,1);
 const reopened=new DurableJobs(new Workspace(f.workspace.root,f.vault),definitions),diagnostic=await reopened.diagnostic(job.id);
 assert.equal(diagnostic.context.recordId,recordId);assert.equal(diagnostic.context.operation,'capture-retained-figures');assert.equal(diagnostic.causes[0].code,'25006');assert.match(diagnostic.causes[0].stack,/Synthetic private location/);
 assert.doesNotMatch(JSON.stringify([jobSummary(failed),observations]),/Synthetic private location|25006|causes|stack/);
 authorized=false;await assert.rejects(reopened.diagnostic(job.id),{code:'ACCESS_LOCKED'});authorized=true;
 await assert.rejects(reopened.diagnostic(job.id,{attempt:2}),{code:'INVALID'});
 // A rolled-back failure cannot leave a diagnostic that claims it committed.
 await queue.control(job.id,'retry');const claimed=await queue.claim();await assert.rejects(f.workspace.withLock(async()=>{await queue.retainFailure({...claimed,updatedAt:new Date().toISOString()},new Error('Rolled back'));throw Error('rollback');}),/rollback/);
 assert.equal(await queue.diagnostic(job.id,{attempt:2}),null);
 await queue.release(job.id,claimed.lease.token,{paused:true});fail=false;worker.enabled=true;await worker.runOnce();worker.enabled=false;
 const done=await queue.read(job.id);assert.equal(done.state,'completed');assert.deepEqual(done.result,{captured:true});assert.deepEqual(await queue.diagnostic(job.id,{attempt:1}),diagnostic);
 assert.equal((await f.workspace.read()).etag,before.etag);
});

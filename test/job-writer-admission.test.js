import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {createNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {DurableJobs,JobWorker} from '../src/jobs.js';
import {AppError} from '../src/errors.js';

for(const mode of ['output','progress','completion','stop','expired','callback-failure'])test('background job writer admission behind a foreground writer: '+mode,{timeout:60000},async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-job-admission-')),book=createNotebook('Writer admission'),f=await encryptedFixture(directory,book);
 const prepared=Promise.withResolvers(),begin=Promise.withResolvers(),contended=Promise.withResolvers(),rejected=Promise.withResolvers();
 let callbacks=0,cleanups=0,settled=false,expired=false,failure,contender;
 const queue=new DurableJobs(f.workspace,{'test.prepare':{
  authorize:async()=>{},
  prepare:async(_job,{write,progress})=>{
   prepared.resolve();await begin.promise;
   try{if(mode==='progress')await progress({stage:'Preparing',done:1,total:2});else if(mode!=='completion')await write(()=>{callbacks++;if(mode==='callback-failure')throw new AppError('LOCKED');});return {ready:true};}
   catch(error){failure=error;rejected.resolve();throw error;}
  },
  commit:async(_job,value)=>{assert.deepEqual(value,{ready:true});return {ready:true};},
  afterComplete:async()=>f.workspace.withLock(()=>{cleanups++;})
 }}),worker=new JobWorker(queue),now=queue.now,open=f.workspace.openCatalogue;
 t.after(async()=>{begin.resolve();await contender?.close();await worker.stop();clearVault(f.vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-job-admission-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 t.mock.method(queue,'now',async()=>await now.call(queue)+(expired?2*queue.leaseMs:0));
 t.mock.method(f.workspace,'openCatalogue',async function(...args){const db=await open.apply(this,args),lock=db.lock;db.lock=async function(){try{return await lock.call(this);}catch(error){if(error.code==='LOCKED')contended.resolve();throw error;}};return db;});
 const job=await queue.enqueue({id:randomUUID(),type:'test.prepare',scope:book.id,input:{}});
 worker.enabled=true;worker.running=worker.runOnce().finally(()=>{settled=true;});await prepared.promise;
 contender=await f.workspace.openCatalogue();await contender.run('BEGIN');await contender.lock();begin.resolve();await contended.promise;
 if(mode==='stop'){
  const stopping=worker.stop();await rejected.promise;assert.equal(callbacks,0);assert.equal(settled,false,'Stop must drain release/cleanup');
  await contender.run('ROLLBACK');await stopping;
 }else if(mode==='expired'){
  expired=true;await rejected.promise;assert.equal(failure.code,'JOB_LEASE');assert.equal(callbacks,0);
  await contender.run('ROLLBACK');await worker.running;
 }else{
  await delay(450);assert.equal(settled,false,'Ordinary contention exhausted the short retry budget');assert.equal(callbacks,0);
  await contender.run('ROLLBACK');await worker.running;
 }
 const done=await queue.read(job.id);
 assert.equal(done.state,mode==='stop'?'queued':['expired','callback-failure'].includes(mode)?'failed':'completed');
 if(mode==='expired')assert.equal(done.error,'JOB_LEASE');
 if(mode==='callback-failure')assert.equal(done.error,'LOCKED');
 assert.equal(callbacks,['output','callback-failure'].includes(mode)?1:0,'Acquisition waiting must not replay an entered callback');assert.equal(cleanups,['output','progress','completion'].includes(mode)?1:0,'Completion cleanup must not require the cleared running lease');
});

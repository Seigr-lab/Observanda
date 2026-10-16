import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {DurableJobs,jobSummary} from '../src/jobs.js';
import {jobFingerprint} from '../src/job-relocations.js';
const definitions={'analysis.compare':{authorize:async()=>{},commit:async()=>({done:true})}};
const intent=f=>({id:randomUUID(),type:'analysis.compare',scope:f.book.entries[0].id,input:{command:{recordId:f.book.entries[0].id}}});
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-job-relocations-')),book=sampleNotebook(),f=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(f.vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-job-relocations-'));await rm(directory,{recursive:true,force:true});});
 return {...f,book,plan:{id:randomUUID(),projectId:book.projects[0].id,namespaceId:randomUUID()}};
}

test('job relocation is atomic, survives reopening and refuses every stale source mutation',async t=>{
 const f=await fixture(t),queue=new DurableJobs(f.workspace,definitions),request=intent(f);await queue.enqueue(request);const job=await queue.claim(),other=intent(f);await queue.enqueue(other);
 const events=[];queue.observe=value=>events.push(value);
 const receipt={version:1,operationId:f.plan.id,projectId:f.plan.projectId,namespaceId:f.plan.namespaceId,sourceRevision:jobFingerprint(job)},raw=await f.workspace.readMetadata(queue.file(job.id));
 await assert.rejects(queue.relocations.fence(queue,job.id,receipt),{code:'INVALID'});
 await assert.rejects(queue.transaction(async()=>{await queue.relocations.fence(queue,job.id,receipt);throw Error('Lost transaction');}),/Lost transaction/);
 assert.equal((await queue.read(job.id)).state,'running');assert.equal((await queue.status()).active,2);assert.equal(events.length,0);
 await queue.transaction(()=>queue.relocations.fence(queue,job.id,receipt));assert.equal(events.length,1);assert.equal(events[0].state,'relocated');assert.equal(Object.hasOwn(events[0],'relocation'),false);
 const reopened=new DurableJobs(f.workspace,definitions);assert.equal((await reopened.status()).active,1);assert.equal((await reopened.read(job.id)).state,'relocated');assert.match(jobSummary(await reopened.read(job.id)).message,/new location/);assert.equal(await f.workspace.readMetadata(queue.file(job.id)),raw);
 await reopened.transaction(()=>reopened.relocations.fence(reopened,job.id,receipt));
 let committed=false;reopened.definitions={'analysis.compare':{authorize:async()=>{},commit:async()=>{committed=true;}}};
 for(const operation of [()=>reopened.pulse(job.id,job.lease.token),()=>reopened.complete(job.id,job.lease.token,{}),()=>reopened.release(job.id,job.lease.token,{paused:true}),()=>reopened.control(job.id,'retry'),()=>reopened.control(job.id,'cancel'),()=>reopened.enqueue(request)])await assert.rejects(operation(),{code:'JOB_RELOCATED'});
 assert.equal(committed,false);assert.equal((await reopened.claim()).id,other.id);
 await assert.rejects(reopened.transaction(()=>reopened.relocations.fence(reopened,job.id,{...receipt,operationId:randomUUID()})),{code:'CONFLICT'});
});

test('a source read remains consistent when another transaction fences a newer job revision',async t=>{
 const f=await fixture(t),queue=new DurableJobs(f.workspace,definitions),request=intent(f);await queue.enqueue(request);const running=await queue.claim(),original=f.workspace.readMetadata.bind(f.workspace);let changed=false;
 t.mock.method(f.workspace,'readMetadata',async(name,...args)=>{
  const raw=await original(name,...args);
  if(name===queue.file(running.id)&&!changed){changed=true;const latest=await queue.pulse(running.id,running.lease.token,{stage:'Later source work',done:1,total:2});
   const receipt={version:1,operationId:f.plan.id,projectId:f.plan.projectId,namespaceId:f.plan.namespaceId,sourceRevision:jobFingerprint(latest)};
   await queue.transaction(()=>queue.relocations.fence(queue,running.id,receipt));
  }
  return raw;
 });
 const held=await queue.read(running.id);assert.equal(held.state,'running');assert.equal(held.progress.stage,'preparing');
 const next=await queue.read(running.id);assert.equal(next.state,'relocated');assert.equal(next.progress.stage,'Later source work');assert.equal((await queue.status()).active,0);
});

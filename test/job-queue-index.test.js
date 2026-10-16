import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {DurableJobs} from '../src/jobs.js';
import {Workspace} from '../src/storage.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {AppError} from '../src/errors.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-queue-growth-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),scope=book.entries[0].id;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const definition={authorize:async job=>assert.equal(job.scope,scope),commit:async job=>({id:job.id})},definitions={work:definition,'publication.deploy':definition};
 let clock=Date.now();const create=workspace=>{const queue=new DurableJobs(workspace,definitions);queue.now=async()=>clock;return queue;};
 return {...f,directory,scope,queue:create(f.workspace),create,advance:ms=>{clock+=ms;},intent:(type='work')=>({id:randomUUID(),scope,type,input:{}})};
}

test('accepted work grows beyond 512 and lease lookup stays bounded after a thousand running jobs',async t=>{
 const f=await fixture(t),intents=Array.from({length:1025},(_,i)=>f.intent(i===1024?'publication.deploy':'work')),began=performance.now();
 for(const intent of intents)await f.queue.enqueue(intent);
 assert.deepEqual(await f.queue.status(),{active:1025});assert.equal(await f.queue.hasActive(['publication.deploy']),true);assert.equal(await f.queue.hasActive(['other']),false);
 assert.ok((await f.workspace.readMetadata('.observanda/jobs/queue.json')).length<128);
 const first=await f.queue.claim();assert.equal(first.id,intents[0].id);
 for(let i=1;i<1024;i++)assert.equal((await f.queue.claim()).id,intents[i].id);
 let jobReads=0,pages=0;const read=f.queue.read.bind(f.queue),page=f.workspace.metadataPage.bind(f.workspace);
 f.queue.read=async(...args)=>{jobReads++;return read(...args);};f.workspace.metadataPage=async(...args)=>{pages++;return page(...args);};
 const last=await f.queue.claim();assert.equal(last.id,intents.at(-1).id);assert.equal(jobReads,1);assert.ok(pages<=4);
 jobReads=0;pages=0;let writerCalls=0;const writer=f.workspace.withLock.bind(f.workspace);f.workspace.withLock=async(...args)=>{writerCalls++;return writer(...args);};
 assert.equal(await f.queue.claim(),null);assert.equal(writerCalls,0);assert.equal(jobReads,0);assert.ok(pages<=2);
 f.workspace.withLock=writer;f.workspace.metadataPage=page;f.queue.read=read;
 // Removing/retrying a late item is direct, and accepted work survives a
 // refused later enqueue rather than being reconstructed from a partial list.
 await f.queue.control(last.id,'cancel');await f.queue.release(last.id,last.lease.token);assert.equal(await f.queue.hasActive(['publication.deploy']),false);
 await f.queue.control(last.id,'retry');assert.equal(await f.queue.hasActive(['publication.deploy']),true);assert.equal((await f.queue.claim()).id,last.id);
 const failed=f.intent(),write=f.workspace.writeMetadata.bind(f.workspace);
 f.workspace.writeMetadata=async(name,...args)=>{if(name==='.observanda/jobs/queue.json')throw new AppError('STORAGE_FULL');return write(name,...args);};
 await assert.rejects(f.queue.enqueue(failed),{code:'STORAGE_FULL'});f.workspace.writeMetadata=write;
 assert.equal(await f.queue.read(failed.id),null);assert.deepEqual(await f.queue.status(),{active:1025});
 const copied=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'backup')),{vault:f.vault}),restored=f.create(new Workspace(copied,f.vault));
 assert.deepEqual(await restored.status(),{active:1025});assert.equal(await restored.hasActive(['publication.deploy']),true);assert.equal(await restored.claim(),null);
 f.advance(30001);const reclaimed=await restored.claim();assert.equal(reclaimed.id,first.id);assert.equal(reclaimed.attempt,2);assert.notEqual(reclaimed.lease.token,first.lease.token);
 await assert.rejects(restored.complete(first.id,first.lease.token,{}),{code:'JOB_LEASE'});
 assert.equal((await restored.complete(reclaimed.id,reclaimed.lease.token,{})).state,'completed');assert.deepEqual(await restored.status(),{active:1024});
 assert.equal((await restored.enqueue(intents[0])).state,'completed');assert.deepEqual(await restored.status(),{active:1024});
 t.diagnostic(JSON.stringify({accepted:intents.length,totalMs:Math.round(performance.now()-began),lateClaimJobReads:1,lateClaimIndexPagesAtMost:4}));
});

test('legacy queues upgrade with their first mutation and roll back an interrupted index build',async t=>{
 const f=await fixture(t),one=f.intent(),two=f.intent('publication.deploy'),now=new Date().toISOString();
 const job=intent=>({format:1,...intent,state:'queued',attempt:0,lease:null,cancelRequested:false,progress:{stage:'queued',done:0,total:0},result:null,error:null,createdAt:now,updatedAt:now});
 await f.workspace.withLock(async()=>{for(const intent of [one,two])await f.workspace.writeMetadata(f.queue.file(intent.id),JSON.stringify(job(intent)));await f.workspace.writeMetadata('.observanda/jobs/queue.json',JSON.stringify([one.id,two.id]));});
 assert.equal(await f.queue.hasActive(['publication.deploy']),true);const write=f.workspace.writeMetadata.bind(f.workspace);let interrupted=false;
 f.workspace.writeMetadata=async(name,...args)=>{if(!interrupted&&name.startsWith('.observanda/jobs/pending/')){interrupted=true;throw new AppError('STORAGE_FULL');}return write(name,...args);};
 await assert.rejects(f.queue.claim(),{code:'STORAGE_FULL'});f.workspace.writeMetadata=write;
 assert.deepEqual(JSON.parse(await f.workspace.readMetadata('.observanda/jobs/queue.json')),[one.id,two.id]);assert.equal((await f.queue.read(one.id)).state,'queued');
 const leased=await f.queue.claim();assert.equal(leased.id,one.id);assert.equal(JSON.parse(await f.workspace.readMetadata('.observanda/jobs/queue.json')).format,2);
 assert.equal((await f.queue.claim()).id,two.id);assert.equal(await f.queue.claim(),null);
 const fresh=f.create(new Workspace(f.workspace.root,f.vault));await fresh.pulse(leased.id,leased.lease.token,{stage:'Working',done:1,total:2});
 await fresh.control(one.id,'cancel');await fresh.release(one.id,leased.lease.token);assert.deepEqual(await fresh.status(),{active:1});
});

test('indexed queue rejects a malformed header and a detached scheduling pointer without losing accepted work',async t=>{
 const f=await fixture(t),intent=f.intent();await f.queue.enqueue(intent);const member=await f.queue.membership.member(intent.id);
 const head=await f.workspace.readMetadata('.observanda/jobs/queue.json');await f.workspace.withLock(()=>f.workspace.writeMetadata('.observanda/jobs/queue.json','null'));
 await assert.rejects(f.queue.hasActive(),{code:'JOB_DAMAGED'});await f.workspace.withLock(()=>f.workspace.writeMetadata('.observanda/jobs/queue.json',head));
 await f.workspace.withLock(()=>f.workspace.writeMetadata(f.queue.membership.memberFile(intent.id),JSON.stringify({...member,ticket:member.ticket+1})));
 await assert.rejects(f.queue.claim(),{code:'JOB_DAMAGED'});assert.equal((await f.queue.read(intent.id)).state,'queued');
});

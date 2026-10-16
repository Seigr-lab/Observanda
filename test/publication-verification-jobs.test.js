import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {Publisher,defaultPublishing} from '../src/publishing.js';
import {buildPublication} from '../src/publication.js';
import {digest,serialize} from '../src/storage-format.js';
import {PublicationVerificationJobs} from '../src/publication-verification-jobs.js';
import {recordDeploymentInventory,prepareDeploymentInventory,deploymentInventory,deploymentInventoryPaths} from '../src/publication-live.js';
import {workspaceJobs} from '../src/workspace-jobs.js';

test('live verification resumes after cancellation, rejects stale caches and fences a changed deployment',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-live-jobs-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),candidate=buildPublication(book),config=defaultPublishing();
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});Object.assign(config.github,{owner:'example',repository:'notebook'});config.publicUrl='https://example.test/';
 let mode='stall',entered,cancelled=false;const started=new Promise(resolve=>entered=resolve);
 const request=async url=>{
  const name=new URL(url).pathname.slice(1);
  if(mode==='stall'&&name==='index.html')return new Response(new ReadableStream({start(){entered();},cancel(){cancelled=true;}}));
  if(name==='old.html')return new Response(mode==='cached'?'stale page':null,{status:mode==='cached'?200:404});
  return new Response(candidate.files.get(name));
 };
 const publisher=new Publisher(f.workspace.root,{request},f.vault),saved=await publisher.save(config,'new'),key=publisher.destinationKey(config),receipt={commit:'a'.repeat(40),releaseId:candidate.id,manifestHash:digest(candidate.files.get('publication.json')),deploymentId:randomUUID()};
 const initialInventory=await prepareDeploymentInventory(f.workspace,key,candidate.files.keys(),{removed:['old.html']});
 await f.workspace.withLock(async()=>{await f.workspace.writeMetadata('.observanda/publishing-receipts.json',serialize({[key]:receipt}));await recordDeploymentInventory(f.workspace,key,receipt,initialInventory);});
 let jobs=workspaceJobs(f.workspace,publisher),checks=new PublicationVerificationJobs(f.workspace,publisher,jobs.queue);const initial=await checks.start();assert.equal((await checks.start()).id,initial.id);
 const job=await jobs.queue.claim(),controller=new AbortController(),running=jobs.queue.definition(job).prepare(job,{signal:controller.signal,progress:p=>jobs.queue.pulse(job.id,job.lease.token,p)});running.catch(()=>{});
 await started;await jobs.queue.control(job.id,'cancel');controller.abort(Error('Stopped'));await assert.rejects(running,/Stopped|cancelled/i);await jobs.queue.release(job.id,job.lease.token);assert.equal(cancelled,true);
 // A new worker rereads every file; a previously acknowledged file is not proof
 // that a host or cache still serves it after the interruption.
 jobs=workspaceJobs(f.workspace,publisher);checks=new PublicationVerificationJobs(f.workspace,publisher,jobs.queue);
 const run=async()=>{const next=await jobs.queue.claim();try{const result=await jobs.queue.definition(next).prepare(next,{signal:new AbortController().signal,progress:p=>jobs.queue.pulse(next.id,next.lease.token,p)});return await jobs.queue.complete(next.id,next.lease.token,result);}catch(error){return jobs.queue.release(next.id,next.lease.token,{error});}};
 mode='cached';await jobs.queue.control(initial.id,'retry');assert.equal((await run()).error,'PUBLISH_NOT_LIVE');assert.equal((await publisher.read()).receipt.verification.issue.path,'old.html');
 mode='ready';await jobs.queue.control(initial.id,'retry');assert.equal((await run()).state,'completed');assert.equal((await publisher.read()).receipt.verification.removed,1);
 // Persist retired paths across deployments and a new service instance, but
 // stop treating a path as retired once it is explicitly published again.
 const repeatedInventory=await prepareDeploymentInventory(f.workspace,key,candidate.files.keys());await f.workspace.withLock(()=>recordDeploymentInventory(f.workspace,key,receipt,repeatedInventory));
 assert.deepEqual(await Array.fromAsync(deploymentInventoryPaths(f.workspace,await deploymentInventory(new Publisher(f.workspace.root,{request},f.vault).workspace,key),'removed')),['old.html']);
 const restoredInventory=await prepareDeploymentInventory(f.workspace,key,[...candidate.files.keys(),'old.html']);await f.workspace.withLock(()=>recordDeploymentInventory(f.workspace,key,receipt,restoredInventory));
 assert.deepEqual(await Array.fromAsync(deploymentInventoryPaths(f.workspace,await deploymentInventory(f.workspace,key),'removed')),[]);
 const next=await checks.start({configEtag:saved.etag,commit:receipt.commit});await f.workspace.withLock(()=>f.workspace.writeMetadata('.observanda/publishing-receipts.json',serialize({[key]:{...receipt,commit:'b'.repeat(40)}})));
 assert.equal(await jobs.queue.claim(),null);assert.equal((await jobs.queue.read(next.id)).error,'PUBLISH_STALE');
});

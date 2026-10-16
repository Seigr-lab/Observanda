import {test} from 'node:test';
import fsPromises from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import {Workspace,digest} from '../src/storage.js';
import {clearVault} from '../src/encryption.js';
import {AppError} from '../src/errors.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {initializeLocation,copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {sampleNotebook} from '../src/sample.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {ResearchMaterials,EVIDENCE_CHUNK} from '../src/research-materials.js';
import {contentBuffer} from '../src/file-content.js';
import {jobSummary} from '../src/jobs.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-jobs-')),root=path.join(directory,'workspace');
 const a=await createAccess('','synthetic worker password'),vault=takeCreatedVault(a);await initializeLocation(root,sampleNotebook(),a,vault);
 const workspace=new Workspace(root,vault),materials=new ResearchMaterials(workspace),{queue,worker}=workspaceJobs(workspace),book=(await workspace.read()).book;
 t.after(async()=>{await worker.stop();clearVault(vault);await rm(directory,{recursive:true,force:true});});
 return {directory,root,vault,workspace,materials,queue,worker,recordId:book.entries[0].id};
}
async function uploaded(f,bytes=Buffer.from('Synthetic original'),name='original.bin'){
 const session=await f.materials.startImport({recordId:f.recordId,name,size:bytes.length,provenance:'Private path E:\\private\\original'});
 for(let i=0;i<Math.ceil(bytes.length/EVIDENCE_CHUNK);i++)await f.materials.appendImport(session.id,i,[bytes.subarray(i*EVIDENCE_CHUNK,(i+1)*EVIDENCE_CHUNK)]);
 const input={id:session.id,type:'evidence.finalize',scope:f.recordId,input:{importId:session.id,size:bytes.length}};
 const job=await f.queue.enqueue(input);return {session,job,input,bytes};
}
async function waitFor(fn,predicate,timeout=20000){const end=Date.now()+timeout;let result;do{result=await fn();if(predicate(result))return result;await delay(25);}while(Date.now()<end);assert.fail('Timed out: '+JSON.stringify(result));}
const finished=(q,id)=>waitFor(()=>q.read(id),j=>['completed','failed','cancelled'].includes(j.state));

test('activity observes committed job states and never announces a rolled-back enqueue',async t=>{
 const f=await fixture(t),events=[];f.queue.observe=value=>events.push(value);
 const u=await uploaded(f);assert.equal(events.at(-1).state,'queued');
 await assert.rejects(f.workspace.withLock(async()=>{
  await f.queue.controlLocked(u.job.id,'cancel');throw Error('refused transaction');
 }),/refused transaction/);
 assert.equal(events.length,1);assert.equal((await f.queue.read(u.job.id)).state,'queued');
 await f.queue.control(u.job.id,'cancel');assert.equal(events.at(-1).state,'cancelled');
 assert.ok(events.every(value=>!Object.hasOwn(value,'input')&&!Object.hasOwn(value,'lease')));
});

test('checkpoint writes and worker heartbeats wait for each other without failing the import',async t=>{
 const f=await fixture(t),u=await uploaded(f),job=await f.queue.claim();
 let entered;const ready=new Promise(resolve=>entered=resolve);
 const checkpoint=f.queue.transaction(async()=>{
  await f.queue.held(job.id,job.lease.token);entered();
  await delay(450); // Longer than the retry budget for an unrelated writer.
  await assert.rejects(f.queue.transaction(()=>{}),{code:'LOCKED'});
 });
 await ready;
 const heartbeat=f.queue.pulse(job.id,job.lease.token,{stage:'Verified files',done:1,total:1});
 await Promise.all([checkpoint,heartbeat]);
 assert.equal((await f.queue.read(job.id)).state,'running');
 const prepared=await f.queue.definition(job).prepare(job,{}),done=await f.queue.complete(job.id,job.lease.token,prepared);
 assert.equal(done.state,'completed');assert.deepEqual(await contentBuffer((await f.materials.artifact(done.result)).content),u.bytes);
 await assert.rejects(f.queue.transaction(()=>{throw Error('Synthetic failed write');}),/Synthetic failed write/);
 assert.equal(await f.queue.transaction(()=>42),42,'A failed queued write must release the next operation');
});

test('two workers lease one import; expired workers cannot commit or overwrite the retained original',async t=>{
 const f=await fixture(t),u=await uploaded(f),other=workspaceJobs(new Workspace(f.root,f.vault));
 const claims=await Promise.all([f.queue.claim(),other.queue.claim()]),first=claims.find(Boolean);assert.equal(claims.filter(Boolean).length,1);
 const stale=await f.materials.prepareImport(u.job.id,{storageId:first.lease.token});
 await f.workspace.withLock(async()=>{const job=await f.queue.read(first.id);job.lease.until=0;await f.queue.write(job);});
 const next=await other.queue.claim();assert.equal(next.attempt,2);assert.notEqual(next.lease.token,first.lease.token);
 await assert.rejects(f.queue.complete(first.id,first.lease.token,stale),{code:'JOB_LEASE'});
 const prepared=await other.queue.definition(next).prepare(next,{}),done=await other.queue.complete(next.id,next.lease.token,prepared);
 assert.equal(done.state,'completed');assert.deepEqual(await contentBuffer((await f.materials.artifact(done.result)).content),u.bytes);
 assert.deepEqual((await f.queue.enqueue(u.input)).result,done.result);assert.equal(await f.queue.hasActive(),false);
 const originalFolder=path.join(f.root,'.observanda/materials/originals',next.id);assert.deepEqual(await readdir(originalFolder),[next.lease.token+'.original']);
 const summary=JSON.stringify(jobSummary(done));assert.ok(!summary.includes('lease'));assert.ok(!summary.includes('E:\\private'));assert.ok(!summary.includes('input'));
});

test('manifest and completed job roll back together; retry retains bytes and commits only once',async t=>{
 const f=await fixture(t),u=await uploaded(f),definition=f.queue.definitions['evidence.finalize'],commit=definition.commit;
 definition.commit=async(...args)=>{await commit(...args);throw new AppError('STORAGE_FULL');};
 f.worker.start();const failed=await finished(f.queue,u.job.id);await f.worker.stop();assert.equal(failed.state,'failed');assert.equal(failed.error,'STORAGE_FULL');
 assert.equal((await f.materials.importState(u.job.id)).completed,null);assert.equal((await f.materials.heads()).length,0);
 await access(path.join(f.root,'.observanda/materials/imports',u.job.id,'0.chunk'));
 definition.commit=commit;await f.queue.control(u.job.id,'retry');f.worker.start();const done=await finished(f.queue,u.job.id);await f.worker.stop();
 assert.equal(done.state,'completed');assert.equal(done.attempt,2);assert.equal((await f.materials.heads()).length,1);
 assert.deepEqual(await contentBuffer((await f.materials.artifact(done.result)).content),u.bytes);
 await assert.rejects(access(path.join(f.root,'.observanda/materials/imports',u.job.id,'0.chunk')),{code:'ENOENT'});
});

test('cancellation stops verification, keeps received bytes and supports retry without reupload',async t=>{
 const f=await fixture(t),u=await uploaded(f),definition=f.queue.definitions['evidence.finalize'],prepare=definition.prepare;
 let entered;const ready=new Promise(resolve=>entered=resolve);
 definition.prepare=async(job,options)=>{entered();await delay(30000,null,{signal:options.signal});return prepare(job,options);};
 f.worker.start();await ready;assert.equal((await f.queue.control(u.job.id,'cancel')).cancelRequested,true);f.worker.cancel(u.job.id);
 assert.equal((await finished(f.queue,u.job.id)).state,'cancelled');await f.worker.stop();
 assert.equal((await f.materials.verify()).receivedBytes,u.bytes.length);
 definition.prepare=prepare;await f.queue.control(u.job.id,'retry');f.worker.start();assert.equal((await finished(f.queue,u.job.id)).state,'completed');
});

test('graceful stop queues verification for unlock and retains the encryption key until work has stopped',async t=>{
 const f=await fixture(t),u=await uploaded(f),definition=f.queue.definitions['evidence.finalize'],prepare=definition.prepare;
 let entered;const ready=new Promise(resolve=>entered=resolve);let stoppedWithKey=false;
 definition.prepare=async(job,options)=>{entered();try{await delay(30000,null,{signal:options.signal});}finally{stoppedWithKey=!!f.vault.key;}return prepare(job,options);};
 f.worker.start();await ready;await f.worker.stop();assert.equal(stoppedWithKey,true);assert.equal((await f.queue.read(u.job.id)).state,'queued');
 const restarted=workspaceJobs(new Workspace(f.root,f.vault));t.after(()=>restarted.worker.stop());restarted.worker.start();assert.equal((await finished(restarted.queue,u.job.id)).state,'completed');
});

test('a killed process leaves a recoverable lease and encrypted staged bytes for a 64 MiB original',async t=>{
 const f=await fixture(t),bytes=Buffer.alloc(64*EVIDENCE_CHUNK,0xb3),u=await uploaded(f,bytes);
 const code=`import {Workspace} from './src/storage.js';import {workspaceJobs} from './src/workspace-jobs.js';let input='';for await(const c of process.stdin)input+=c;const data=JSON.parse(input);const ws=new Workspace(data.root,{id:data.id,key:Buffer.from(data.key,'base64')});const {queue}=workspaceJobs(ws);queue.leaseMs=1000;const job=await queue.claim();await queue.definition(job).prepare(job,{progress:async progress=>{await queue.pulse(job.id,job.lease.token,progress);process.stdout.write('checkpoint\\n');await new Promise(()=>{});}});`;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{cwd:process.cwd(),stdio:['pipe','pipe','pipe'],windowsHide:true});
 t.after(()=>{if(child.exitCode===null)child.kill();});
 let stderr='';child.stderr.on('data',c=>stderr+=c);const exited=once(child,'exit');
 const checkpoint=new Promise((resolve,reject)=>{child.stdout.on('data',c=>{if(String(c).includes('checkpoint'))resolve();});child.on('error',reject);child.on('exit',()=>reject(Error('Worker exited before checkpoint: '+stderr)));});
 child.stdin.end(JSON.stringify({root:f.root,id:f.vault.id,key:f.vault.key.toString('base64')}));await checkpoint;child.kill();await exited;
 const staged=path.join(f.root,'.observanda/materials/originals',u.job.id),names=await readdir(staged);assert.ok(names.some(n=>n.startsWith('.stream-')));
 assert.equal((await f.queue.read(u.job.id)).state,'running');await delay(1100);
 f.worker.start();const done=await finished(f.queue,u.job.id);await f.worker.stop();assert.equal(done.state,'completed');assert.equal(done.attempt,2);
 assert.equal((await f.materials.artifact(done.result)).content.sha256,digest(bytes));assert.equal((await f.materials.verify()).originalBytes,bytes.length);
 assert.equal((await readdir(staged)).length,1);assert.ok(!(await readFile(path.join(staged,(await readdir(staged))[0]))).subarray(0,1024).equals(bytes.subarray(0,1024)));
});

test('queued imports and completed jobs survive verified backup and rekeyed restore without duplicate artifacts',async t=>{
 const f=await fixture(t),u=await uploaded(f),backup=await copyWorkspace(await copyPlan(f.root,path.join(f.directory,'backup')),{vault:f.vault});
 const accessRecord=await createAccess('','different worker password'),key=takeCreatedVault(accessRecord);t.after(()=>clearVault(key));
 const rekeyed=await encryptedCopy(await copyPlan(f.root,path.join(f.directory,'rekeyed')),accessRecord,key,f.vault);
 for(const [root,vault] of [[backup,f.vault],[rekeyed,key]]){
  const workspace=new Workspace(root,vault),r=workspaceJobs(workspace);r.worker.start();
  let done;try{done=await finished(r.queue,u.job.id);assert.equal(done.state,'completed');}finally{await r.worker.stop();}
  const materials=new ResearchMaterials(workspace);assert.deepEqual(await contentBuffer((await materials.artifact(done.result)).content),u.bytes);assert.equal((await materials.heads()).length,1);
 }
 assert.equal((await f.queue.read(u.job.id)).state,'queued');
 f.worker.start();const completed=await finished(f.queue,u.job.id);await f.worker.stop();
 const completedCopy=await copyWorkspace(await copyPlan(f.root,path.join(f.directory,'completed-copy')),{vault:f.vault});
 const restored=workspaceJobs(new Workspace(completedCopy,f.vault));assert.deepEqual(await restored.queue.read(u.job.id),completed);
 assert.deepEqual((await restored.queue.enqueue(u.input)).result,completed.result);assert.equal(await restored.queue.hasActive(),false);
});

test('an unavailable owning record prevents the background job from reading or committing evidence',async t=>{
 const f=await fixture(t),u=await uploaded(f),before=await f.workspace.read();before.book.entries=before.book.entries.filter(e=>e.id!==f.recordId);await f.workspace.save(before.book,before.etag);
 f.worker.start();const result=await finished(f.queue,u.job.id);assert.equal(result.state,'failed');assert.equal((await f.materials.heads()).length,0);
 await assert.rejects(f.queue.control(u.job.id,'retry'),{code:'MATERIAL_INVALID'});
 await access(path.join(f.root,'.observanda/materials/imports',u.job.id,'0.chunk'));
});


test('disk exhaustion midway through verification keeps uploaded chunks for retry and removes partial output',async t=>{
 const f=await fixture(t),u=await uploaded(f,Buffer.alloc(2*EVIDENCE_CHUNK,0x49)),statfs=fsPromises.statfs;let checks=0;
 fsPromises.statfs=async(...args)=>{if(++checks>1)return {bavail:0n,bsize:4096n};return statfs(...args);};syncBuiltinESMExports();
 try{
  f.worker.start();const failed=await finished(f.queue,u.job.id);await f.worker.stop();assert.equal(failed.state,'failed');assert.equal(failed.error,'STORAGE_FULL');
 }finally{fsPromises.statfs=statfs;syncBuiltinESMExports();}
 assert.equal((await f.materials.verify()).receivedBytes,u.bytes.length);
 assert.deepEqual(await readdir(path.join(f.root,'.observanda/materials/originals',u.job.id)),[]);
 await f.queue.control(u.job.id,'retry');f.worker.start();const done=await finished(f.queue,u.job.id);assert.equal(done.state,'completed');
 assert.deepEqual(await contentBuffer((await f.materials.artifact(done.result)).content),u.bytes);
});

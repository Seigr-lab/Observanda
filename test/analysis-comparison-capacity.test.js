import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {comparisonFixture} from './analysis-comparison-fixture.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {enqueueComparison} from '../src/dataset-jobs.js';
import {withWorkspaceMetadataBatch} from '../src/metadata-batch.js';
import {AppError} from '../src/errors.js';
import path from 'node:path';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';

test('retained comparisons exceed former group, distribution and transition totals with bounded direct inspection',async t=>{
 const f=await comparisonFixture(t,{groups:2101}),started=Date.now();let last=0,longest=0;
 const ref=await f.m.comparisons.save(f.command,{writePage:fn=>f.workspace.withLock(async()=>{const began=Date.now();try{return await withWorkspaceMetadataBatch(f.workspace,fn);}finally{longest=Math.max(longest,Date.now()-began);}}),progress:async p=>{if(p.done-last>=1024){last=p.done;t.diagnostic('Compared '+p.done+' / '+p.total);}}});
 const savedAt=Date.now(),doc=await f.m.read(ref),s=doc.content.summary;assert.equal(s.version,2);assert.deepEqual(s.counts,{groups:2101,distribution:6303,transitions:4202,observations:6303});assert.equal(s.raw.correct,4202);assert.equal(s.raw.mismatched,2101);assert.ok(JSON.stringify(doc).length<12000);
 const retained=f.m.retainedDatasetPage;f.m.retainedDatasetPage=()=>{throw Error('Retained inspection replayed source acquisitions');};
 try{
  const group=(await f.m.comparisons.page({ref,view:'groups',offset:2100})).items[0];assert.equal(group.condition,'Group 2100');
  const distribution=await f.m.comparisons.page({ref,view:'distribution',offset:6290});assert.equal(distribution.items.length,13);assert.equal(distribution.next,null);assert.equal(distribution.items.at(-1).exact.numerator,String(9007199254740993n+6302n));
  const selected=await f.m.comparisons.page({ref,view:'all',group:group.key});assert.equal(selected.items.length,3);assert.equal(selected.items[0].locator.ref.revision,f.dataset.revision);
  assert.equal((await f.m.comparisons.page({ref,view:'exceptions',offset:2090})).items.length,11);
  const transition=await f.m.comparisons.page({ref,view:'transitions',group:group.key,category:'correct'});assert.equal(transition.items.length,2);
 }finally{f.m.retainedDatasetPage=retained;}
 const inspectedAt=Date.now();await f.m.comparisons.verify({...f.command},s);
 t.diagnostic(JSON.stringify({rows:s.rows,retainedManifestBytes:Buffer.byteLength(JSON.stringify(doc)),prepareMs:savedAt-started,inspectionMs:inspectedAt-savedAt,verifyMs:Date.now()-inspectedAt,longestWriterMs:longest}));
});

test('comparison checkpoints roll back failed batches and resume under a fresh worker lease',async t=>{
 const f=await comparisonFixture(t,{groups:35}),{queue,worker}=workspaceJobs(f.workspace);t.after(()=>worker.stop());const id=randomUUID();
 await enqueueComparison(f.m,queue,f.command,id);const first=await queue.claim(),command=first.input.command;let writes=0;
 const file='.observanda/materials/comparison-work/'+id+'.json';
 await assert.rejects(f.m.comparisons.prepare(command,{jobId:id,writePage:fn=>queue.transaction(async()=>{await queue.held(id,first.lease.token);await fn();if(++writes===2)throw new AppError('STORAGE_FULL');})}),{code:'STORAGE_FULL'});
 const checkpoint=JSON.parse(await f.workspace.readMetadata(file,1048576));assert.equal(checkpoint.summary.rows,32);assert.equal(await f.m.current(id),null);
 await queue.release(id,first.lease.token,{error:new AppError('STORAGE_FULL')});await queue.control(id,'retry');const next=await queue.claim(),fresh=new ResearchMaterials(f.workspace);
 const prepared=await fresh.comparisons.prepare(command,{jobId:id,writePage:fn=>queue.transaction(async()=>{await queue.held(id,next.lease.token);return fn();}),progress:p=>queue.pulse(id,next.lease.token,p)});
 assert.equal(prepared.content.summary.rows,105);assert.equal(prepared.content.summary.counts.distribution,105);
 await assert.rejects(queue.complete(id,first.lease.token,prepared),{code:'JOB_LEASE'});
 const completed=await queue.complete(id,next.lease.token,prepared);assert.equal(await f.workspace.readMetadata(file,1048576),null);
 const expected=await fresh.comparisons.prepare({...f.command},{retained:true});assert.deepEqual((await fresh.read(completed.result)).content.summary,expected.content.summary);
 await fresh.verify();
});

test('legacy embedded comparisons remain inspectable and verification never writes research metadata',async t=>{
 const f=await comparisonFixture(t,{groups:2}),legacy=await f.m.comparisons.prepareLegacy(f.command),ref=await f.workspace.withLock(()=>f.m.comparisons.commit(f.command,legacy));
 assert.equal((await f.m.comparisons.page({ref,view:'distribution'})).items.length,6);assert.equal((await f.m.comparisons.page({ref,view:'groups'})).items.length,2);
 const indexed=await f.m.comparisons.save(f.command),write=f.workspace.writeMetadata;f.workspace.writeMetadata=()=>{throw Error('Verification wrote workspace metadata');};
 try{
  await f.m.verify();assert.equal((await f.m.comparisons.page({ref:indexed,view:'transitions'})).items.length,4);
  for(const view of ['groups','distribution','transitions'])assert.deepEqual((await f.m.comparisons.page({ref:indexed,view})).items.map(({groupDetails,...value})=>value),legacy.content.summary[view]);
  // Comparison inspection and verification do not depend on rebuilding the
  // optional discovery index when opening an older retained workspace.
  await f.workspace.withLock(()=>f.workspace.removeMetadata('.observanda/materials/index/state.json'));
  await f.m.comparisons.verify(f.command,(await f.m.read(indexed)).content.summary);
  assert.equal((await f.m.comparisons.page({ref:indexed,view:'distribution'})).items.length,6);
  assert.equal(await f.workspace.readMetadata('.observanda/materials/index/state.json',1024),null);
 }finally{f.workspace.writeMetadata=write;}
});

test('a cancelled comparison resumes from an encrypted restored checkpoint and retains its exact source locators',async t=>{
 const f=await comparisonFixture(t,{groups:15}),id=randomUUID(),file='.observanda/materials/comparison-work/'+id+'.json',controller=new AbortController();
 await assert.rejects(f.m.comparisons.prepare(f.command,{jobId:id,signal:controller.signal,progress:p=>{if(p.done===32)controller.abort();}}),{name:'AbortError'});
 const checkpoint=JSON.parse(await f.workspace.readMetadata(file,1048576));assert.equal(checkpoint.summary.rows,32);
 const access=await createAccess('','comparison recovery qualification'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const destination=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'restored')),access,vault,f.vault),workspace=new Workspace(destination,vault),restored=new ResearchMaterials(workspace);
 const next=await restored.comparisons.prepare(f.command,{jobId:id}),ref=await workspace.withLock(()=>restored.comparisons.commit(f.command,next));
 assert.equal(next.content.summary.rows,45);assert.equal(next.content.summary.raw.mismatched,15);assert.equal(await workspace.readMetadata(file,1048576),null);
 const late=await restored.comparisons.page({ref,view:'distribution',offset:44});assert.equal(late.items[0].exact.numerator,String(9007199254740993n+44n));assert.equal(late.items[0].locator.ref.revision,f.dataset.revision);
 await restored.verify();
 await f.workspace.withLock(()=>f.workspace.writeMetadata(file,JSON.stringify({...checkpoint,last:{...checkpoint.last,row:999999}})));
 await assert.rejects(f.m.comparisons.prepare(f.command,{jobId:id}),{code:'MATERIAL_MISSING'});
 await assert.rejects(f.m.comparisons.prepare(f.command,{jobId:'../escape'}),{code:'INVALID'});
});

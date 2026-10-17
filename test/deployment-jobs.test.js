import {WebsiteSites} from '../src/website-sites.js';
import {contentBuffer} from '../src/file-content.js';
import {PublicationRollback} from '../src/publication-rollback.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {AppError} from '../src/errors.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {DeploymentJobs} from '../src/deployment-jobs.js';
import {Publisher,defaultPublishing} from '../src/publishing.js';
import {clearVault} from '../src/encryption.js';
import {githubFixture} from './github-fixture.js';
import {readGithubOwnership} from '../src/github-publication-plan.js';
test('deployment summaries preserve indexed SSH progress and legacy uploaded arrays',()=>{
 const intent={reviewId:'a'.repeat(64),releaseId:'b'.repeat(64),key:'c'.repeat(64),config:{kind:'ssh',ssh:{host:'publish.example',directory:'/site'}}};
 const summary=journal=>DeploymentJobs.prototype.summary({id:randomUUID(),createdAt:'2026-10-17T00:00:00.000Z',intent,journal});
 assert.equal(summary({uploadedCount:25,total:60}).uploaded,25);
 assert.equal(summary({uploadedCount:60,total:60,receipt:{status:'uploaded-remote-verified'}}).uploaded,60);
 assert.equal(summary({uploadedCount:0,uploaded:['stale-entry'],total:60}).uploaded,0);
 assert.equal(summary({uploaded:['index.html','style.css'],total:3}).uploaded,2);
 assert.equal(summary({total:3}).uploaded,0);assert.equal(summary({uploadedCount:25,total:60}).total,60);
 const github=DeploymentJobs.prototype.summary({intent:{...intent,config:{kind:'github',github:{owner:'example',repository:'research',branch:'main',directory:''}}},journal:{uploaded:['blob-a'],entries:[{sha:'blob-a'},{sha:'blob-a'},{sha:'blob-b'}]}});
 assert.equal(github.uploaded,1);assert.equal(github.total,2);
});

const token='synthetic_github_token_1234567890';
async function fixture(t,{nested=false,extraRecords=0}={}){
 const book=sampleNotebook(),seed=book.entries[0];
 for(let i=0;i<extraRecords;i++)book.entries.push({...structuredClone(seed),id:randomUUID(),title:'Public observation '+i,body:'A retained observation.',share:true,figures:[],sections:[],attachments:[],relations:[]});
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-deploy-')),f=await encryptedFixture(directory,book),remote=githubFixture(nested?{branch:'main',initialFiles:{'index.html':'Existing home','lab/handwritten.html':'Existing notes'}}:{}),publisher=new Publisher(f.workspace.root,{request:remote.request},f.vault),jobs=workspaceJobs(f.workspace,publisher);
 t.after(async()=>{await jobs.worker.stop();clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const config=defaultPublishing();Object.assign(config.github,{owner:'example',repository:'notebook',branch:nested?'main':'observanda-site',directory:nested?'lab/field-notes':'',pages:true});config.publicUrl='https://public.example/research/';const saved=await publisher.save(config,'new');await publisher.connect(token);
 const releases=new PublicationJobs(f.workspace);await releases.start(await releases.workspace.outline(),jobs.queue);const prepared=await run(jobs.queue);assert.equal(prepared.state,'completed',prepared.error);
 const deployments=new DeploymentJobs(f.workspace,publisher,jobs.queue),candidate=await releases.read(prepared.result.id),intent={id:prepared.result.id,configEtag:saved.etag,reviewed:true};
 if(nested){const plan=await publisher.reviewDestination(candidate,saved.etag);Object.assign(intent,{destinationReview:plan.id,destinationReviewed:true});}
 return {...f,...jobs,directory,remote,publisher,deployments,candidate,intent};
}
async function run(queue){const job=await queue.claim();if(!job)return null;try{const output=await queue.definition(job).prepare(job,{signal:new AbortController().signal,progress:p=>queue.pulse(job.id,job.lease.token,p)});return await queue.complete(job.id,job.lease.token,output);}catch(error){return queue.release(job.id,job.lease.token,{error});}}
const writes=remote=>remote.calls.filter(c=>c.method!=='GET');
async function saveFooter(workspace,footer){
 const sites=new WebsiteSites(workspace),current=await sites.read(null);
 return sites.save(null,{workspaceId:current.book.id,baseEtag:current.etag,websitePin:current.websitePin,metadata:{website:{...current.book.website,footer}},projects:[],changes:[],removed:[]});
}


test('a damaged prepared live inventory blocks resumed provider writes',async t=>{
 const f=await fixture(t),job=await f.deployments.start(f.intent);
 f.remote.setHook(call=>{if(call.route.endsWith('/git/blobs'))throw Error('Synthetic interruption before upload');});
 assert.equal((await run(f.queue)).state,'failed');const deployment=await f.deployments.read(job.id),root=deployment.journal.liveInventory.files.root;
 assert.ok(root);const file='.observanda/materials/sequences/live-inventory-nodes/'+root.hash+'.json';
 const original=await f.workspace.readMetadata(file,262144);await f.workspace.withLock(()=>f.workspace.writeMetadata(file,'{}'));
 const before=writes(f.remote).length;f.remote.setHook(null);await f.queue.control(job.id,'retry');const failed=await run(f.queue);
 assert.equal(failed.state,'failed');assert.equal(failed.error,'MATERIAL_MISSING');assert.equal(writes(f.remote).length,before);
 await f.workspace.withLock(()=>f.workspace.writeMetadata(file,original));await f.queue.control(job.id,'retry');assert.equal((await run(f.queue)).state,'completed');
});

test('a retained edition resumes a lost later tree batch after restart before moving main',async t=>{
 const f=await fixture(t,{nested:true,extraRecords:260}),parent=f.remote.head,job=await f.deployments.start(f.intent);let trees=0;
 f.remote.setHook((call,phase)=>{if(call.route.endsWith('/git/trees')&&phase==='after'&&++trees===2)throw Error('Lost second tree batch');});
 const interrupted=await run(f.queue);assert.equal(interrupted.state,'failed',interrupted.error);
 const journal=(await f.deployments.read(job.id)).journal;assert.equal(journal.treeBuild.applied,256);assert.equal(journal.tree,undefined);assert.equal(f.remote.head,parent);
 const restarted=new Publisher(f.workspace.root,{request:f.remote.request},f.vault),jobs=workspaceJobs(f.workspace,restarted);await restarted.connect(token);f.remote.setHook(null);
 await jobs.queue.control(job.id,'retry');const completed=await run(jobs.queue);assert.equal(completed.state,'completed',completed.error);
 const posted=f.remote.calls.filter(c=>c.route.endsWith('/git/trees')&&c.method==='POST');assert.equal(posted.length,3);assert.deepEqual(posted[1].data,posted[2].data);
 assert.deepEqual(f.remote.commits.get(f.remote.head).parents,[parent]);assert.equal(f.remote.trees.get(f.remote.commits.get(f.remote.head).tree).filter(f=>f.path.startsWith('lab/field-notes/')).length,f.candidate.files.size);
 const retained=await readGithubOwnership(restarted,f.config??(await restarted.read()).config,(await restarted.read()).receipt);assert.equal(retained.files.length,f.candidate.files.size);
});

test('interrupted upload resumes acknowledged blobs after restart and retains separate push/live verification',async t=>{
 const f=await fixture(t),job=await f.deployments.start(f.intent);let uploads=0;
 f.remote.setHook((c,phase)=>{if(c.route.endsWith('/git/blobs')&&phase==='before'&&++uploads===3)throw Error('connection lost');});
 assert.equal((await run(f.queue)).state,'failed');assert.equal((await f.deployments.read(job.id)).journal.uploaded.length,2);assert.equal(f.remote.head,null);
 const restarted=new Publisher(f.workspace.root,{request:f.remote.request},f.vault),jobs=workspaceJobs(f.workspace,restarted);await jobs.queue.control(job.id,'retry');assert.equal((await run(jobs.queue)).error,'PUBLISH_AUTH');
 await restarted.connect(token);f.remote.setHook(null);await jobs.queue.control(job.id,'retry');assert.equal((await run(jobs.queue)).state,'completed');
 const saved=await f.deployments.read(job.id);assert.ok(saved.journal.receipt);assert.equal(f.remote.commits.size,1);assert.equal(f.remote.head,saved.journal.commit);
 for(const hash of saved.journal.uploaded.slice(0,2))assert.equal(f.remote.calls.filter(c=>c.route.endsWith('/git/blobs')&&c.data&&Buffer.from(c.data.content,'base64').equals(f.remote.blobs.get(hash))).length,1);
 assert.equal((await restarted.read()).receipt.verification,undefined);await assert.rejects(restarted.verifyLive(),{code:'PUBLISH_NOT_LIVE'});
 f.remote.setManifest((await contentBuffer(await f.candidate.files.get('publication.json'))).toString('utf8'));await restarted.verifyLive();assert.ok((await restarted.read()).receipt.verification);assert.ok((await f.deployments.page()).items[0].verification);
 assert.equal((await f.deployments.start(f.intent)).id,job.id);assert.equal((await f.deployments.page()).items.length,1);
 assert.ok(!JSON.stringify(await f.deployments.read(job.id)).includes(token));
});

test('a nested deployment reconciles a lost push and retains ownership alongside unrelated files',async t=>{
 const f=await fixture(t,{nested:true}),initial=f.remote.head,before=structuredClone(f.remote.trees.get(f.remote.commits.get(initial).tree)),job=await f.deployments.start(f.intent);
 f.remote.setHook((c,phase)=>{if(c.route.endsWith('/git/refs/heads/main')&&phase==='after')throw Error('Lost nested push response');});
 assert.equal((await run(f.queue)).state,'failed');const journal=(await f.deployments.read(job.id)).journal;assert.ok(journal.pushAttempted);assert.equal(journal.receipt,undefined);
 assert.deepEqual(f.remote.trees.get(f.remote.commits.get(f.remote.head).tree).filter(e=>!e.path.startsWith('lab/field-notes/')),before);
 const restarted=new Publisher(f.workspace.root,{request:f.remote.request},f.vault),jobs=workspaceJobs(f.workspace,restarted);await restarted.connect(token);f.remote.setHook(null);
 const prior=writes(f.remote).length;await jobs.queue.control(job.id,'retry');assert.equal((await run(jobs.queue)).state,'completed');
 assert.equal(writes(f.remote).length-prior,1);assert.deepEqual(f.remote.commits.get(f.remote.head).parents,[initial]);
 const plan=await restarted.reviewDestination(f.candidate,f.intent.configEtag);assert.equal(plan.requiresReview,false);assert.deepEqual(plan.conflicts,[]);assert.equal(plan.unchanged.length,f.candidate.files.size);assert.deepEqual(plan.preserved,before.map(e=>e.path));
});

test('lost push response is reconciled without uploading again or creating another commit',async t=>{
 const f=await fixture(t),job=await f.deployments.start(f.intent);f.remote.setHook((c,phase)=>{if(c.route.endsWith('/git/refs')&&phase==='after')throw Error('response lost');});
 assert.equal((await run(f.queue)).state,'failed');const d=await f.deployments.read(job.id);assert.equal(d.journal.pushAttempted,true);assert.equal(d.journal.receipt,undefined);assert.equal(f.remote.head,d.journal.commit);
 await assert.rejects(f.publisher.save((await f.publisher.read()).config,f.intent.configEtag),{code:'PUBLISH_PENDING'});
 const before=writes(f.remote).length;f.remote.setHook(null);await f.queue.control(job.id,'retry');assert.equal((await run(f.queue)).state,'completed');assert.equal(f.remote.commits.size,1);assert.equal(writes(f.remote).length-before,1); // Pages setup only.
});

test('lost commit response produces one deterministic commit and ordinary edits remain possible during upload',async t=>{
 const f=await fixture(t),job=await f.deployments.start(f.intent);let edited=false;
 f.remote.setHook(async(c,phase)=>{if(c.route.endsWith('/git/blobs')&&phase==='after'&&!edited){edited=true;const current=await f.workspace.read();current.book.title='Later private workspace edit';await f.workspace.save(current.book,current.etag);}if(c.route.endsWith('/git/commits')&&phase==='after')throw Error('lost commit response');});
 assert.equal((await run(f.queue)).state,'failed');assert.equal(edited,true);assert.equal(f.remote.commits.size,1);f.remote.setHook(null);await f.queue.control(job.id,'retry');assert.equal((await run(f.queue)).state,'completed');assert.equal(f.remote.commits.size,1);
 for(const bytes of f.remote.blobs.values())assert.ok(!bytes.includes(Buffer.from('Later private workspace edit')));
});

test('cancelled in-flight push stays uncertain; concurrent destination work and stale leases cannot overwrite it',async t=>{
 const f=await fixture(t),job=await f.deployments.start(f.intent);
 f.remote.setHook(async(c,phase)=>{if(c.route.endsWith('/git/refs')&&phase==='after')await f.queue.control(job.id,'cancel');});
 assert.equal((await run(f.queue)).state,'cancelled');assert.ok(f.remote.head);assert.equal((await f.deployments.read(job.id)).journal.receipt,undefined);
 f.remote.setHook(null);f.remote.setHead('b'.repeat(40));const before=writes(f.remote).length;await f.queue.control(job.id,'retry');assert.equal((await run(f.queue)).error,'PUBLISH_OWNERSHIP');assert.equal(writes(f.remote).length,before);
});

test('review confirmation, stale editions and replaced lease owners stop writes',async t=>{
 const f=await fixture(t);await assert.rejects(f.deployments.start({...f.intent,reviewed:false}),{code:'PUBLISH_STALE'});
 const job=await f.deployments.start(f.intent),old=await f.queue.claim();await f.queue.transaction(async()=>{const current=await f.queue.read(job.id);current.lease.until=0;await f.queue.write(current);});const next=await f.queue.claim();
 await assert.rejects(f.queue.definition(old).prepare(old,{signal:new AbortController().signal,progress:async()=>{}}),{code:'JOB_LEASE'});assert.equal(writes(f.remote).length,0);
 const output=await f.queue.definition(next).prepare(next,{signal:new AbortController().signal,progress:async()=>{}});await f.queue.complete(next.id,next.lease.token,output);
 const current=await f.workspace.read();current.book.title='Changed';await f.workspace.save(current.book,current.etag);await assert.rejects(f.deployments.start(f.intent),{code:'STALE'});
});

test('failed local receipt commits retain recoverable push intent through a fresh-key backup restore',async t=>{
 const f=await fixture(t),job=await f.deployments.start(f.intent),write=f.workspace.writeMetadata.bind(f.workspace);let fail=true;
 f.workspace.writeMetadata=async(name,value)=>{if(fail&&name==='.observanda/publishing-receipts.json'){fail=false;throw new AppError('STORAGE_FULL');}return write(name,value);};
 assert.equal((await run(f.queue)).state,'failed');f.workspace.writeMetadata=write;
 const journal=(await f.deployments.read(job.id)).journal;assert.equal(journal.receipt,undefined);assert.equal(journal.pushAttempted,true);assert.equal(f.remote.head,journal.commit);
 assert.equal(await readGithubOwnership(f.publisher,(await f.publisher.read()).config,null),null);
 const access=await createAccess('','restored fixture password'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const root=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'restored')),access,vault,f.vault),workspace=new Workspace(root,vault),publisher=new Publisher(root,{request:f.remote.request},vault),jobs=workspaceJobs(workspace,publisher);
 await publisher.connect(token);await jobs.queue.control(job.id,'retry');const before=writes(f.remote).length;assert.equal((await run(jobs.queue)).state,'completed');assert.equal(writes(f.remote).length-before,1);assert.equal(f.remote.commits.size,1);
 assert.equal((await publisher.read()).receipt.commit,journal.commit);assert.equal((await f.publisher.read()).receipt,null);
 const restored=await publisher.read();assert.equal((await readGithubOwnership(publisher,restored.config,restored.receipt)).commit,journal.commit);
});


test('reviewed rollback republishes exact retained files as a new non-forced commit',async t=>{
 const f=await fixture(t);await f.deployments.start(f.intent);assert.equal((await run(f.queue)).state,'completed');const first=f.remote.head;
 await saveFooter(f.workspace,'The newer edition');
 const releases=new PublicationJobs(f.workspace);await releases.start(await releases.workspace.outline(),f.queue);const prepared=await run(f.queue);assert.equal(prepared.state,'completed');
 const newer=await releases.read(prepared.result.id),plan=await f.publisher.reviewDestination(newer,f.intent.configEtag);
 await f.deployments.start({id:newer.reviewId,configEtag:f.intent.configEtag,reviewed:true,destinationReview:plan.id,destinationReviewed:true});assert.equal((await run(f.queue)).state,'completed');const second=f.remote.head;
 const rollback=new PublicationRollback(f.workspace,f.publisher),approval=await rollback.review({id:f.candidate.reviewId}),restorePlan=await f.publisher.reviewDestination(f.candidate,f.intent.configEtag),intent={...f.intent,rollbackReview:approval.review.id,rollbackConfirmed:true,destinationReview:restorePlan.id,destinationReviewed:true};
 await assert.rejects(f.deployments.start({...intent,rollbackConfirmed:false}),{code:'PUBLISH_STALE'});
 const before=await f.workspace.read(),websiteBefore=await new WebsiteSites(f.workspace).read(null);await f.deployments.start(intent);const completed=await run(f.queue);assert.equal(completed.state,'completed',completed.error);assert.deepEqual(f.remote.commits.get(f.remote.head).parents,[second]);assert.notEqual(f.remote.head,first);assert.deepEqual(f.remote.trees.get(f.remote.commits.get(f.remote.head).tree),f.remote.trees.get(f.remote.commits.get(first).tree));assert.deepEqual(await f.workspace.read(),before);assert.deepEqual(await new WebsiteSites(f.workspace).read(null),websiteBefore);
});

test('rollback approval is invalidated by a later workspace edit or changed destination',async t=>{
 const f=await fixture(t),rollback=new PublicationRollback(f.workspace,f.publisher),approval=await rollback.review({id:f.candidate.reviewId}),saved=await f.workspace.read();saved.book.title='A subsequent edit';await f.workspace.save(saved.book,saved.etag);
 await assert.rejects(f.deployments.start({...f.intent,rollbackReview:approval.review.id,rollbackConfirmed:true}),{code:'PUBLISH_STALE'});assert.equal(writes(f.remote).length,0);
 const next=await rollback.review({id:f.candidate.reviewId}),config=(await f.publisher.read()).config;config.github.branch='another-branch';await f.publisher.save(config,f.intent.configEtag);
 await assert.rejects(rollback.authorize(f.candidate,next.review.id),{code:'PUBLISH_STALE'});assert.equal(writes(f.remote).length,0);
});

test('a concurrent remote edit blocks rollback, and a fresh review preserves that edit',async t=>{
 const f=await fixture(t);await f.deployments.start(f.intent);assert.equal((await run(f.queue)).state,'completed');
 const first=f.remote.head,original=f.remote.trees.get(f.remote.commits.get(first).tree);
 await saveFooter(f.workspace,'A new edition');
 const releases=new PublicationJobs(f.workspace);await releases.start(await releases.workspace.outline(),f.queue);const prepared=await run(f.queue),newer=await releases.read(prepared.result.id),plan=await f.publisher.reviewDestination(newer,f.intent.configEtag);
 await f.deployments.start({id:newer.reviewId,configEtag:f.intent.configEtag,reviewed:true,destinationReview:plan.id,destinationReviewed:true});assert.equal((await run(f.queue)).state,'completed');
 const second=f.remote.head,rollback=new PublicationRollback(f.workspace,f.publisher);
 const approve=async()=>{const approval=await rollback.review({id:f.candidate.reviewId}),plan=await f.publisher.reviewDestination(f.candidate,f.intent.configEtag);return {...f.intent,rollbackReview:approval.review.id,rollbackConfirmed:true,destinationReview:plan.id,destinationReviewed:true};};
 const attempt=await f.deployments.start(await approve()),other='c'.repeat(40),tree='d'.repeat(40),blob='e'.repeat(40);let changed=false;
 f.remote.setHook((call,phase)=>{if(call.route.endsWith('/git/commits')&&phase==='after'&&!changed){changed=true;f.remote.blobs.set(blob,Buffer.from('Independent news'));f.remote.trees.set(tree,[...f.remote.trees.get(f.remote.commits.get(second).tree),{path:'news.html',mode:'100644',type:'blob',sha:blob}]);f.remote.commits.set(other,{tree,parents:[second],message:'Independent update'});f.remote.setHead(other);}});
 assert.equal((await run(f.queue)).error,'PUBLISH_STALE');assert.equal(f.remote.head,other);assert.ok(!(await f.deployments.read(attempt.id)).journal.pushAttempted);
 f.remote.setHook(null);const accepted=await approve(),retry=await f.deployments.start(accepted);assert.notEqual(retry.id,attempt.id);assert.equal((await f.deployments.start(accepted)).id,retry.id);
 const result=await run(f.queue);assert.equal(result.state,'completed',result.error);assert.deepEqual(f.remote.commits.get(f.remote.head).parents,[other]);
 const files=f.remote.trees.get(f.remote.commits.get(f.remote.head).tree);assert.deepEqual(files.filter(e=>e.path!=='news.html'),original);assert.equal(files.find(e=>e.path==='news.html').sha,blob);
 assert.equal((await new WebsiteSites(f.workspace).read(null)).book.website.footer,'A new edition');
});

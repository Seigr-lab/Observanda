import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {Publisher,defaultPublishing} from '../src/publishing.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {DeploymentJobs} from '../src/deployment-jobs.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {indexedGithubFilePlan,readGithubOwnership,admitGithubPlan} from '../src/github-publication-plan.js';
import {githubPlanReader,verifyGithubPublishingPlans} from '../src/github-plan-index.js';
import {githubFixture,sha} from './github-fixture.js';
import {GithubPlanJobs} from '../src/github-plan-jobs.js';
import {randomUUID} from 'node:crypto';
const token='synthetic_github_token_1234567890';
const tree=remote=>remote.trees.get(remote.commits.get(remote.head).tree);
const writes=remote=>remote.calls.filter(c=>c.method!=='GET');
async function run(queue){const job=await queue.claim();assert.ok(job);try{return await queue.complete(job.id,job.lease.token,await queue.definition(job).prepare(job,{signal:new AbortController().signal,progress:p=>queue.pulse(job.id,job.lease.token,p)}));}catch(error){return queue.release(job.id,job.lease.token,{error});}}
async function fixture(t,{directory='',pages=true}={}){
 const temporary=await mkdtemp(path.join(os.tmpdir(),'observanda-replacement-')),book=sampleNotebook();book.entries[1].share=false;book.entries[1].body='PRIVATE_REPLACEMENT_SENTINEL';
 const f=await encryptedFixture(temporary,book),initialFiles={'index.html':'Old application','package.json':'Old dependencies','.github/workflows/old-app.yml':'Old build','src/app.js':'Old source','CNAME':'field.example\n','LICENSE.md':'Retained terms','LICENSES/library.txt':'Retained third-party terms','NOTICE':'Retained notice','docs/COPYING':'Retained copying terms'},remote=githubFixture({branch:'main',initialFiles,initialPages:pages?{build_type:'workflow',source:{branch:'main',path:'/'},cname:'field.example',https_enforced:true}:null}),publisher=new Publisher(f.workspace.root,{request:remote.request},f.vault),jobs=workspaceJobs(f.workspace,publisher);
 t.after(async()=>{await jobs.worker.stop();clearVault(f.vault);assert.equal(path.dirname(temporary),path.resolve(os.tmpdir()));assert.ok(path.basename(temporary).startsWith('observanda-replacement-'));await rm(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const config=defaultPublishing();Object.assign(config.github,{owner:'example',repository:'notebook',branch:'main',directory,pages});const saved=await publisher.save(config,'new');await publisher.connect(token);
 const releases=new PublicationJobs(f.workspace);await releases.start(await releases.workspace.outline(),jobs.queue);const prepared=await run(jobs.queue);assert.equal(prepared.state,'completed',prepared.error);
 return {...f,...jobs,remote,publisher,config,etag:saved.etag,candidate:await releases.read(prepared.result.id),reviewId:prepared.result.id,deployments:new DeploymentJobs(f.workspace,publisher,jobs.queue)};
}
async function review(f,archiveBranch=null){const result=await f.publisher.reviewDestination(f.candidate,f.etag,{replaceExisting:true,archiveBranch});return {result,intent:{id:f.reviewId,configEtag:f.etag,reviewed:true,destinationReview:result.id,destinationReviewed:true}};}
function externalEdit(remote,name,content){const parent=remote.head,entries=tree(remote).filter(row=>row.path!==name),hash=sha('blob',Buffer.from(content));remote.blobs.set(hash,Buffer.from(content));entries.push({path:name,mode:'100644',type:'blob',sha:hash});const root=sha('tree',Buffer.from(JSON.stringify(entries))),commit=sha('commit',Buffer.from(root+parent));remote.trees.set(root,entries);remote.commits.set(commit,{tree:root,parents:[parent]});remote.setHead(commit);}

test('native repository replacement requires explicit approval and preserves domain, legal files, Pages settings and history',async t=>{
 const f=await fixture(t),parent=f.remote.head,before=structuredClone(tree(f.remote)),ordinary=await f.publisher.reviewDestination(f.candidate,f.etag);
 assert.ok(ordinary.counts.conflicts>0);assert.equal(writes(f.remote).length,0);
 const {result,intent}=await review(f,'before-observanda');assert.equal(result.version,3);assert.equal(result.replacement.archiveBranch,'before-observanda');assert.equal(result.counts.preserved,5);assert.ok(result.removed.includes('.github/workflows/old-app.yml'));assert.equal(result.counts.conflicts,0);assert.equal(writes(f.remote).length,0);
 await assert.rejects(f.deployments.start({...intent,destinationReviewed:false}),{code:'PUBLISH_STALE'});assert.equal(writes(f.remote).length,0);
 const job=await f.deployments.start(intent);assert.equal((await f.deployments.read(job.id)).version,3);assert.equal((await f.deployments.start(intent)).id,job.id);
 const completed=await run(f.queue);assert.equal(completed.state,'completed',completed.error);
 const after=tree(f.remote),preserved=before.filter(row=>result.preserved.includes(row.path));for(const row of preserved)assert.deepEqual(after.find(value=>value.path===row.path),row);
 assert.equal(after.length,f.candidate.files.size+preserved.length);for(const name of result.removed)assert.ok(!after.some(row=>row.path===name));
 assert.equal(f.remote.branches.get('before-observanda'),parent);assert.deepEqual(f.remote.commits.get(f.remote.head).parents,[parent]);assert.deepEqual(f.remote.trees.get(f.remote.commits.get(parent).tree),before);
 assert.deepEqual(f.remote.pages,{build_type:'legacy',source:{branch:'main',path:'/'},cname:'field.example',https_enforced:true});assert.ok(!writes(f.remote).some(call=>call.data?.force===true));
 const receipt=(await f.publisher.read()).receipt;assert.deepEqual(receipt.archive,{branch:'before-observanda',commit:parent});assert.equal(receipt.status,'uploaded-awaiting-pages');
 for(const call of writes(f.remote).filter(call=>call.route.endsWith('/git/blobs')))assert.ok(!Buffer.from(call.data.content,'base64').includes(Buffer.from('PRIVATE_REPLACEMENT_SENTINEL')));
 externalEdit(f.remote,'unrelated-new.txt','A later user addition');const next=await f.publisher.reviewDestination(f.candidate,f.etag);assert.equal(next.version,2);assert.equal(next.counts.conflicts,0);assert.equal(next.counts.removed,0);assert.ok(next.preserved.includes('CNAME'));assert.ok(next.preserved.includes('unrelated-new.txt'));
 const owned=await readGithubOwnership(f.publisher,f.config,receipt);assert.equal(await githubPlanReader(f.workspace,owned).get('entries','CNAME'),null);await verifyGithubPublishingPlans(f.workspace);
});

test('replacement resumes lost archive, tree and activation replies after restart without duplicate commits or overwriting branches',async t=>{
 const f=await fixture(t,{pages:false}),parent=f.remote.head,{intent}=await review(f,'old-application'),job=await f.deployments.start(intent);let failure='archive';
 f.remote.setHook((call,phase)=>{if(phase!=='after')return;if(failure==='archive'&&call.data?.ref==='refs/heads/old-application'||failure==='tree'&&call.route.endsWith('/git/trees')&&call.method==='POST'||failure==='activation'&&call.method==='PATCH'){const stage=failure;failure=null;throw Error('Lost '+stage+' response');}});
 assert.equal((await run(f.queue)).state,'failed');assert.equal(f.remote.head,parent);assert.equal(f.remote.branches.get('old-application'),parent);
 const restarted=new Publisher(f.workspace.root,{request:f.remote.request},f.vault),jobs=workspaceJobs(f.workspace,restarted);await restarted.connect(token);t.after(()=>jobs.worker.stop());
 for(const stage of ['tree','activation']){failure=stage;await jobs.queue.control(job.id,'retry');assert.equal((await run(jobs.queue)).state,'failed');if(stage==='tree')assert.equal(f.remote.head,parent);}
 const commit=f.remote.head,priorWrites=writes(f.remote).length;assert.notEqual(commit,parent);await jobs.queue.control(job.id,'retry');const completed=await run(jobs.queue);assert.equal(completed.state,'completed',completed.error);assert.equal(writes(f.remote).length,priorWrites);assert.equal(f.remote.head,commit);
 assert.equal(writes(f.remote).filter(call=>call.data?.ref==='refs/heads/old-application').length,1);assert.equal(writes(f.remote).filter(call=>call.route.endsWith('/git/commits')).length,1);await verifyGithubPublishingPlans(f.workspace);
});

test('replacement refuses occupied archive branches, concurrent repository edits and changed Pages domain settings',async t=>{
 const f=await fixture(t),parent=f.remote.head;f.remote.branches.set('occupied',parent);
 await assert.rejects(review(f,'occupied'),{code:'PUBLISH_ARCHIVE_BRANCH'});await assert.rejects(review(f,'main'),{code:'PUBLISH_ARCHIVE_BRANCH'});assert.equal(writes(f.remote).length,0);
 const {intent}=await review(f,'archive');await f.deployments.start(intent);externalEdit(f.remote,'concurrent.txt','Other author');assert.equal((await run(f.queue)).error,'PUBLISH_STALE');assert.equal(writes(f.remote).length,0);
 const next=await review(f,'archive');await f.deployments.start(next.intent);f.remote.setPages({...f.remote.pages,cname:'changed.example'});assert.equal((await run(f.queue)).error,'PUBLISH_STALE');assert.equal(writes(f.remote).length,0);
 const latest=f.remote.head,third=await review(f,'archive');await f.deployments.start(third.intent);f.remote.setHook((call,phase)=>{if(phase==='after'&&call.route.endsWith('/git/commits')&&call.method==='POST')f.remote.branches.set('archive','f'.repeat(40));});
 assert.equal((await run(f.queue)).error,'PUBLISH_ARCHIVE_BRANCH');assert.equal(f.remote.head,latest);assert.equal(f.remote.branches.get('archive'),'f'.repeat(40));
});

test('replacement scope preserves outside files and protected boundaries while removing obsolete aliases and submodules',async t=>{
 const f=await fixture(t,{directory:'site',pages:false}),files=[{path:'site/old/index.js',mode:'100644',type:'blob',sha:'a'.repeat(40)},{path:'site/assets',mode:'160000',type:'commit',sha:'b'.repeat(40)},{path:'site/INDEX.html',mode:'100644',type:'blob',sha:'c'.repeat(40)},{path:'site/LICENSE.md',mode:'100644',type:'blob',sha:'d'.repeat(40)},{path:'outside.txt',mode:'100755',type:'blob',sha:'e'.repeat(40)}],candidate={files:new Map([['index.html','New index'],['assets/app.css','New stylesheet']])};
 const plan=await indexedGithubFilePlan(f.workspace,candidate,files,null,'site',{replaceExisting:true}),reader=githubPlanReader(f.workspace,plan);assert.equal(plan.counts.conflicts,0);assert.equal(plan.counts.removed,3);assert.equal(plan.counts.preserved,2);assert.deepEqual(await reader.get('preservedEntries','outside.txt'),files[4]);
 candidate.files.set('LICENSE.md','Different terms');const blocked=await indexedGithubFilePlan(f.workspace,candidate,files,null,'site',{replaceExisting:true});assert.equal(blocked.counts.conflicts,1);
 candidate.files.delete('LICENSE.md');candidate.files.set('LICENSE.md/new.txt','Cannot replace license with folder');const boundary=await indexedGithubFilePlan(f.workspace,candidate,files,null,'site',{replaceExisting:true});assert.equal(boundary.counts.conflicts,1);
 const {result}=await review(f);assert.throws(()=>admitGithubPlan({...result,document:plan.document,replacement:{...result.replacement,archiveBranch:'../bad'}}),{code:'PUBLISH_STALE'});
});

test('repository review returns a durable operation before slow remote reads and retains its completion receipt after restart',async t=>{
 const f=await fixture(t,{pages:false}),plans=new GithubPlanJobs(f.workspace,f.publisher,f.queue),request={id:f.reviewId,configEtag:f.etag,replaceExisting:true,archiveBranch:'saved-application',commandId:randomUUID()},calls=f.remote.calls.length;
 const job=await plans.start(request);assert.equal(job.state,'queued');assert.equal(f.remote.calls.length,calls);assert.equal((await plans.start(request)).id,job.id);
 let release,entered;const blocked=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});let once=false;
 f.remote.setHook(async(call,phase)=>{if(!once&&phase==='before'&&call.route.includes('/git/trees/')){once=true;entered();await blocked;}});
 const running=run(f.queue);await started;
 const restarted=new Publisher(f.workspace.root,{request:f.remote.request},f.vault),jobs=workspaceJobs(f.workspace,restarted),reopened=new GithubPlanJobs(f.workspace,restarted,jobs.queue);t.after(()=>jobs.worker.stop());await restarted.connect(token);
 assert.equal((await reopened.operation({id:job.id})).job.state,'running');assert.equal((await reopened.start(request)).id,job.id);assert.equal(writes(f.remote).length,0);
 await f.workspace.withLock(()=>f.workspace.writeMetadata('.observanda/disposable-review-note.json','{"test":true}'));release();const completed=await running;assert.equal(completed.state,'completed',completed.error);
 const receipt=await reopened.operation({id:job.id});assert.equal(receipt.plan.id,completed.result.id);assert.equal(receipt.plan.replacement.archiveBranch,'saved-application');assert.equal((await reopened.start(request)).state,'completed');assert.equal(writes(f.remote).length,0);
 await assert.rejects(reopened.start({...request,archiveBranch:'another-branch'}),{code:'JOB_CHANGED'});
});

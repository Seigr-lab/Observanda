import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {Publisher,defaultPublishing} from '../src/publishing.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {GithubRepositorySetup} from '../src/github-repository.js';
import {repositoryFixture} from './github-fixture.js';
const token='synthetic_github_token_1234567890';
async function fixture(t,options){const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-repository-')),f=await encryptedFixture(directory,sampleNotebook()),remote=repositoryFixture(options),publisher=new Publisher(f.workspace.root,{request:remote.request},f.vault),jobs=workspaceJobs(f.workspace,publisher),config=defaultPublishing();Object.assign(config.github,{owner:'example',repository:'notebook',pages:true});await publisher.connect(token);t.after(async()=>{await jobs.worker.stop();clearVault(f.vault);await rm(directory,{recursive:true,force:true});});return {...f,...jobs,remote,publisher,config,setup:new GithubRepositorySetup(f.workspace,publisher,jobs.queue),command:{config,etag:'new',visibility:'public',confirmed:true}};}
async function run(queue){const job=await queue.claim();assert.ok(job);try{const output=await queue.definition(job).prepare(job,{signal:new AbortController().signal,progress:p=>queue.pulse(job.id,job.lease.token,p)});return await queue.complete(job.id,job.lease.token,output);}catch(error){return queue.release(job.id,job.lease.token,{error});}}
test('new personal and organization repositories are initialized on main without publishing workspace content',async t=>{
 for(const ownerType of ['User','Organization']){
  const f=await fixture(t,{ownerType,defaultBranch:'master'}),job=await f.setup.start(f.command);assert.equal((await f.setup.start(f.command)).id,job.id);
  assert.equal((await run(f.queue)).state,'completed');const saved=await f.publisher.read();assert.equal(saved.config.github.branch,'main');assert.equal(saved.configured,true);
  assert.ok(f.remote.calls.some(c=>c.route===(ownerType==='User'?'/user/repos':'/orgs/example/repos')&&c.data.private===false));
  assert.equal(f.remote.blobs.size,1);assert.equal([...f.remote.blobs.values()][0].length,0);assert.equal(f.remote.calls.some(c=>c.route.endsWith('/pages')),false);
  assert.ok(!JSON.stringify(await f.setup.read(job.id)).includes(token));
 }
});
test('lost initialization response resumes against the same created repository after restart',async t=>{
 const f=await fixture(t),job=await f.setup.start(f.command);let once=true;
 f.remote.setSetupHook(c=>{if(once&&c.route.endsWith('/contents/.nojekyll')){once=false;throw Error('lost reply');}});
 assert.equal((await run(f.queue)).state,'failed');assert.ok(f.remote.head);assert.equal((await f.publisher.read()).configured,false);
 const publisher=new Publisher(f.workspace.root,{request:f.remote.request},f.vault),jobs=workspaceJobs(f.workspace,publisher);await publisher.connect(token);await jobs.queue.control(job.id,'retry');assert.equal((await run(jobs.queue)).state,'completed');
 assert.equal(f.remote.calls.filter(c=>c.route==='/user/repos').length,1);assert.equal(f.remote.calls.filter(c=>c.route.endsWith('/contents/.nojekyll')).length,1);
});
test('existing names and uncertain creation replies never authorize taking over a repository',async t=>{
 for(const existing of [true,false]){
  const f=await fixture(t,{exists:existing}),job=await f.setup.start(f.command);
  if(!existing)f.remote.setSetupHook(c=>{if(c.route==='/user/repos')throw Error('lost creation reply');});
  assert.equal((await run(f.queue)).state,'failed');
  if(!existing){await f.queue.control(job.id,'retry');assert.equal((await run(f.queue)).error,'PUBLISH_REPO_EXISTS');}
  assert.equal((await f.publisher.read()).configured,false);assert.equal(f.remote.calls.filter(c=>c.route.endsWith('/contents/.nojekyll')).length,0);
 }
});
test('invalid consent and changed local destination stop repository setup',async t=>{
 const f=await fixture(t);await assert.rejects(f.setup.start({...f.command,confirmed:false}),{code:'PUBLISH_CONFIG'});
 await f.setup.start(f.command);await f.publisher.save(f.config,'new');assert.equal((await run(f.queue)).error,'PUBLISH_STALE');
 assert.equal(f.remote.calls.filter(c=>c.method!=='GET').length,0);
});

test('existing empty repositories require an exact review and initialize only the chosen website branch',async t=>{
 const f=await fixture(t,{exists:true,defaultBranch:'master'}),saved=await f.publisher.save(f.config,'new');
 await assert.rejects(f.publisher.check({reviewExisting:true}),{code:'PUBLISH_EMPTY_REPO'});
 const review=await f.setup.review({configEtag:saved.etag});assert.equal(review.name,'example/notebook');assert.equal(review.branch,'main');assert.equal(review.private,true);
 assert.equal(f.remote.calls.some(c=>c.method!=='GET'),false);
 const command={review:review.id,configEtag:saved.etag,confirmed:true};
 await assert.rejects(f.setup.initialize({...command,confirmed:false}),{code:'PUBLISH_CONFIG'});
 const job=await f.setup.initialize(command);assert.equal((await f.setup.initialize(command)).id,job.id);
 const result=await run(f.queue);assert.equal(result.state,'completed');assert.equal(result.result.initialized,true);
 assert.equal((await f.publisher.read()).etag,saved.etag);assert.equal(f.remote.blobs.size,1);assert.equal([...f.remote.blobs.values()][0].length,0);
 assert.equal(f.remote.calls.some(c=>c.route==='/user/repos'||c.route.includes('/orgs/')||c.route.endsWith('/pages')),false);
 assert.equal(f.remote.calls.filter(c=>c.route.endsWith('/contents/.nojekyll')).length,1);
 assert.ok(f.remote.commits.get(f.remote.head).message.endsWith(job.id));
 assert.equal(f.remote.calls.find(c=>c.route.endsWith('/rename')).data.new_name,'main');
});

test('reviewed initialization rejects replaced repositories, new remote content and stale local settings',async t=>{
 for(const changed of ['identity','branch','tag','settings']){
  const f=await fixture(t,{exists:true}),saved=await f.publisher.save(f.config,'new'),review=await f.setup.review({configEtag:saved.etag});
  const job=await f.setup.initialize({review:review.id,configEtag:saved.etag,confirmed:true});
  if(changed==='identity')f.remote.setRepositoryId(456);
  if(changed==='branch')f.remote.seed({'research.txt':'Concurrent original'});
  if(changed==='tag')f.remote.setTags([{name:'release',commit:{sha:'b'.repeat(40)}}]);
  if(changed==='settings')await f.publisher.save({...f.config,publicUrl:'https://another.example/'},saved.etag);
  const result=await run(f.queue);assert.equal(result.state,'failed');assert.ok(['PUBLISH_OWNERSHIP','PUBLISH_STALE'].includes(result.error),result.error);
  assert.equal(f.remote.calls.filter(c=>c.method!=='GET').length,0,changed);assert.equal((await f.setup.read(job.id)).journal.seedAttempted,undefined);
 }
});

test('initialization refuses nonempty review and superseded review tokens without queuing writes',async t=>{
 const f=await fixture(t,{exists:true}),saved=await f.publisher.save(f.config,'new'),first=await f.setup.review({configEtag:saved.etag});
 await f.setup.review({configEtag:saved.etag});
 await assert.rejects(f.setup.initialize({review:first.id,configEtag:saved.etag,confirmed:true}),{code:'PUBLISH_STALE'});
 f.remote.setTags([{name:'existing'}]);await assert.rejects(f.setup.review({configEtag:saved.etag}),{code:'PUBLISH_OWNERSHIP'});
 f.remote.setTags([]);f.remote.seed({'notes.txt':'Preserve this'});await assert.rejects(f.setup.review({configEtag:saved.etag}),{code:'PUBLISH_OWNERSHIP'});
 assert.equal(await f.setup.current(),null);assert.equal(f.remote.calls.some(c=>c.method!=='GET'),false);
});

test('a concurrent first commit during initialization survives and prevents adopting the branch',async t=>{
 const f=await fixture(t,{exists:true}),saved=await f.publisher.save(f.config,'new'),review=await f.setup.review({configEtag:saved.etag});
 const job=await f.setup.initialize({review:review.id,configEtag:saved.etag,confirmed:true});let original;
 f.remote.setSetupBeforeHook(call=>{if(call.route.endsWith('/contents/.nojekyll'))original=f.remote.seed({'notes.txt':'Concurrent original'});});
 assert.equal((await run(f.queue)).error,'PUBLISH_OWNERSHIP');
 const current=f.remote.commits.get(f.remote.head),tree=f.remote.trees.get(current.tree);assert.deepEqual(current.parents,[original]);
 assert.equal(f.remote.blobs.get(tree.find(f=>f.path==='notes.txt').sha).toString(),'Concurrent original');
 const writes=f.remote.calls.filter(c=>c.method!=='GET').length;
 await f.queue.control(job.id,'retry');assert.equal((await run(f.queue)).error,'PUBLISH_OWNERSHIP');
 assert.equal(f.remote.calls.filter(c=>c.method!=='GET').length,writes);assert.equal(f.remote.calls.some(c=>c.route.endsWith('/rename')||c.data?.force),false);
});

test('an interrupted existing-repository initialization reconciles its own first commit after restart',async t=>{
 for(const tampered of [false,true]){
  const f=await fixture(t,{exists:true}),saved=await f.publisher.save(f.config,'new'),review=await f.setup.review({configEtag:saved.etag}),job=await f.setup.initialize({review:review.id,configEtag:saved.etag,confirmed:true});
  let once=true;f.remote.setSetupHook(c=>{if(once&&c.route.endsWith('/contents/.nojekyll')){once=false;throw Error('lost initialization response');}});
  assert.equal((await run(f.queue)).state,'failed');const initial=f.remote.head;assert.ok(initial);
  if(tampered)f.remote.commits.get(initial).message='Some other initialization';
  const publisher=new Publisher(f.workspace.root,{request:f.remote.request},f.vault),jobs=workspaceJobs(f.workspace,publisher);await publisher.connect(token);
  await jobs.queue.control(job.id,'retry');const result=await run(jobs.queue);assert.equal(result.state,tampered?'failed':'completed');
  if(tampered)assert.equal(result.error,'PUBLISH_OWNERSHIP');
  assert.equal(f.remote.head,initial);assert.equal(f.remote.calls.filter(c=>c.route.endsWith('/contents/.nojekyll')).length,1);
  assert.equal(f.remote.calls.some(c=>c.route.endsWith('/git/refs')||c.method==='PATCH'),false);
 }
});

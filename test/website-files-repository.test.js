import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {Publisher,defaultPublishing} from '../src/publishing.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {websiteFilesHttp} from '../src/website-files-http.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {repositoryFixture} from './github-fixture.js';

const token='synthetic_github_token_1234567890';
async function fixture(t,options){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-site-repository-')),f=await encryptedFixture(directory,sampleNotebook()),remote=repositoryFixture(options);
 const publisher=new Publisher(f.workspace.root,{request:remote.request},f.vault),jobs=workspaceJobs(f.workspace,publisher);await publisher.connect(token);
 t.after(async()=>{await jobs.worker.stop();await closeIdleMutationFiles();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:150});});
 const call=async(route,data={})=>{let answer;
  await websiteFilesHttp({method:'POST',headers:{}},new EventEmitter(),{url:new URL('/api/website-files/'+route,'https://website.test'),workspace:f.workspace,contextId:f.vault.id,title:'Field journal',body:async()=>data,check:async()=>{},preparation:async()=>({state:'ready'}),json:value=>{answer=value;},
   publisherOptions:{request:remote.request,connection:{summary:()=>({connected:true}),token:()=>token}},repositoryJobs:{queue:()=>jobs.queue,wake:()=>{},cancel:()=>{}}});
  return answer;};
 const config=defaultPublishing();Object.assign(config.github,{owner:'example',repository:'notebook',branch:'main',pages:true});
 return {...f,remote,publisher,jobs,call,config};
}
async function run(queue){const job=await queue.claim();assert.ok(job);try{const output=await queue.definition(job).prepare(job,{signal:new AbortController().signal,progress:p=>queue.pulse(job.id,job.lease.token,p)});return await queue.complete(job.id,job.lease.token,output);}catch(error){return queue.release(job.id,job.lease.token,{error});}}

test('a website made in the editor initializes its empty GitHub repository in its own destination',async t=>{
 const f=await fixture(t,{exists:true,defaultBranch:'master'}),{site}=await f.call('create',{name:'Field atlas'}),{site:other}=await f.call('create',{name:'Other atlas'});
 const saved=await f.call('destination/save',{siteId:site.id,config:f.config,etag:'new'});
 const review=await f.call('repository/review',{siteId:site.id,configEtag:saved.etag});assert.equal(review.name,'example/notebook');assert.equal(review.branch,'main');
 assert.equal(f.remote.calls.some(c=>c.method!=='GET'),false);
 const {job}=await f.call('repository/initialize',{siteId:site.id,review:review.id,configEtag:saved.etag,confirmed:true});
 // Another website cannot read or control this website's setup.
 await assert.rejects(f.call('repository/status',{siteId:other.id,id:job.id}),{code:'NOT_FOUND'});
 const result=await run(f.jobs.queue);assert.equal(result.state,'completed',JSON.stringify(result.error));assert.equal(result.result.initialized,true);
 assert.equal((await f.call('repository/status',{siteId:site.id,id:job.id})).job.state,'completed');
 assert.equal(f.remote.calls.filter(c=>c.route.endsWith('/contents/.nojekyll')).length,1);assert.equal(f.remote.calls.find(c=>c.route.endsWith('/rename')).data.new_name,'main');
 const destination=await f.call('destination',{siteId:site.id});assert.equal(destination.etag,saved.etag);assert.equal(destination.configured,true);
 assert.equal((await f.publisher.read()).configured,false,'the workspace-wide destination is untouched');
});
test('a website made in the editor creates a new repository and saves it as its destination',async t=>{
 const f=await fixture(t),{site}=await f.call('create',{name:'Field atlas'});
 await assert.rejects(f.call('repository/start',{siteId:site.id,config:f.config,etag:'new',visibility:'public',confirmed:false}),{code:'PUBLISH_CONFIG'});
 const {job}=await f.call('repository/start',{siteId:site.id,config:f.config,etag:'new',visibility:'public',confirmed:true});
 assert.equal((await f.call('repository/current',{siteId:site.id})).job.id,job.id);
 const result=await run(f.jobs.queue);assert.equal(result.state,'completed',JSON.stringify(result.error));
 assert.ok(f.remote.calls.some(c=>c.route==='/user/repos'&&c.data.private===false));
 const destination=await f.call('destination',{siteId:site.id});assert.equal(destination.configured,true);assert.equal(destination.config.github.repository,'notebook');assert.equal(destination.config.github.branch,'main');
 assert.equal((await f.publisher.read()).configured,false);
});

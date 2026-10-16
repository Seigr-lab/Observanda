import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../src/storage.js';
import {Publisher,defaultPublishing,validatePublishing} from '../src/publishing.js';
import {githubFilePlan,readGithubOwnership} from '../src/github-publication-plan.js';
import {buildPublication} from '../src/publication.js';
import {sampleNotebook} from '../src/sample.js';
import {githubFixture,sha} from './github-fixture.js';
import {truncatedGithubTrees} from './github-tree-fixture.js';

const token='synthetic_github_token_1234567890';
const tree=remote=>remote.trees.get(remote.commits.get(remote.head).tree);
const writes=remote=>remote.calls.filter(c=>c.method!=='GET');
async function fixture(t,{directory='',files={'index.html':'Existing site','README.md':'Keep this document','private.config':'Existing repository configuration'}}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-site-ownership-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const book=sampleNotebook();book.entries[1].share=false;book.entries[1].title='PRIVATE_BODY_SENTINEL';
 const ws=new Workspace(root),saved=await ws.create(book),candidate=buildPublication(saved.book);candidate.etag=saved.etag;
 const remote=githubFixture({branch:'main',initialFiles:files}),publisher=new Publisher(root,{request:remote.request}),config=defaultPublishing();
 Object.assign(config.github,{owner:'example',repository:'notebook',directory});const settings=await publisher.save(config,'new');await publisher.connect(token);
 return {ws,remote,publisher,config,candidate,etag:settings.etag,book:saved.book};
}
async function publish(f,candidate=f.candidate){
 const plan=await f.publisher.reviewDestination(candidate,f.etag);
 const receipt=await f.publisher.deploy(candidate,f.etag,f.book.id,{destinationReview:plan.id,destinationReviewed:true});return {plan,receipt};
}
function outsideEdit(remote,name,content){
 const parent=remote.head,entries=tree(remote).filter(e=>e.path!==name);
 if(content!==null){const bytes=Buffer.from(content),hash=sha('blob',bytes);remote.blobs.set(hash,bytes);entries.push({path:name,type:'blob',mode:'100644',sha:hash});}
 const root=sha('tree',Buffer.from(JSON.stringify(entries))),commit=sha('commit',Buffer.from(root+parent));remote.trees.set(root,entries);remote.commits.set(commit,{tree:root,parents:[parent]});remote.setHead(commit);
}

test('nested publication preserves unrelated paths and modes, stages only selected public bytes, and verifies its derived live URL',async t=>{
 const f=await fixture(t,{directory:'lab/field-notes'}),original=tree(f.remote);
 original.push({path:'assets/link',mode:'120000',type:'blob',sha:sha('blob',Buffer.from('../logo.svg'))},{path:'vendor/library',mode:'160000',type:'commit',sha:'f'.repeat(40)});
 const before=structuredClone(original),parent=f.remote.head,{plan,receipt}=await publish(f);
 assert.equal(plan.entries,undefined);assert.equal(plan.preservedEntries,undefined);
 assert.deepEqual(plan.removed,[]);assert.deepEqual(plan.conflicts,[]);assert.deepEqual(plan.preserved,before.map(e=>e.path));
 assert.deepEqual(tree(f.remote).filter(e=>!e.path.startsWith('lab/field-notes/')),before);assert.deepEqual(f.remote.commits.get(receipt.commit).parents,[parent]);
 const posted=f.remote.calls.find(c=>c.route.endsWith('/git/trees')&&c.method==='POST').data;
 assert.equal(posted.base_tree,f.remote.commits.get(parent).tree);assert.deepEqual(posted.tree.map(e=>e.path),[...f.candidate.files.keys()].map(name=>'lab/field-notes/'+name));
 for(const call of writes(f.remote).filter(c=>c.route.endsWith('/git/blobs'))){const bytes=Buffer.from(call.data.content,'base64');assert.ok([...f.candidate.files.values()].some(c=>Buffer.from(c).equals(bytes)));assert.ok(!bytes.includes(Buffer.from('PRIVATE_BODY_SENTINEL')));assert.ok(!bytes.includes(Buffer.from(f.ws.root)));}
 const ownership=await readGithubOwnership(f.publisher,f.config,receipt);assert.equal(ownership.files.length,f.candidate.files.size);
 const requested=[];f.publisher.request=async url=>{requested.push(String(url));const name=decodeURIComponent(new URL(url).pathname.slice('/notebook/lab/field-notes/'.length)),content=f.candidate.files.get(name);return new Response(content??'',{status:content===undefined?404:200});};
 const verified=await f.publisher.verifyLive();assert.equal(verified.verification.files,f.candidate.files.size);assert.ok(requested.every(url=>url.startsWith('https://example.github.io/notebook/lab/field-notes/')));
});

test('concurrent repository work after tree creation survives and requires a fresh review',async t=>{
 const f=await fixture(t,{directory:'research'}),plan=await f.publisher.reviewDestination(f.candidate,f.etag);let changed=false;
 f.remote.setHook((call,phase)=>{if(!changed&&phase==='after'&&call.route.endsWith('/git/trees')&&call.method==='POST'){changed=true;outsideEdit(f.remote,'news/concurrent.html','Concurrent author');}});
 await assert.rejects(f.publisher.deploy(f.candidate,f.etag,f.book.id,{destinationReview:plan.id,destinationReviewed:true}),{code:'PUBLISH_STALE'});
 const concurrent=f.remote.head;assert.equal(writes(f.remote).some(c=>c.route.includes('/git/refs')),false);
 f.remote.setHook(null);const next=await publish(f);assert.ok(next.plan.preserved.includes('news/concurrent.html'));assert.deepEqual(f.remote.commits.get(f.remote.head).parents,[concurrent]);
});

test('a later edition removes only previously owned files and preserves intervening repository additions',async t=>{
 const f=await fixture(t,{directory:'research'});await publish(f);
 outsideEdit(f.remote,'research/handwritten.html','A separately maintained page');outsideEdit(f.remote,'news/latest.html','Unrelated news');
 const before=tree(f.remote).filter(e=>['research/handwritten.html','news/latest.html'].includes(e.path));
 const saved=await f.ws.read(),entry=saved.book.entries.find(e=>e.share);assert.ok(entry);entry.share=false;
 const next=await f.ws.save(saved.book,saved.etag),candidate=buildPublication(next.book);candidate.etag=next.etag;
 const {plan}=await publish(f,candidate);
 assert.ok(plan.removed.includes('research/entries/'+entry.id+'.html'));assert.ok(plan.requiresReview);
 assert.deepEqual(tree(f.remote).filter(e=>before.some(b=>b.path===e.path)),before);
 const posted=f.remote.calls.filter(c=>c.route.endsWith('/git/trees')&&c.method==='POST').at(-1).data;
 assert.deepEqual(posted.tree.filter(e=>e.sha===null).map(e=>e.path).sort(),plan.removed.sort());assert.equal(tree(f.remote).some(e=>e.path==='research/entries/'+entry.id+'.html'),false);
});

test('unowned root files and changed or deleted owned files block every write even with review approval',async t=>{
 const root=await fixture(t),rootPlan=await root.publisher.reviewDestination(root.candidate,root.etag);assert.ok(rootPlan.conflicts.includes('index.html'));
 await assert.rejects(root.publisher.deploy(root.candidate,root.etag,root.book.id,{destinationReview:rootPlan.id,destinationReviewed:true}),{code:'PUBLISH_CONFLICT'});assert.equal(writes(root.remote).length,0);
 for(const content of ['An outside edit',null]){
  const f=await fixture(t,{directory:'research'});await publish(f);outsideEdit(f.remote,'research/styles.css',content);
  const before=writes(f.remote).length,plan=await f.publisher.reviewDestination(f.candidate,f.etag);assert.ok(plan.conflicts.includes('research/styles.css'));
  await assert.rejects(f.publisher.deploy(f.candidate,f.etag,f.book.id,{destinationReview:plan.id,destinationReviewed:true}),{code:'PUBLISH_CONFLICT'});assert.equal(writes(f.remote).length,before);
 }
});

test('file and directory collisions, symlinks, submodules and case aliases cannot be silently replaced',async()=>{
 const candidate={files:new Map([['index.html','Public page']])};
 for(const [path,mode,type] of [['research','100644','blob'],['research','120000','blob'],['research','160000','commit'],['research/index.html/child','100644','blob'],['research/INDEX.html','100644','blob']]){
  const plan=await githubFilePlan(candidate,[{path,mode,type,sha:'a'.repeat(40)}],null,'research');assert.ok(plan.conflicts.includes(path),path);
 }
 for(const directory of ['../research','/research','research/','research//pages','research/.git','research/../pages','research\\pages','research?x','research#anchor','research/%2fpages']){
  const config=defaultPublishing();Object.assign(config.github,{owner:'example',repository:'notebook',directory});assert.throws(()=>validatePublishing(config),{code:'PUBLISH_CONFIG'});
 }
});

test('repository replacement, truncated trees and mismatched preserved files never move the branch',async t=>{
 for(const kind of ['identity','truncated','corrupt-tree']){
  const f=await fixture(t,{directory:'research'}),plan=await f.publisher.reviewDestination(f.candidate,f.etag),request=f.publisher.request,parent=f.remote.head;
  f.publisher.request=async(url,options)=>{
   const result=await request(url,options),route=new URL(url).pathname;
   if(kind==='identity'&&route==='/repos/example/notebook')return new Response(JSON.stringify({id:456,permissions:{push:true},default_branch:'main'}));
   if(kind==='truncated'&&/\/git\/trees\//.test(route))return new Response(JSON.stringify({tree:[],truncated:true}));
   if(kind==='corrupt-tree'&&/\/git\/trees\//.test(route)){const value=await result.json();value.tree=value.tree.filter(e=>e.path!=='README.md');return new Response(JSON.stringify(value));}
   return result;
  };
  await assert.rejects(f.publisher.deploy(f.candidate,f.etag,f.book.id,{destinationReview:plan.id,destinationReviewed:true}),{code:kind==='identity'?'PUBLISH_STALE':kind==='truncated'?'PUBLISH_TREE_INCOMPLETE':'PUBLISH_REMOTE'});
  assert.equal(f.remote.head,parent);assert.equal(writes(f.remote).some(c=>c.route.includes('/git/refs')),false);
 }
});

test('review and deployment traverse truncated remote trees beyond ten thousand files and retain unrelated content',async t=>{
 const files=Object.fromEntries(Array.from({length:10017},(_,i)=>['archive/'+i+'.txt','Existing '+i])),f=await fixture(t,{directory:'research',files}),before=structuredClone(tree(f.remote)),adapter=truncatedGithubTrees(f.remote,{threshold:8});
 f.publisher.request=adapter.request;
 const {plan,receipt}=await publish(f);assert.equal(plan.preserved.length,10017);assert.deepEqual(plan.conflicts,[]);
 assert.equal(receipt.status,'uploaded-repository-only');assert.deepEqual(sorted(tree(f.remote).filter(e=>e.path.startsWith('archive/'))),sorted(before));
 assert.ok(adapter.reads.some(route=>!route.includes('?')));const next=await f.publisher.reviewDestination(f.candidate,f.etag);assert.deepEqual(next.conflicts,[]);assert.equal(next.unchanged.length,f.candidate.files.size);
});
const sorted=files=>[...files].sort((a,b)=>a.path.localeCompare(b.path));

test('review capacity refusal leaves the saved review and prepared edition available without remote writes',async t=>{
 const f=await fixture(t,{directory:'research'}),prior=await f.publisher.reviewDestination(f.candidate,f.etag),parent=f.remote.head,root='d'.repeat(40),head='e'.repeat(40);
 f.remote.trees.set(root,Array.from({length:2600},(_,i)=>({path:'archive/'+i+'/'+'x'.repeat(3800),type:'blob',mode:'100644',sha:'f'.repeat(40)})));
 f.remote.commits.set(head,{tree:root,parents:[parent]});f.remote.setHead(head);
 await assert.rejects(f.publisher.reviewDestination(f.candidate,f.etag),{code:'PUBLISH_PLAN_CAPACITY'});
 assert.equal(writes(f.remote).length,0);assert.equal(f.remote.head,head);
 const saved=await f.publisher.readDestinationPlan(f.candidate,f.etag,{destinationReview:prior.id,destinationReviewed:true});assert.equal(saved.id,prior.id);assert.equal(saved.releaseId,f.candidate.id);
});

test('cancelled subtree review preserves the previous review and stops requesting directories',async t=>{
 const f=await fixture(t,{directory:'research'}),prior=await f.publisher.reviewDestination(f.candidate,f.etag),adapter=truncatedGithubTrees(f.remote,{threshold:1}),controller=new AbortController();let calls=0;
 f.publisher.request=async(url,options)=>{calls++;const result=await adapter.request(url,options);if(/\/git\/trees\/[a-f0-9]+$/.test(String(url)))controller.abort();return result;};
 await assert.rejects(f.publisher.reviewDestination(f.candidate,f.etag,{signal:controller.signal}),{name:'AbortError'});
 const stopped=calls;await assert.rejects(f.publisher.reviewDestination(f.candidate,f.etag,{signal:controller.signal}),{name:'AbortError'});assert.equal(calls,stopped);assert.equal(writes(f.remote).length,0);
 assert.equal((await f.publisher.readDestinationPlan(f.candidate,f.etag,{destinationReview:prior.id,destinationReviewed:true})).id,prior.id);
});

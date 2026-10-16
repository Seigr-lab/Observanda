import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { Publisher, defaultPublishing, validatePublishing } from '../src/publishing.js';
import { Workspace, digest, serialize } from '../src/storage.js';
import { sampleNotebook } from '../src/sample.js';
import { buildPublication } from '../src/publication.js';
import {githubFixture as mainGithubFixture} from './github-fixture.js';
const sha = (type, bytes) => createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
const token = 'synthetic_session_secret_1234567890';
async function setup(options) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'observanda-publisher-')), ws = new Workspace(root);
  const saved = await ws.create(sampleNotebook()), candidate = buildPublication(saved.book); candidate.etag = saved.etag;
  return { root, ws, candidate, owner: saved.book.id, publisher: new Publisher(root, options) };
}
const githubFixture=mainGithubFixture;

test('publishing settings validate targets, reject unknown secret fields and remain outside publication', async () => {
  const s = await setup(), config = defaultPublishing(); Object.assign(config.github, { owner: 'example', repository: 'notebook', branch: 'observanda-site', pages: true });
  const saved = await s.publisher.save(config, 'new');
  assert.equal(saved.connected, false); assert.equal(saved.config.github.repository, 'notebook');
  await assert.rejects(s.publisher.save(config, 'new'), { code: 'PUBLISH_STALE' });
  for (const bad of [{ ...config, token }, { ...config, publicUrl: 'https://user:secret@example.org/' }, { ...config, github: { ...config.github, owner: '../escape' } }]) assert.throws(() => validatePublishing(bad), { code: 'PUBLISH_CONFIG' });
  const ssh = defaultPublishing(); ssh.kind = 'ssh'; Object.assign(ssh.ssh, { host: 'host.example', user: 'research', directory: '/srv/observanda' });
  validatePublishing(ssh);
  for (const directory of ['/', '/srv/../private', '/srv/test;whoami', '/srv/test\n']) assert.throws(() => validatePublishing({ ...ssh, ssh: { ...ssh.ssh, directory } }));
  assert.ok(![...s.candidate.files.values()].join('').includes('publishing.json'));
});

test('GitHub upload sends only reviewed bytes, verifies hashes, and extends only the owned publication branch', async () => {
  const fixture = githubFixture(), s = await setup({ request: fixture.request });
  const config = defaultPublishing(); Object.assign(config.github, { owner: 'example', repository: 'notebook', branch: 'observanda-site', pages: true });
  const saved = await s.publisher.save(config, 'new'); await s.publisher.connect(token);
  const receipt = await s.publisher.deploy(s.candidate, saved.etag, s.owner);
  assert.equal(receipt.status, 'uploaded-awaiting-pages');
  const firstCommit = fixture.calls.find(c => c.route.endsWith('/git/commits')).data;
  assert.deepEqual(firstCommit.parents, []);
  for (const content of s.candidate.files.values()) assert.ok(fixture.blobs.has(sha('blob', Buffer.from(content))));
  const disk = await readFile(path.join(s.root, '.observanda', 'publishing.json'), 'utf8'); assert.ok(!disk.includes(token));
  const again = await s.publisher.deploy(s.candidate, saved.etag, s.owner);
  const commits = fixture.calls.filter(c => c.route.endsWith('/git/commits'));
  assert.deepEqual(commits[1].data.parents, [receipt.commit]);
  assert.ok(fixture.calls.some(c => c.method === 'PATCH' && c.data.force === false));
  fixture.setHead('b'.repeat(40));
  const writes = fixture.calls.filter(c => c.method !== 'GET').length;
  await assert.rejects(s.publisher.deploy(s.candidate, saved.etag, s.owner), { code: 'PUBLISH_OWNERSHIP' });
  assert.equal(fixture.calls.filter(c => c.method !== 'GET').length, writes);
  assert.notEqual(again.commit, receipt.commit);
});

test('changed content or destination blocks publishing before network writes', async () => {
  const fixture = githubFixture(), s = await setup({ request: fixture.request });
  const config = defaultPublishing(); Object.assign(config.github, { owner: 'example', repository: 'notebook', branch: 'observanda-site', pages: true });
  const saved = await s.publisher.save(config, 'new'); await s.publisher.connect(token);
  await assert.rejects(s.publisher.deploy(s.candidate, 'old', s.owner), { code: 'PUBLISH_STALE' });
  const current = await s.ws.read(); current.book.title = 'New edit'; await s.ws.save(current.book, current.etag);
  await assert.rejects(s.publisher.deploy(s.candidate, saved.etag, s.owner), { code: 'STALE' });
  assert.equal(fixture.calls.length, 1);
});

test('repository-only upload makes no Pages requests and changing Pages policy preserves branch ownership',async()=>{
 const remote=githubFixture(),s=await setup({request:remote.request}),config=defaultPublishing();
 Object.assign(config.github,{owner:'example',repository:'notebook',branch:'observanda-site'});
 assert.equal(config.github.pages,false);const saved=await s.publisher.save(config,'new');await s.publisher.connect(token);
 assert.match((await s.publisher.check()).message,/Upload only/);
 const first=await s.publisher.deploy(s.candidate,saved.etag,s.owner);
 assert.equal(first.status,'uploaded-repository-only');assert.equal(remote.calls.some(c=>c.route.endsWith('/pages')),false);
 const legacy=structuredClone(config);delete legacy.github.pages;validatePublishing(legacy);
 assert.equal(s.publisher.destinationKey(legacy),s.publisher.destinationKey(config));
 const reordered={...legacy,github:{branch:legacy.github.branch,repository:legacy.github.repository,owner:legacy.github.owner}};
 assert.equal(s.publisher.destinationKey({...reordered,github:{...reordered.github,pages:false}}),digest(serialize({kind:'github',destination:reordered.github})));
 for(const value of [null,'false',0,{},[]])assert.throws(()=>validatePublishing({...config,github:{...config.github,pages:value}}),{code:'PUBLISH_CONFIG'});
 const next=await s.publisher.save({...config,github:{...config.github,pages:true}},saved.etag);
 assert.equal(next.receipt.commit,first.commit);
 const second=await s.publisher.deploy(s.candidate,next.etag,s.owner);
 assert.equal(second.status,'uploaded-awaiting-pages');assert.ok(remote.calls.some(c=>c.route.endsWith('/pages')&&c.method==='POST'));
 assert.deepEqual(remote.calls.filter(c=>c.route.endsWith('/git/commits')).at(-1).data.parents,[first.commit]);
});

test('an empty GitHub repository is reported before any remote writes',async()=>{
 const remote=githubFixture(),s=await setup({request:(url,options)=>new URL(url).pathname.includes('/git/ref/')?new Response(JSON.stringify({message:'Git Repository is empty.'}),{status:409}):remote.request(url,options)});
 const config=defaultPublishing();Object.assign(config.github,{owner:'example',repository:'notebook',branch:'observanda-site'});
 const saved=await s.publisher.save(config,'new');await s.publisher.connect(token);
 await assert.rejects(s.publisher.check(),{code:'PUBLISH_EMPTY_REPO'});
 await assert.rejects(s.publisher.deploy(s.candidate,saved.etag,s.owner),{code:'PUBLISH_EMPTY_REPO'});
 assert.equal(remote.calls.filter(c=>c.method!=='GET').length,0);
});

test('reviewing existing main pins its parent and Pages source, then subsequent uploads keep both',async()=>{
 const remote=mainGithubFixture({branch:'main',initialFiles:{'.nojekyll':'','README.md':'Old website introduction'},initialPages:{build_type:'legacy',source:{branch:'old-site',path:'/docs'}}}),s=await setup({request:remote.request}),config=defaultPublishing();
 Object.assign(config.github,{owner:'example',repository:'notebook',pages:true});assert.equal(config.github.branch,'main');
 const saved=await s.publisher.save(config,'new');await s.publisher.connect(token);const initial=remote.head;
 await assert.rejects(s.publisher.deploy(s.candidate,saved.etag,s.owner),{code:'PUBLISH_OWNERSHIP'});
 const plan=await s.publisher.reviewDestination(s.candidate,saved.etag);
 assert.equal(plan.requiresReview,true);assert.equal(plan.head,initial);assert.deepEqual(plan.removed,[]);assert.deepEqual(plan.preserved,['README.md']);assert.ok(plan.added.includes('index.html'));
 await assert.rejects(s.publisher.deploy(s.candidate,saved.etag,s.owner,{destinationReview:plan.id}),{code:'PUBLISH_STALE'});
 assert.equal(remote.calls.filter(c=>c.method!=='GET').length,0);
 const first=await s.publisher.deploy(s.candidate,saved.etag,s.owner,{destinationReview:plan.id,destinationReviewed:true});
 assert.deepEqual(remote.commits.get(first.commit).parents,[initial]);assert.ok(remote.calls.some(c=>c.route.endsWith('/pages')&&c.method==='PUT'&&c.data.source.branch==='main'));
 const secondPlan=await s.publisher.reviewDestination(s.candidate,saved.etag);assert.equal(secondPlan.requiresReview,false);
 const second=await s.publisher.deploy(s.candidate,saved.etag,s.owner,{destinationReview:secondPlan.id});assert.deepEqual(remote.commits.get(second.commit).parents,[first.commit]);
 assert.equal(remote.calls.filter(c=>c.route.endsWith('/pages')&&c.method!=='GET').length,1);assert.equal(remote.calls.some(c=>c.route.endsWith('/git/refs')&&c.method==='POST'),false);
 config.publicUrl='https://public.example/research/';await s.publisher.save(config,saved.etag);remote.setManifest(s.candidate.files.get('publication.json'));
 assert.equal((await s.publisher.verifyLive()).verification.files,s.candidate.files.size);
 const verified=await s.publisher.read();assert.equal(verified.receipt.verification.configEtag,verified.etag);
 const changed=await s.publisher.save({...verified.config,publicUrl:'https://public.example/another-address/'},verified.etag);assert.equal(changed.receipt.verification,undefined);assert.equal(changed.receipt.commit,verified.receipt.commit);
 await assert.rejects(s.publisher.verifyLive(),{code:'PUBLISH_NOT_LIVE'});assert.equal((await s.publisher.read()).receipt.verification.failed,true);
 await s.publisher.save(verified.config,changed.etag);
 remote.setServed('styles.css','tampered stylesheet');await assert.rejects(s.publisher.verifyLive(),{code:'PUBLISH_NOT_LIVE'});
 assert.equal((await s.publisher.read()).receipt.verification.failed,true);assert.equal((await s.publisher.read()).receipt.verification.files,undefined);
});

test('a changed main branch or Pages source invalidates approval before any upload',async()=>{
 for(const change of ['head','pages']){
  const remote=mainGithubFixture({branch:'main',initialFiles:{'.nojekyll':''}}),s=await setup({request:remote.request}),config=defaultPublishing();Object.assign(config.github,{owner:'example',repository:'notebook',pages:true});
  const saved=await s.publisher.save(config,'new');await s.publisher.connect(token);const plan=await s.publisher.reviewDestination(s.candidate,saved.etag);
  if(change==='head')remote.setHead('c'.repeat(40));
  else{const request=s.publisher.request;s.publisher.request=(url,options)=>new URL(url).pathname.endsWith('/pages')?new Response(JSON.stringify({build_type:'workflow',source:null})):request(url,options);}
  await assert.rejects(s.publisher.deploy(s.candidate,saved.etag,s.owner,{destinationReview:plan.id,destinationReviewed:true}),{code:'PUBLISH_STALE'});
  assert.equal(remote.calls.filter(c=>c.method!=='GET').length,0);
 }
});

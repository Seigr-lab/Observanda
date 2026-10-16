import { test } from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startServer } from '../src/server.js';
import { Workspace } from '../src/storage.js';
import { sampleNotebook } from '../src/sample.js';

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'observanda-http-'));
  const ws = new Workspace(root); await ws.create(sampleNotebook());
  const app = await startServer({ root, port: 0 }); t.after(() => app.close());
  const auth = await fetch(app.origin + '/api/session', { method: 'POST', headers: { Origin: app.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: app.launchToken }) });
  const cookie = auth.headers.get('set-cookie').split(';')[0];
  const request = (route, data) => fetch(app.origin + route, { headers: { Cookie: cookie, Origin: app.origin, 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }) });
  return { ...app, ws, request, cookie };
}

test('loopback service requires session, expected Host, and same-origin mutations', async t => {
  const app = await setup(t);
  assert.equal((await fetch(app.origin + '/api/notebook')).status, 401);
  // fetch normalizes Host. Use the HTTP client to send the hostile header unchanged.
  const hostileStatus = await new Promise((resolve, reject) => {
    const req = http.get(app.origin + '/api/notebook', { headers: { Host: 'attacker.invalid' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(hostileStatus, 403);
  assert.equal((await fetch(app.origin + '/api/preview', { method: 'POST', headers: { Cookie: app.cookie, Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(app.origin + '/api/session', { method: 'POST', headers: { Origin: app.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'é'.repeat(64) }) })).status, 401);
  assert.equal((await app.request('/api/notebook')).status, 200);
  const traversal = await fetch(app.origin + '/observanda.json'); assert.equal(traversal.status, 401);
});

test('HTTP preview/download use a pinned candidate and reject stale saves', async t => {
  const app = await setup(t), current = await (await app.request('/api/notebook')).json();
  const response = await app.request('/api/preview', { etag: current.etag }); assert.equal(response.status, 200);
  const candidate = await response.json();
  assert.equal((await app.request(candidate.url)).status, 200);
  assert.equal((await app.request('/api/export', { id: candidate.id })).headers.get('content-type'), 'application/zip');
  current.book.description = 'Changed after preview'; assert.equal((await app.request('/api/notebook/save', current)).status,200);
  assert.equal((await app.request('/api/export', { id: candidate.id })).status, 409);
});

test('privacy rejection occurs before serving a candidate; response never echoes the private path', async t => {
  const app = await setup(t), current = await (await app.request('/api/notebook')).json();
  current.book.entries[0].body = '/home/synthetic-person/private-capture';
  const saved = await (await app.request('/api/notebook/save', current)).json();
  const response = await app.request('/api/preview', { etag: saved.etag });
  assert.equal(response.status, 422);
  const message = await response.text(); assert.ok(!message.includes('synthetic-person')); assert.ok(message.includes('PRIVACY'));
});

test('design preview is synthetic and cannot be exported as a reviewed notebook', async t => {
  const app = await setup(t), current = await app.ws.read();
  const preview = await (await app.request('/api/design-preview', { appearance: current.book.appearance })).json();
  const html = await (await app.request(preview.url)).text(); assert.ok(html.includes('fictional sample content'));
  const id = preview.url.split('/')[2];
  assert.equal((await app.request('/api/export', { id })).status, 409);
});


test('late design previews cannot overwrite a reviewed publication candidate', async t => {
  const app = await setup(t), current = await (await app.request('/api/notebook')).json();
  const candidate = await (await app.request('/api/preview', { etag: current.etag })).json();
  for (let i = 0; i < 4; i++) {
    const design = await (await app.request('/api/design-preview', { book: current.book })).json();
    assert.notEqual(design.url.split('/')[2], candidate.id);
  }
  assert.equal((await app.request('/api/export', { id: candidate.id })).status, 200);
});


test('empty website defaults to design examples without changing saved content or allowing their export',async t=>{
  const app=await setup(t), current=await app.ws.read();current.book.projects[0].share=false;
  const saved=await app.ws.save(current.book,current.etag), before=await app.ws.read();
  const response=await app.request('/api/design-preview',{book:saved.book});assert.equal(response.status,200);
  const preview=await response.json();assert.equal(preview.source,'examples');assert.ok(preview.pages.length>4);
  const html=await (await app.request(preview.url)).text();assert.ok(html.includes('fictional sample content'));assert.ok(html.includes('<audio'));assert.ok(html.includes('<video'));
  assert.equal((await app.ws.read()).etag,before.etag);
  assert.equal((await app.request('/api/export',{id:preview.url.split('/')[2]})).status,409);
  assert.equal((await app.request('/api/publishing/deploy',{id:preview.url.split('/')[2],reviewed:true})).status,422);
  const actual=await (await app.request('/api/preview',{etag:before.etag})).json();
  const actualHtml=await (await app.request(actual.url)).text();assert.ok(!actualHtml.includes('fictional sample content'));assert.ok(!actualHtml.includes('Example research collective'));
});

test('reviewed workspace changes are atomic, retain prior revisions and reject a stale plan',async t=>{
  const app=await setup(t), original=await app.ws.read(), change={workspaceTitle:original.book.title,workspaceDescription:'Broader context',projectId:original.book.projects[0].id,copyLogos:false};
  const plan=await (await app.request('/api/workspace/reorganize/preview',{etag:original.etag,change})).json();
  assert.equal(plan.summary.projectTitle,original.book.title);assert.equal((await app.ws.read()).etag,original.etag);
  assert.equal((await app.request('/api/workspace/reorganize',{etag:original.etag,change,reviewed:false})).status,422);
  const response=await app.request('/api/workspace/reorganize',{etag:original.etag,change,reviewed:true});assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.book.title,original.book.title);assert.deepEqual(result.book.entries,original.book.entries);
  assert.ok((await app.ws.history()).some(r=>r.id===original.etag));
  assert.equal((await app.request('/api/workspace/reorganize',{etag:plan.etag,change,reviewed:true})).status,409);
  assert.equal((await app.ws.read()).etag,result.etag);
});


test('review refuses a title-only empty site while allowing an authored standalone home and counting only effective selection',async t=>{
 const app=await setup(t),current=await app.ws.read(),b=current.book;
 b.description='';b.projects.forEach(p=>p.share=false);const empty=await app.ws.save(b,current.etag);
 const rejected=await app.request('/api/preview',{etag:empty.etag});assert.equal(rejected.status,422);assert.equal((await rejected.json()).code,'PUBLICATION_EMPTY');
 empty.book.website.description='A standalone studio introduction.';const written=await app.ws.save(empty.book,empty.etag);
 const result=await app.request('/api/preview',{etag:written.etag});assert.equal(result.status,200);const review=await result.json();assert.deepEqual(review.summary,{projects:0,notebooks:0,records:0,pages:0,media:0});
 const home=await app.request(review.url);assert.ok((await home.text()).includes('A standalone studio introduction.'));
});


test('private page design previews preserve visibility and cannot be exported, published or read without a session',async t=>{
 const app=await setup(t),current=await app.ws.read();const page={id:'dded7926-2fd4-4f92-8712-8fb3ab4f644a',title:'Private design',body:'Unreleased page text',share:false,sections:[]};current.book.pages.push(page);await app.ws.save(current.book,current.etag);const original=await app.ws.read();
 const response=await app.request('/api/design-preview',{mode:'website',book:original.book,designPageId:page.id});assert.equal(response.status,200);const preview=await response.json();const url=preview.baseUrl+'pages/'+page.id+'.html';assert.match(await (await app.request(url)).text(),/Unreleased page text/);assert.equal((await fetch(app.origin+url)).status,401);assert.equal((await app.request('/api/export/'+preview.baseUrl.split('/')[2])).status,409);const refused=await app.request('/api/publishing/deploy',{id:preview.baseUrl.split('/')[2],reviewed:true});assert.equal(refused.status,422);assert.equal((await refused.json()).code,'PUBLISH_STALE');const after=await app.ws.read();assert.equal(after.etag,original.etag);assert.equal(after.book.pages[0].share,false);
 const publicResult=await app.request('/api/preview',{etag:after.etag});assert.equal(publicResult.status,200);const release=await publicResult.json();assert.ok(!release.pages.some(p=>p.path==='pages/'+page.id+'.html'));assert.equal((await app.request('/api/layout-check',{format:'observanda-page-layout',version:1,name:'Unsafe',sections:[{id:'text',kind:'text',title:'',body:'C:/Users/private',show:true}]})).status,422);
});


test('a reviewed draft is immutable and downloadable without saving, with conflict and workspace checks',async t=>{
 const app=await setup(t),current=await app.ws.read(),draft=structuredClone(current.book);draft.website.description='An unsaved public introduction';
 const response=await app.request('/api/preview',{etag:current.etag,book:draft});assert.equal(response.status,200);const candidate=await response.json();
 assert.equal((await app.ws.read()).etag,current.etag);assert.match(await(await app.request(candidate.url)).text(),/An unsaved public introduction/);
 draft.website.description='A subsequent edit';assert.doesNotMatch(await(await app.request(candidate.url)).text(),/A subsequent edit/);
 assert.equal((await app.request('/api/export',{id:candidate.id})).status,200);
 const other=structuredClone(draft);other.id=sampleNotebook().id;assert.equal((await app.request('/api/preview',{etag:current.etag,book:other})).status,422);
 current.book.title='Another saved revision';await app.ws.save(current.book,current.etag);
 assert.equal((await app.request('/api/preview',{etag:current.etag,book:draft})).status,409);assert.equal((await app.request('/api/export',{id:candidate.id})).status,409);
});

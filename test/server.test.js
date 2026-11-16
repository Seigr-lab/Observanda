import { test } from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {testServer as startServer} from './device-fixture.js';
import { Workspace } from '../src/storage.js';
import { sampleNotebook } from '../src/sample.js';

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'observanda-http-'));
  const ws = new Workspace(root); await ws.create(sampleNotebook());
  const app = await startServer({ root, port: 0 }); t.after(() => app.close());
  const auth = await fetch(app.origin + '/api/session', { method: 'POST', headers: { Origin: app.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: app.launchToken }) });
  const cookie = auth.headers.get('x-observanda-session').split(';')[0];
  const request = (route, data) => fetch(app.origin + route, { headers: { 'X-Observanda-Session': cookie, Origin: app.origin, 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }) });
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
  assert.equal((await fetch(app.origin + '/api/workspace/save', { method: 'POST', headers: { 'X-Observanda-Session': app.cookie, Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(app.origin + '/api/session', { method: 'POST', headers: { Origin: app.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'é'.repeat(64) }) })).status, 401);
  assert.equal((await app.request('/api/notebook')).status, 200);
  const traversal = await fetch(app.origin + '/observanda.json'); assert.equal(traversal.status, 401);
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


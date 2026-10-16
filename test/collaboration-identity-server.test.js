import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {collaborationFixture} from './fixtures/collaboration.js';
import {CollaborationRecovery} from '../src/collaboration/identity-recovery.js';
import {startServer} from '../src/server.js';

test('identity recovery routes authenticate locally, stop hosting, exclude other instances and leave research locked',{timeout:60000},async t=>{
 const f=await collaborationFixture(t),apps=[];t.after(async()=>{const results=await Promise.allSettled(apps.map(app=>app.close()));for(const result of results)if(result.status==='rejected')throw result.reason;});
 const start=async suffix=>{const app=await startServer({root:f.author.workspace.root,port:0,headless:true,deviceStore:f.author.deviceStore,preferencesFile:path.join(f.directory,suffix+'.prefs')});apps.push(app);return app;};
 const app=await start('identity-server'),origin=app.origin,base=origin+'/api/security/collaboration-identity/';
 assert.equal((await fetch(base+'state',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'})).status,401);
 const session=await fetch(origin+'/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})}),cookie=session.headers.get('set-cookie').split(';')[0],headers={Origin:origin,'Content-Type':'application/json',Cookie:cookie};
 const storage=await (await fetch(origin+'/api/storage',{headers})).json(),contextId=storage.contextId;
 const post=(url,data={},extra={})=>fetch(origin+url,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(data),signal:AbortSignal.timeout(15000)});
 const request=(op,data={},extra={})=>post('/api/security/collaboration-identity/'+op,{contextId,...data},extra);
 const code=async(response,expected)=>assert.equal((await response.json()).code,expected);
 assert.equal((await request('state',{}, {Origin:'https://untrusted.example'})).status,403);
 await code(await request('state',{contextId:randomUUID()}),'WORKSPACE_CHANGED');
 await code(await request('state',{extra:true}),'INVALID');
 const initial=await (await request('state')).json();assert.ok(!JSON.stringify(initial).includes('protectedKey'));
 const password='Synthetic server identity backup password',exported=await (await request('backup',{password,confirmation:password})).json();assert.equal(exported.identity.signing.id,initial.current.signing.id);
 const before=await (await request('state')).json(); // First backup creates the exchange key if it has never been needed.
 const incoming=await new CollaborationRecovery(f.member.deviceStore).backup(password,password),restore={file:incoming.file,password,expected:before.etag,verified:incoming.identity.id};
 await code(await request('restore',restore),'COLLABORATION_IDENTITY_LOCK');
 const host=await post('/api/live/start',{workspaceId:f.book.id,host:'127.0.0.1',endpoint:'https://127.0.0.1',port:0});assert.equal(host.status,200,JSON.stringify(await host.json()));
 const accessBefore=await readFile(f.author.deviceStore.file),records=await f.author.workspace.read(),authority=await f.state();
 assert.equal((await post('/api/access/lock')).status,200);
 await code(await request('backup',{password,confirmation:password}),'ACCESS_LOCKED');
 const review=await (await request('inspect',{file:incoming.file,password})).json();assert.equal(review.identity.id,incoming.identity.id);
 const other=await start('other-identity-server');await code(await request('restore',restore),'COLLABORATION_IDENTITY_BUSY');assert.deepEqual(await new CollaborationRecovery(f.author.deviceStore).state(),before);await other.close();
 const restored=await request('restore',restore);assert.equal(restored.status,200,JSON.stringify(await restored.clone().json()));assert.equal((await restored.json()).current.signing.id,incoming.identity.signing.id);
 assert.equal((await fetch(origin+'/api/access/status',{headers}).then(r=>r.json())).locked,true);
 assert.equal((await fetch(origin+'/api/notebook',{headers})).status,401);
 assert.deepEqual(await readFile(f.author.deviceStore.file),accessBefore);assert.deepEqual(await f.author.workspace.read(),records);assert.deepEqual(await f.state(),authority);
 assert.equal((await post('/api/access/unlock')).status,200);const live=await (await post('/api/live/state',{workspaceId:f.book.id})).json();assert.equal(live.hosting,null);
});

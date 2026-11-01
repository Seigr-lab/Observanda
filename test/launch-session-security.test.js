import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {testServer as startServer} from './device-fixture.js';

test('launch redemption mints one session, with replay restricted to the original browser binding',async t=>{
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-launch-session-')),app=await startServer({port:0,headless:true,preferencesFile:path.join(directory,'preferences')});
 t.after(async()=>{await app.close();assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-launch-session-'));await rm(directory,{recursive:true,force:true});});
 const request=data=>fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
 const token=app.launchToken,first=await request({token});assert.equal(first.status,200);await first.json();assert.equal((await request({token})).status,401);
 const bound=app.launchToken,binding='b'.repeat(64),responses=await Promise.all([request({token:bound,binding}),request({token:bound,binding})]);
 assert.deepEqual(responses.map(response=>response.status),[200,200]);assert.equal(responses[0].headers.get('set-cookie'),responses[1].headers.get('set-cookie'));for(const response of responses)await response.json();
 assert.equal((await request({token:bound,binding:'c'.repeat(64)})).status,401);assert.equal((await request({token:bound})).status,401);
});

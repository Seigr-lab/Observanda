import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {startServer} from '../src/server.js';
import {OperationalDiagnostics} from '../src/operational-diagnostics.js';
import {clearVault} from '../src/encryption.js';
import {sampleNotebook} from '../src/sample.js';

test('encrypted session startup reports categorized phases without retaining access credentials or locations',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-startup-diagnostics-')),diagnostics=new OperationalDiagnostics();let app,f;
 t.after(async()=>{await app?.close();clearVault(f?.vault);await rm(directory,{recursive:true,force:true});});
 f=await encryptedFixture(directory,sampleNotebook());
 app=await startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json'),diagnostics});
 const request=token=>fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token})});
 assert.equal((await request('invalid-launch-secret')).status,401);
 const rejected=(await diagnostics.snapshot()).entries.find(row=>row.event==='request'&&row.route==='session');
 assert.equal(rejected.code,'AUTH');assert.equal((await diagnostics.snapshot()).entries.some(row=>row.correlation===rejected.correlation&&row.event==='phase'),false);
 const response=await request(app.launchToken);assert.equal(response.status,200);assert.ok(response.headers.get('set-cookie'));
 const report=await diagnostics.snapshot(),requestEvent=report.entries.find(row=>row.event==='request'&&row.route==='session'&&row.status===200);
 assert.ok(requestEvent);const phases=report.entries.filter(row=>row.event==='phase'&&row.correlation===requestEvent.correlation&&(row.phase?.startsWith('session-')||row.phase==='workspace-identity'));
 assert.deepEqual(phases.map(row=>row.phase),['session-access','session-device','session-access','session-workers','workspace-identity','session-location']);
 assert.ok(phases.every(row=>Number.isFinite(row.durationMs)&&row.durationMs>=0));
 const serialized=JSON.stringify(report);for(const privateValue of [directory,f.vault.id,f.vault.key.toString('hex'),app.launchToken,response.headers.get('set-cookie'),'invalid-launch-secret'])assert.equal(serialized.includes(privateValue),false);
});

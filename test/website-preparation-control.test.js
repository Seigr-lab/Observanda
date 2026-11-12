import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {startServer} from '../src/server.js';
import {WebsiteFileStore} from '../src/website-file-store.js';

// Preparing saved websites runs in the background, shows in the activity surface, can be
// stopped by a person and resumes from its journals to the same complete result.
test('website preparation reports activity, stops on request and resumes to a complete site',{timeout:900000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-preparation-control-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:42},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Study '+i,body:'Shared notes '+i,sections:[],attachments:[],figures:[],relations:[],contributors:[]}));
 const f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 t.after(async()=>{await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})}),cookie=session.headers.get('x-observanda-session').split(';')[0];
 const storage=await (await fetch(app.origin+'/api/storage',{headers:{'X-Observanda-Session':cookie}})).json();
 const post=async route=>{const response=await fetch(app.origin+route,{method:'POST',headers:{Origin:app.origin,'X-Observanda-Session':cookie,'Content-Type':'application/json','X-Observanda-Workspace':storage.contextId},body:'{}'});assert.equal(response.status,200,await response.clone().text());return response.json();};
 const activity=async()=>(await (await fetch(app.origin+'/api/activity',{headers:{'X-Observanda-Session':cookie}})).json()).operations.filter(entry=>entry.kind==='website-preparation');
 // Stop once entries are being converted, part way through the work.
 for(;;){const {preparation}=await post('/api/website-files/preparation');if(preparation.stage==='converting-entries'&&preparation.completed>0)break;assert.notEqual(preparation.state,'ready','preparation finished before it could be stopped');await delay(50);}
 const running=await activity();assert.equal(running.length,1);assert.equal(running[0].state,'running');assert.equal(running[0].progress.stage,'converting-entries');
 const stopped=await post('/api/website-files/preparation/cancel');assert.equal(stopped.preparation.state,'cancelled');
 assert.equal((await activity())[0].state,'cancelled');
 // Opening the workspace again in this session does not restart a stopped preparation.
 await fetch(app.origin+'/api/storage',{headers:{'X-Observanda-Session':cookie}});await delay(500);
 assert.equal((await post('/api/website-files/preparation')).preparation.state,'cancelled');
 const resumed=await post('/api/website-files/preparation/resume');assert.notEqual(resumed.preparation.state,'cancelled');
 for(;;){const {preparation}=await post('/api/website-files/preparation');assert.notEqual(preparation.state,'failed',JSON.stringify(preparation));if(preparation.state==='ready'&&preparation.library?.state!=='preparing')break;await delay(250);}
 const last=(await activity()).at(-1);assert.equal(last.state,'completed');
 const library=await new WebsiteFileStore(f.workspace).library({limit:100});
 assert.deepEqual(library.items.map(row=>row.title).sort(),book.entries.map(entry=>entry.title).sort());
});

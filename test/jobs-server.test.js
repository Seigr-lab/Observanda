import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {startServer} from '../src/server.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {clearVault} from '../src/encryption.js';
import {contentBuffer} from '../src/file-content.js';

test('HTTP import verification returns a durable job, survives lock/restart and protects status and original downloads',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-job-server-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),materials=new ResearchMaterials(f.workspace);
 let app=await startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'prefs.json')}),cookie;
 const request=(route,data)=>fetch(app.origin+route,{headers:{Cookie:cookie,Origin:app.origin,'Content-Type':'application/json'},...(data?{method:'POST',body:JSON.stringify(data)}:{})});
 const login=async()=>{const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});cookie=session.headers.get('set-cookie').split(';')[0];};
 const api=async(op,data)=>{const response=await request('/api/research/materials/'+op,data);return {status:response.status,data:await response.json()};};
 const originalPrepare=ResearchMaterials.prototype.prepareImport;let allow=false,entered;
 const ready=new Promise(resolve=>entered=resolve);
 ResearchMaterials.prototype.prepareImport=async function(id,options){entered();if(!allow)await delay(60000,null,{signal:options.signal});return originalPrepare.call(this,id,options);};
 t.after(async()=>{ResearchMaterials.prototype.prepareImport=originalPrepare;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 await login();const bytes=Buffer.from('Retained server original'),session=await materials.startImport({recordId:book.entries[0].id,name:'server.bin',size:bytes.length});await materials.appendImport(session.id,0,[bytes]);
 const queued=await api('finish',{id:session.id});assert.equal(queued.status,202);assert.equal(queued.data.job.state,'queued');await ready;
 const status=await api('job',{id:session.id});assert.equal(status.data.job.state,'running');assert.equal(status.data.job.lease,undefined);assert.equal(status.data.job.input,undefined);
 // A second tab does not interrupt the ongoing lease or clear its key.
 await login();assert.equal((await api('job',{id:session.id})).data.job.attempt,1);
 const backup=await request('/api/storage/copy/preview',{path:path.join(directory,'backup')});assert.equal((await backup.json()).code,'JOB_BUSY');
 assert.equal((await request('/api/access/lock',{})).status,200);assert.equal((await api('job',{id:session.id})).status,401);
 const q=workspaceJobs(f.workspace).queue;assert.equal((await q.read(session.id)).state,'queued');
 await app.close();allow=true;app=await startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'prefs.json')});
 await login();let done;const end=Date.now()+10000;do{done=(await api('job',{id:session.id})).data.job;if(done?.state==='completed')break;await delay(40);}while(Date.now()<end);
 assert.equal(done.state,'completed');assert.deepEqual(await contentBuffer((await materials.artifact(done.result)).content),bytes);
 const storage=await (await request('/api/storage')).json(),download='/api/research/materials/original/'+done.result.id+'/'+done.result.revision+'?context='+storage.contextId;
 assert.equal((await fetch(app.origin+download)).status,401);assert.equal((await request(download.replace(storage.contextId,'wrong'))).status,409);
 assert.deepEqual(Buffer.from(await (await request(download)).arrayBuffer()),bytes);
});

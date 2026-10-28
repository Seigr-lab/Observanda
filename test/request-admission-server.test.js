import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {testServer} from './device-fixture.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {initializeLocation} from '../src/locations.js';
import {sampleNotebook} from '../src/sample.js';
import {Workspace} from '../src/storage.js';
import {RequestAdmission} from '../src/request-admission.js';
import {randomUUID} from 'node:crypto';
import {PdfDocuments} from '../src/pdf-documents.js';
import {PdfExportJobs} from '../src/pdf-export-jobs.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';

async function until(check){const deadline=Date.now()+10000;while(!check()){if(Date.now()>deadline)assert.fail('Request admission checkpoint not reached');await delay(10);}}
test('slow HTTP bodies cannot exhaust controls, queued clients cancel, and rejected bodies never save',async t=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-http-capacity-')),root=path.join(parent,'workspace'),password='disposable request admission password',access=await createAccess('',password),vault=takeCreatedVault(access);
 await initializeLocation(root,sampleNotebook(),access,vault);
 const admission=new RequestAdmission({active:1,queued:1,controlActive:1,waitMs:200}),app=await testServer({root,port:0,requestAdmission:admission}),ws=new Workspace(root,vault);
 t.after(async()=>{await app.close();clearVault(vault);await rm(parent,{recursive:true,force:true});});
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})}),cookie=session.headers.get('set-cookie').split(';')[0];
 const headers={Origin:app.origin,Cookie:cookie,'Content-Type':'application/json'},send=(route,data,signal)=>fetch(app.origin+route,{headers,signal,...(data?{method:'POST',body:JSON.stringify(data)}:{})});
 assert.equal((await send('/api/access/unlock',{username:'',password})).status,200);
 const before=await ws.read();
 const documents=new PdfDocuments(ws,before.book.id),documentId=randomUUID(),jobId=randomUUID();
 const document=await documents.change({id:documentId,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header:{version:1,id:documentId,name:'Capacity check',language:'en',direction:'ltr',layout:pdfLayoutPreset()},section:{id:randomUUID(),title:'Evidence',content:'Synthetic PDF capacity check.',layout:null,start:null}}});
 const jobs=new PdfExportJobs(documents);await jobs.start({jobId,documentId,revision:document.revision});
 const slow=http.request(app.origin+'/api/notebook/save',{method:'POST',headers:{...headers,'Content-Length':'100'}});slow.on('error',()=>{});slow.write('{');t.after(()=>slow.destroy());
 await until(()=>admission.stats().work.retainedBytes===100);
 const abort=new AbortController(),queued=send('/api/notebook',null,abort.signal),rejected=assert.rejects(queued,{name:'AbortError'});await until(()=>admission.stats().work.queued===1);
 const refusal=await send('/api/notebook/save',{book:{description:'must never be saved'},etag:before.etag});assert.equal(refusal.status,503);assert.equal(refusal.headers.get('retry-after'),'1');assert.equal((await refusal.json()).code,'WORKLOAD_BUSY');
 assert.equal((await fetch(app.origin+'/api/health')).status,401);
 const health=await send('/api/health');assert.equal(health.status,200);assert.equal((await health.json()).requests.work.active,1);
 abort.abort();await rejected;await until(()=>admission.stats().work.queued===0);
 const expired=await send('/api/notebook');assert.equal(expired.status,503);assert.equal((await expired.json()).code,'WORKLOAD_BUSY');
 slow.destroy();await until(()=>admission.stats().work.active===0);assert.equal(admission.stats().work.retainedBytes,0);
 assert.equal((await send('/api/health')).status,200);assert.equal((await ws.read()).etag,before.etag);
 admission.waitMs=10000;const held=await admission.acquire('work'),waiting=send('/api/notebook');await until(()=>admission.stats().work.queued===1);
 try{
  // Use the separately held ticket, not the preceding 200 ms expiry case, to
  // qualify durable controls while ordinary work is occupied and queued.
  const jobInput={workspaceId:before.book.id,id:jobId};
  const status=await send('/api/pdf/export-status',jobInput);assert.equal(status.status,200);assert.equal((await status.json()).state,'queued');
  const cancelled=await send('/api/pdf/export-cancel',jobInput);assert.equal(cancelled.status,200);assert.equal((await cancelled.json()).state,'cancelled');assert.equal((await jobs.status(jobId)).state,'cancelled');
  const invalid=await send('/api/pdf/export-cancel',{workspaceId:before.book.id,id:'invalid'});assert.equal(invalid.status,422);assert.equal((await invalid.json()).code,'INVALID');
  const oversize=await send('/api/pdf/export-status',{...jobInput,note:'x'.repeat(1024)});assert.equal(oversize.status,413);assert.equal((await oversize.json()).code,'LIMIT');
  assert.equal(admission.stats().work.active,1);assert.equal((await send('/api/access/lock',{})).status,200);
 }finally{held.release();}
 assert.equal((await waiting).status,401);assert.equal(admission.stats().work.queued,0);
});

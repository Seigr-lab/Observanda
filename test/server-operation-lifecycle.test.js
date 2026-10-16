import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {testServer} from './device-fixture.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {AppError} from '../src/errors.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {RecordHistory} from '../src/record-history.js';
import {RecordRunCreation} from '../src/record-run-creation.js';
import {RecordDraftReview} from '../src/record-draft-review.js';
import {readProgressStream} from '../src/web/progress-stream.js';
const routes=[
 [ResearchMaterials,'pinRecord','/api/research/materials/pin'],
 [RecordHistory,'restore','/api/research/records/history/restore'],
 [RecordRunCreation,'create','/api/research/records/runs/create'],
 ...['prepare','choose','apply'].map(method=>[RecordDraftReview,method,'/api/research/drafts/review/'+method])
];
async function setup(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-operation-lifecycle-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 t.after(async()=>{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})}),cookie=session.headers.get('set-cookie').split(';')[0];
 const request=(route,data={},accept='application/json')=>fetch(app.origin+route,{method:'POST',headers:{Cookie:cookie,Origin:app.origin,'Content-Type':'application/json',Accept:accept},body:JSON.stringify(data)});
 return {app,request,book};
}
test('negotiated operations keep pending writes counted and return controlled errors for JSON and stream clients',async t=>{
 const {request,app,book}=await setup(t);
 assert.equal((await fetch(app.origin+'/api/workspace/read/record-selectors',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:'{}'})).status,401);
 assert.equal((await request('/api/workspace/read/record-selectors',{workspaceId:book.id,recordId:book.entries[0].id})).status,200);
 for(const [Owner,method,route] of routes)for(const accept of ['application/json','application/x-ndjson']){
  let release,entered;const gate=new Promise(resolve=>release=resolve),reached=new Promise(resolve=>entered=resolve);
  t.mock.method(Owner.prototype,method,async()=>{entered();await gate;throw new AppError('RECORD_CHANGED');});
  try{
   const response=request(route,{},accept);await reached;
   assert.equal((await request('/api/access/lock')).status,423,route+' must retain its writer lifetime');release();
   const result=await response;if(accept==='application/json'){assert.equal(result.status,409);assert.equal((await result.json()).code,'RECORD_CHANGED');}
   else {assert.equal(result.status,200);await assert.rejects(readProgressStream(result,()=>{}),{code:'RECORD_CHANGED'});}
  }finally{release();Owner.prototype[method].mock.restore();}
 }
 // Failure releases the guard again; it does not leave the workspace locked.
 assert.equal((await request('/api/access/lock')).status,200);
 assert.equal((await request('/api/workspace/read/record-selectors',{workspaceId:book.id,recordId:book.entries[0].id})).status,401);
});
test('shutdown waits for a negotiated pin operation to finish before releasing its request',async t=>{
 const {request,app}=await setup(t);let release,entered;const gate=new Promise(resolve=>release=resolve),reached=new Promise(resolve=>entered=resolve);
 t.mock.method(ResearchMaterials.prototype,'pinRecord',async()=>{entered();await gate;return {pinned:true};});
 try{
  const response=request('/api/research/materials/pin');await reached;let closed=false;const closing=app.close().then(()=>closed=true);
  await new Promise(resolve=>setTimeout(resolve,80));assert.equal(closed,false);release();assert.deepEqual(await (await response).json(),{pinned:true});await closing;
 }finally{release();}
});

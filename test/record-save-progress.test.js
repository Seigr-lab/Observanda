import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {startServer} from '../src/server.js';
import {clearVault} from '../src/encryption.js';
import {recordRevision,ResearchRecords} from '../src/research.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {AppError} from '../src/errors.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-save-progress-')),f=await encryptedFixture(directory,sampleNotebook());
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,headless:true,port:0});
 t.after(async()=>{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const auth=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})}),cookie=auth.headers.get('set-cookie').split(';')[0],before=await f.workspace.read(),previous=before.book.entries[0];
 const record={...previous,title:'A measurable save',sections:Array.from({length:129},(_,i)=>({id:crypto.randomUUID(),title:'Section '+i,body:('Exact observation '+i+' ').repeat(50)}))};
 const command=(record,base=previous)=>({workspaceId:before.book.id,receipt:true,changes:[{id:record.id,record,expectedRevision:recordRevision(base)}]});
 const request=(body,{stream=true,signal}={})=>fetch(app.origin+'/api/research/records/save',{method:'POST',signal,headers:{Cookie:cookie,Origin:app.origin,'Content-Type':'application/json',...(stream?{Accept:'application/x-ndjson'}:{})},body:JSON.stringify(body)});
 return {...f,app,before,record,command,request};
}
const events=async response=>(await response.text()).trim().split('\n').map(line=>JSON.parse(line));

test('record save streams measured stages and a receipt only after durable commit; JSON clients keep their contract',async t=>{
 const f=await fixture(t),response=await f.request(f.command(f.record));assert.match(response.headers.get('content-type'),/application\/x-ndjson/);
 const values=await events(response),progress=values.filter(v=>v.progress).map(v=>v.progress);
 for(const stage of ['read-record-bases','prepare-record-edits','validate-records','write-records','write-record-blocks','index-records','read-saved-records'])assert.ok(progress.some(p=>p.stage===stage),stage);
 assert.ok(progress.some(p=>p.stage==='write-record-blocks'&&p.completed>0&&p.unit==='blocks'));
 assert.ok(progress.some(p=>p.stage==='index-records'&&p.completed===5&&p.total===5));
 assert.equal(values.filter(v=>v.result).length,1);assert.equal(values.filter(v=>v.error).length,0);
 const saved=await f.workspace.read();assert.equal(saved.etag,values.at(-1).result.recordReceipt.etag);assert.deepEqual(saved.book.entries[0].sections,f.record.sections);
 const changed={...saved.book.entries[0],title:'Ordinary JSON client'},plain=await f.request(f.command(changed,saved.book.entries[0]),{stream:false});
 assert.match(plain.headers.get('content-type'),/application\/json/);assert.ok((await plain.json()).recordReceipt);assert.equal((await f.workspace.read()).book.entries[0].title,changed.title);
});

test('a save failing after measured block writes emits an error and rolls back its records and indexes',async t=>{
 const f=await fixture(t),remember=ResearchCatalogue.prototype.rememberHistory;
 ResearchCatalogue.prototype.rememberHistory=async function(record,...args){if(record.title===f.record.title)throw new AppError('INVALID');return remember.call(this,record,...args);};
 try{
  const values=await events(await f.request(f.command(f.record)));
  assert.ok(values.some(v=>v.progress?.stage==='write-record-blocks'&&v.progress.completed>0));assert.equal(values.at(-1).error.code,'INVALID');assert.equal(values.some(v=>v.result),false);
  assert.deepEqual(await f.workspace.read(),f.before);
 }finally{ResearchCatalogue.prototype.rememberHistory=remember;}
 assert.ok((await events(await f.request(f.command(f.record)))).at(-1).result.recordReceipt);
});

test('disconnecting during an admitted save preserves atomic completion and stale-retry protection',async t=>{
 const f=await fixture(t),remember=ResearchCatalogue.prototype.rememberHistory;let entered,release;
 const reached=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 ResearchCatalogue.prototype.rememberHistory=async function(record,...args){if(record.title===f.record.title){entered();await gate;}return remember.call(this,record,...args);};
 const stop=new AbortController();
 try{
  const response=await f.request(f.command(f.record),{signal:stop.signal});await reached;stop.abort();await response.body.cancel().catch(()=>{});release();
  // Shutdown drains the admitted transaction, without launching the desktop app.
  await f.app.close();const saved=await f.workspace.read();assert.equal(saved.book.entries[0].title,f.record.title);assert.deepEqual(saved.book.entries[0].sections,f.record.sections);
  assert.notEqual(saved.etag,f.before.etag);
  const {receipt,...stale}=f.command(f.record);await assert.rejects(new ResearchRecords(f.workspace,{}).save(stale,{receipt}),{code:'RECORD_CHANGED'});assert.equal((await f.workspace.outline()).etag,saved.etag);
 }finally{release();ResearchCatalogue.prototype.rememberHistory=remember;}
});

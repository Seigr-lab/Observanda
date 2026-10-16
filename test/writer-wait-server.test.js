import {workspaceSaveRequest} from '../src/web/workspace-edits.js';
import {recordRevisions} from '../src/research.js';
import {emptyWebsiteSelection} from '../src/web/website-selection.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {startServer} from '../src/server.js';
import {openCatalogue} from '../src/postgres.js';
import {clearVault} from '../src/encryption.js';
import {RecordWriting} from '../src/record-writing.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {Workspace} from '../src/storage.js';
import {WorkspaceFonts} from '../src/workspace-fonts.js';
import {WorkspaceRenames} from '../src/workspace-rename.js';
import {AppError} from '../src/errors.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-writer-wait-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});
 const cleanup=[];t.after(async()=>{await app.close();for(const close of cleanup)await close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})}),cookie=session.headers.get('set-cookie').split(';')[0];
 const storage=await(await fetch(app.origin+'/api/storage',{headers:{Cookie:cookie}})).json();
 const call=(route,data,signal)=>fetch(app.origin+route,{signal:signal??AbortSignal.timeout(30000),method:data===undefined?'GET':'POST',headers:{Origin:app.origin,Cookie:cookie,'Content-Type':'application/json','X-Observanda-Workspace':storage.contextId,'X-Observanda-Wait':'1'},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const writing=new RecordWriting(f.workspace),command=await writing.read({workspaceId:book.id,recordId:book.entries[0].id,sectionId:null});
 const save=body=>({workspaceId:book.id,recordId:book.entries[0].id,sectionId:null,expectedRevision:command.revision,value:{body}});
 return {...f,directory,book,app,call,writing,save,cleanup,storage,cookie};
}
async function until(check){const deadline=Date.now()+10000;while(!await check()){if(Date.now()>deadline)throw Error('Condition did not complete');await delay(50);}}
test('admitted writes wait for the occupied database, keep reads usable and recheck revisions',async t=>{
 const f=await fixture(t),holder=await openCatalogue(f.workspace.root);await holder.run('BEGIN');await holder.lock();
 try{
  const first=f.call('/api/research/records/writing/save',f.save('first pending value'));await until(async()=>(await(await f.call('/api/activity')).json()).operations.some(item=>item.state==='queued'));
  const second=f.call('/api/research/records/writing/save',f.save('second pending value'));
  assert.equal((await f.call('/api/dashboard')).status,200);
  await until(async()=>(await(await f.call('/api/activity')).json()).operations.filter(item=>item.state==='queued').length===2);
  await holder.run('ROLLBACK');const a=await first,b=await second;assert.equal(a.status,200);assert.equal(b.status,409);assert.equal((await b.json()).code,'RECORD_CHANGED');
  assert.equal((await f.writing.read({workspaceId:f.book.id,recordId:f.book.entries[0].id,sectionId:null})).value.body,'first pending value');
 }finally{await holder.close();}
});
test('disconnecting a queued request cancels before mutation and releases its queue position',async t=>{
 const f=await fixture(t),holder=await openCatalogue(f.workspace.root);await holder.run('BEGIN');await holder.lock();
 try{
  const controller=new AbortController(),pending=f.call('/api/research/records/writing/save',f.save('must not commit'),controller.signal),rejected=assert.rejects(pending,{name:'AbortError'});
  await until(async()=>(await(await f.call('/api/activity')).json()).operations.some(item=>item.state==='queued'));controller.abort();await rejected;
  await until(async()=>(await(await f.call('/api/activity')).json()).operations.some(item=>item.state==='cancelled'));
  await holder.run('ROLLBACK');assert.equal((await f.call('/api/research/records/writing/save',f.save('next valid save'))).status,200);
  assert.equal((await f.writing.read({workspaceId:f.book.id,recordId:f.book.entries[0].id,sectionId:null})).value.body,'next valid save');
 }finally{await holder.close();}
});

test('a waiting record edit cannot replay against the destination after a verified workspace copy',async t=>{
 const f=await fixture(t),destination=path.join(f.directory,'copy'),before=await f.writing.read({workspaceId:f.book.id,recordId:f.book.entries[0].id,sectionId:null});
 const verify=ResearchCatalogue.prototype.verifyRecordHistory;let release,entered;const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve);
 ResearchCatalogue.prototype.verifyRecordHistory=async function(...args){entered();await gate;return verify.apply(this,args);};
 try{
  const copying=f.call('/api/storage/copy',{path:destination,confirmed:true});await ready;
  assert.equal((await f.call('/api/modules/version')).status,200);
  assert.equal((await f.call('/api/workspace/read/version',{workspaceId:f.book.id})).status,200);
  const pending=f.call('/api/research/records/writing/save',f.save('must not follow a changed workspace'));
  await until(async()=>(await(await f.call('/api/activity')).json()).operations.some(item=>item.state==='queued'));
  release();assert.equal((await copying).status,200);const response=await pending;assert.equal(response.status,409);assert.equal((await response.json()).code,'WORKSPACE_CHANGED');
  assert.deepEqual(await f.writing.read({workspaceId:f.book.id,recordId:f.book.entries[0].id,sectionId:null}),before);
  const copied=new Workspace(destination,f.vault),after=await new RecordWriting(copied).read({workspaceId:f.book.id,recordId:f.book.entries[0].id,sectionId:null});
  // The destination adopts its folder name; record content and revisions remain unchanged.
  const {etag:sourceEtag,...sourceRecord}=before,{etag:destinationEtag,...destinationRecord}=after;assert.deepEqual(destinationRecord,sourceRecord);
  assert.equal((await copied.read()).book.title,'copy');assert.notEqual(destinationEtag,sourceEtag);
 }finally{release();ResearchCatalogue.prototype.verifyRecordHistory=verify;}
});

test('maintenance endpoints are unavailable without queuing activity or blocking normal reads',async t=>{
 const f=await fixture(t);
 for(const route of ['/api/storage/database/convert','/api/projects/convert','/api/projects/convert/resume','/api/projects/ownership/list','/api/projects/ownership/assign']){
  const response=await f.call(route,{confirmed:true});assert.equal(response.status,404,route+': '+await response.text());
 }
 assert.equal((await f.call('/api/modules/version')).status,200);
 assert.equal((await f.call('/api/workspace/read/version',{workspaceId:f.book.id})).status,200);
 assert.deepEqual((await(await f.call('/api/activity')).json()).operations,[]);
});

test('website discovery and preview remain reads during copying and create no queued writes',async t=>{
 const f=await fixture(t),destination=path.join(f.directory,'copy'),before=await f.workspace.read();
 const verify=ResearchCatalogue.prototype.verifyRecordHistory;let release,entered;
 const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve);
 ResearchCatalogue.prototype.verifyRecordHistory=async function(...args){entered();await gate;return verify.apply(this,args);};
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
 let copying;
 try{
  copying=f.call('/api/storage/copy',{path:destination,confirmed:true});await ready;
  const summary=await f.call('/api/website/research/summary',{workspaceId:before.book.id,snapshotId:before.etag,selection:emptyWebsiteSelection(),search:''},controller.signal);
  assert.equal(summary.status,200,await summary.text());
  const draft={...workspaceSaveRequest(before.book,before.book,recordRevisions(before.book)),baseEtag:before.etag};
  const response=await f.call('/api/design-preview',{draft,mode:'website',designTarget:'project:'+before.book.projects[0].id,workspaceContent:true},controller.signal),preview=await response.json();
  assert.equal(response.status,200,JSON.stringify(preview));
  const asset=await f.call(preview.url,undefined,controller.signal);assert.equal(asset.status,200);assert.match(await asset.text(),/<html/);
  assert.equal((await f.workspace.outline()).etag,before.etag);
  const activity=await(await f.call('/api/activity')).json();assert.equal(activity.busy,true);assert.equal(activity.operations.length,1);assert.equal(activity.operations[0].kind,'/api/storage/copy');
 }finally{clearTimeout(timeout);controller.abort();release();ResearchCatalogue.prototype.verifyRecordHistory=verify;if(copying)await copying;}
});

test('custom font bytes remain readable during a read-permitted workspace copy',async t=>{
 const f=await fixture(t),original=await readFile(new URL('../src/fonts/dm-sans.ttf',import.meta.url)),font=await new WorkspaceFonts(f.workspace).import(original),destination=path.join(f.directory,'copy');
 const asset=(context=f.storage.contextId,cookie=f.cookie)=>fetch(f.app.origin+'/api/fonts/'+font.id+'?workspace='+encodeURIComponent(context),{headers:{Cookie:cookie},signal:AbortSignal.timeout(10000)});
 const verify=ResearchCatalogue.prototype.verifyRecordHistory;let release,entered;
 const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve);
 ResearchCatalogue.prototype.verifyRecordHistory=async function(...args){entered();await gate;return verify.apply(this,args);};
 let copying;
 try{
  copying=f.call('/api/storage/copy',{path:destination,confirmed:true});await ready;
  const response=await asset();assert.equal(response.status,200,response.status===200?undefined:await response.text());
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),original);
  assert.equal((await asset('stale-context')).status,409);
  assert.equal((await asset(f.storage.contextId,'observanda=unrelated-session')).status,401);
  const activity=await(await f.call('/api/activity')).json();assert.equal(activity.busy,true);assert.equal(activity.operations.length,1);assert.equal(activity.operations[0].kind,'/api/storage/copy');
  release();const copied=await copying;assert.equal(copied.status,200,await copied.clone().text());
  assert.equal((await asset()).status,409);
 }finally{release();ResearchCatalogue.prototype.verifyRecordHistory=verify;if(copying)await copying;}
});

test('custom font reads remain fenced during an exclusive rename and after workspace lock',async t=>{
 const f=await fixture(t),original=await readFile(new URL('../src/fonts/dm-sans.ttf',import.meta.url)),font=await new WorkspaceFonts(f.workspace).import(original);
 const asset=()=>fetch(f.app.origin+'/api/fonts/'+font.id+'?workspace='+encodeURIComponent(f.storage.contextId),{headers:{Cookie:f.cookie},signal:AbortSignal.timeout(10000)});
 const begin=WorkspaceRenames.prototype.begin;let release,entered;
 const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve);
 // Hold after HTTP admission closes readers, before changing any folder.
 WorkspaceRenames.prototype.begin=async function(workspace,...args){if(workspace.root!==f.workspace.root)return begin.call(this,workspace,...args);entered();await gate;throw new AppError('INVALID');};
 let renaming;
 try{
  renaming=f.call('/api/storage/rename',{name:'Renamed workspace',etag:(await f.workspace.outline()).etag});await ready;
  const denied=await asset();assert.equal(denied.status,423);assert.equal((await denied.json()).code,'LOCKED');
  release();assert.equal((await renaming).status,422);
  const reopened=await asset();assert.equal(reopened.status,200);assert.deepEqual(Buffer.from(await reopened.arrayBuffer()),original);
  assert.equal((await f.call('/api/access/lock',{})).status,200);
  const locked=await asset();assert.equal(locked.status,401);assert.equal((await locked.json()).code,'ACCESS_LOCKED');
 }finally{release();WorkspaceRenames.prototype.begin=begin;if(renaming)await renaming;}
});

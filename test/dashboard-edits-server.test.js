import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {startServer} from '../src/server.js';
import {clearVault} from '../src/encryption.js';
import {WorkspaceDeletions} from '../src/workspace-deletion.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from '../src/security/dashboard-storage.js';
import {copyWorkspaceTo} from '../src/locations.js';
import {DashboardEdits} from '../src/dashboard-edits.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-pending-api-')),f=await encryptedFixture(directory,sampleNotebook()),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});
 t.after(async()=>{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})}),cookie=session.headers.get('set-cookie').split(';')[0];
 let context=(await(await fetch(app.origin+'/api/storage',{headers:{Cookie:cookie}})).json()).contextId;
 const call=async(route,data)=>{const response=await fetch(app.origin+route,{method:data===undefined?'GET':'POST',headers:{Origin:app.origin,Cookie:cookie,'Content-Type':'application/json','X-Observanda-Workspace':context},...(data===undefined?{}:{body:JSON.stringify(data)})});return response.json();};
 return {...f,directory,app,call,changeContext:value=>context=value};
}
async function until(check){const deadline=Date.now()+15000;while(!await check()){if(Date.now()>deadline)throw Error('Condition did not complete');await delay(75);}}

test('workspace deletion preserves retained settings and closes admission before deleting',async t=>{
 const f=await fixture(t),initial=await readWorkspaceDashboard(f.workspace),settings=structuredClone(initial.settings);settings.enabledModules.push('planning');
 const review=await f.call('/api/storage/delete/preview',{}),command={id:review.id,path:review.source,title:review.title,confirmed:true};
 const apply=DashboardEdits.prototype.apply;DashboardEdits.prototype.apply=async function(workspace){return workspace.root===f.workspace.root?{waiting:true}:apply.call(this,workspace);};
 try{
  const pending=await f.call('/api/dashboard/pending',{action:'save',id:randomUUID(),settings,etag:initial.etag});assert.ok(pending.accepted);
  for(const [route,data] of [['/api/storage/delete/preview',{}],['/api/storage/delete',command]]){
   let result;await until(async()=>{result=await f.call(route,data);return result.code!=='LOCKED';});assert.equal(result.code,'DASHBOARD_PENDING');
  }
  await access(f.workspace.root);assert.deepEqual((await f.call('/api/dashboard/pending')).pending.settings,settings);
  await f.call('/api/dashboard/pending',{action:'discard',id:pending.accepted.id});
 }finally{DashboardEdits.prototype.apply=apply;}
 const begin=WorkspaceDeletions.prototype.begin;let entered,release;const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 WorkspaceDeletions.prototype.begin=async function(...args){entered();await gate;return begin.apply(this,args);};
 try{
  const deleting=f.call('/api/storage/delete',command);await ready;
  assert.equal((await f.call('/api/dashboard/pending',{action:'save',id:randomUUID(),settings,etag:initial.etag})).code,'STORAGE_DELETING');
  release();assert.equal((await deleting).result.complete,true);
 }finally{release();WorkspaceDeletions.prototype.begin=begin;}
});

test('conflicting settings remain visible after lock and unlock without repeated failure notices',async t=>{
 const f=await fixture(t),initial=await readWorkspaceDashboard(f.workspace),settings=structuredClone(initial.settings),other=structuredClone(initial.settings);settings.enabledModules.push('planning');other.enabledModules.push('resources');
 await writeWorkspaceDashboard(f.workspace,other,initial.etag);
 const pending=await f.call('/api/dashboard/pending',{action:'save',id:randomUUID(),settings,etag:initial.etag});
 await until(async()=>(await f.call('/api/dashboard/pending')).pending?.error==='DASHBOARD_CHANGED');
 for(let i=0;i<4;i++){await f.call('/api/dashboard/pending');await delay(100);}
 assert.equal((await f.call('/api/activity')).operations.filter(item=>item.kind==='/api/dashboard').length,0);
 assert.equal((await f.call('/api/access/lock',{})).ok,true);assert.equal((await f.call('/api/dashboard/pending')).code,'ACCESS_LOCKED');
 assert.equal((await f.call('/api/access/unlock',{})).ok,true);assert.deepEqual((await f.call('/api/dashboard/pending')).pending.settings,settings);
 assert.deepEqual((await readWorkspaceDashboard(f.workspace)).settings,other);
 f.changeContext('stale');assert.equal((await f.call('/api/dashboard/pending',{action:'discard',id:pending.accepted.id})).code,'WORKSPACE_CHANGED');
});

test('opening an older copy does not move pending settings out of their original workspace',async t=>{
 const f=await fixture(t),initial=await readWorkspaceDashboard(f.workspace),destination=await copyWorkspaceTo(f.workspace.root,path.join(f.directory,'older-copy'),{vault:f.vault,activateCatalogue:true});
 const settings=structuredClone(initial.settings),other=structuredClone(initial.settings);settings.enabledModules.push('planning');other.enabledModules.push('resources');await writeWorkspaceDashboard(f.workspace,other,initial.etag);
 const pending=await f.call('/api/dashboard/pending',{action:'save',id:randomUUID(),settings,etag:initial.etag});
 await until(async()=>(await f.call('/api/dashboard/pending')).pending?.error==='DASHBOARD_CHANGED');
 const opened=await f.call('/api/storage/open',{path:destination});assert.ok(opened.contextId);
 assert.equal((await f.call('/api/dashboard/pending')).code,'WORKSPACE_CHANGED');
 f.changeContext(opened.contextId);assert.equal((await f.call('/api/dashboard/pending')).pending,null);assert.deepEqual((await f.call('/api/dashboard')).settings,initial.settings);
 const returned=await f.call('/api/storage/open',{path:f.workspace.root});f.changeContext(returned.contextId);
 assert.equal((await f.call('/api/dashboard/pending')).pending.id,pending.accepted.id);assert.deepEqual((await readWorkspaceDashboard(f.workspace)).settings,other);
});


test('an intent transition write failure remains visible and can be retried without global activity',async t=>{
 const f=await fixture(t),initial=await readWorkspaceDashboard(f.workspace),settings=structuredClone(initial.settings);settings.enabledModules.push('planning');
 const write=DashboardEdits.prototype.write;let failed=false;
 DashboardEdits.prototype.write=async function(workspace,entry){if(workspace.root===f.workspace.root&&entry.value.applying&&!failed){failed=true;throw Object.assign(Error('Synthetic intent transition failure'),{code:'IO'});}return write.call(this,workspace,entry);};
 try{
  const submitted=await f.call('/api/dashboard/pending',{action:'save',id:randomUUID(),settings,etag:initial.etag});assert.ok(submitted.accepted);
  await until(async()=>(await f.call('/api/dashboard/pending')).pending?.error==='IO');
  const queue=new DashboardEdits(f.deviceStore.file+'.pending-settings');await until(async()=>(await queue.read(f.workspace))?.error==='IO');
  assert.equal((await f.call('/api/activity')).operations.filter(item=>item.kind==='/api/dashboard').length,0);
  assert.equal((await f.call('/api/dashboard/pending',{action:'retry',id:submitted.accepted.id})).pending.error,null);
  await until(async()=>(await f.call('/api/dashboard/pending')).pending===null);assert.deepEqual((await readWorkspaceDashboard(f.workspace)).settings,settings);
 }finally{DashboardEdits.prototype.write=write;}
});

test('an unwritable intent reports its worker failure until explicit retry even when the intent remains readable',async t=>{
 const f=await fixture(t),initial=await readWorkspaceDashboard(f.workspace),settings=structuredClone(initial.settings);settings.enabledModules.push('planning');
 const write=DashboardEdits.prototype.write;let denied=true,attempts=0;
 DashboardEdits.prototype.write=async function(workspace,entry){if(workspace.root===f.workspace.root&&denied&&(entry.value.applying||entry.value.error)){if(entry.value.applying)attempts++;throw Object.assign(Error('Synthetic intent write denial'),{code:'ENOSPC'});}return write.call(this,workspace,entry);};
 try{
  const submitted=await f.call('/api/dashboard/pending',{action:'save',id:randomUUID(),settings,etag:initial.etag});assert.ok(submitted.accepted);
  await until(async()=>(await f.call('/api/dashboard/pending')).pending?.error==='ENOSPC');
  const queue=new DashboardEdits(f.deviceStore.file+'.pending-settings');assert.equal((await queue.read(f.workspace)).error,null);
  for(let i=0;i<3;i++){const status=await f.call('/api/dashboard/pending');assert.equal(status.pending.state,'failed');assert.equal(status.pending.error,'ENOSPC');await delay(100);}
  assert.equal(attempts,1);assert.equal((await f.call('/api/activity')).operations.filter(item=>item.kind==='/api/dashboard').length,0);
  denied=false;assert.equal((await f.call('/api/dashboard/pending',{action:'retry',id:submitted.accepted.id})).pending.error,null);
  await until(async()=>(await f.call('/api/dashboard/pending')).pending===null);assert.deepEqual((await readWorkspaceDashboard(f.workspace)).settings,settings);
 }finally{DashboardEdits.prototype.write=write;}
});

test('a late preference worker failure cannot mark a newer accepted intent as failed',async t=>{
 const f=await fixture(t),initial=await readWorkspaceDashboard(f.workspace),first=structuredClone(initial.settings);first.enabledModules.push('planning');const newer=structuredClone(first);newer.enabledModules.push('resources');
 const apply=DashboardEdits.prototype.apply;let entered,release,held=false;const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 DashboardEdits.prototype.apply=async function(workspace){if(workspace.root===f.workspace.root&&!held){held=true;entered();await gate;throw Object.assign(Error('Synthetic late worker failure'),{code:'IO'});}return apply.call(this,workspace);};
 try{
  const firstReply=await f.call('/api/dashboard/pending',{action:'save',id:randomUUID(),settings:first,etag:initial.etag});assert.ok(firstReply.accepted);await ready;
  const nextReply=await f.call('/api/dashboard/pending',{action:'save',id:randomUUID(),settings:newer,etag:firstReply.accepted.etag});assert.ok(nextReply.accepted);release();
  await until(async()=>{const pending=(await f.call('/api/dashboard/pending')).pending;if(pending){assert.equal(pending.id,nextReply.accepted.id);assert.equal(pending.error,null);}return !pending;});
  assert.deepEqual((await readWorkspaceDashboard(f.workspace)).settings,newer);
 }finally{release();DashboardEdits.prototype.apply=apply;}
});


test('retry waits for the worker that published a durable failure before clearing that failure',async t=>{
 const f=await fixture(t),initial=await readWorkspaceDashboard(f.workspace),settings=structuredClone(initial.settings),other=structuredClone(initial.settings);settings.enabledModules.push('planning');other.enabledModules.push('resources');
 await writeWorkspaceDashboard(f.workspace,other,initial.etag);
 const apply=DashboardEdits.prototype.apply;let entered,release,held=false;const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 DashboardEdits.prototype.apply=async function(workspace){try{return await apply.call(this,workspace);}catch(error){if(workspace.root===f.workspace.root&&!held){held=true;entered();await gate;}throw error;}};
 try{
  const submitted=await f.call('/api/dashboard/pending',{action:'save',id:randomUUID(),settings,etag:initial.etag});assert.ok(submitted.accepted);await ready;
  assert.equal((await f.call('/api/dashboard/pending')).pending.error,'DASHBOARD_CHANGED');
  await writeWorkspaceDashboard(f.workspace,initial.settings,(await readWorkspaceDashboard(f.workspace)).etag);
  let finished=false;const retry=f.call('/api/dashboard/pending',{action:'retry',id:submitted.accepted.id}).then(value=>{finished=true;return value;});await delay(100);assert.equal(finished,false);
  release();assert.equal((await retry).pending.error,null);await until(async()=>(await f.call('/api/dashboard/pending')).pending===null);
  assert.deepEqual((await readWorkspaceDashboard(f.workspace)).settings,settings);
 }finally{release();DashboardEdits.prototype.apply=apply;}
});

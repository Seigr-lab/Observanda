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
import {openCatalogue} from '../src/postgres.js';
import {WorkspaceDeletions} from '../src/workspace-deletion.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from '../src/security/dashboard-storage.js';
import {copyWorkspaceTo} from '../src/locations.js';

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
 const holder=await openCatalogue(f.workspace.root);await holder.run('BEGIN');await holder.lock();
 try{
  const pending=await f.call('/api/dashboard/pending',{action:'save',id:randomUUID(),settings,etag:initial.etag});assert.ok(pending.accepted);
  for(const [route,data] of [['/api/storage/delete/preview',{}],['/api/storage/delete',command]]){
   let result;await until(async()=>{result=await f.call(route,data);return result.code!=='LOCKED';});assert.equal(result.code,'DASHBOARD_PENDING');
  }
  await access(f.workspace.root);assert.deepEqual((await f.call('/api/dashboard/pending')).pending.settings,settings);
  await f.call('/api/dashboard/pending',{action:'discard',id:pending.accepted.id});
 }finally{await holder.run('ROLLBACK');await holder.close();}
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
 assert.equal((await f.call('/api/activity')).operations.filter(item=>item.kind==='/api/dashboard'&&item.state==='failed').length,1);
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

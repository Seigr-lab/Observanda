import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,randomBytes} from 'node:crypto';
import {DashboardEdits} from '../src/dashboard-edits.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from '../src/security/dashboard-storage.js';
import {clearVault} from '../src/encryption.js';
import {openCatalogue} from '../src/postgres.js';
import {copyWorkspaceTo} from '../src/locations.js';
import {Workspace} from '../src/storage.js';

async function fixture(t){const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-pending-settings-')),f=await encryptedFixture(directory,sampleNotebook()),queue=new DashboardEdits(path.join(directory,'pending'));t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});return {...f,directory,queue};}
const change=(settings,id)=>({...structuredClone(settings),enabledModules:[...new Set([...settings.enabledModules,id])]});

test('settings are retained while the workspace writer is occupied and resume after service restart',async t=>{
 const f=await fixture(t),initial=await readWorkspaceDashboard(f.workspace),holder=await openCatalogue(f.workspace.root);await holder.run('BEGIN');await holder.lock();
 try{
  const desired=change(initial.settings,'planning'),command={id:randomUUID(),settings:desired,etag:initial.etag};
  const submitted=await f.queue.submit(f.workspace,command);assert.equal(submitted.state,'waiting');assert.deepEqual(await f.queue.submit(f.workspace,command),submitted);
  assert.deepEqual(await f.queue.apply(f.workspace),{waiting:true});assert.equal((await readWorkspaceDashboard(f.workspace)).etag,initial.etag);
  const file=(await readdir(f.queue.directory)).find(name=>name.endsWith('.observanda')),bytes=await readFile(path.join(f.queue.directory,file));assert.ok(!bytes.includes(Buffer.from('enabledModules')));assert.ok(!bytes.includes(Buffer.from(f.workspace.root)));
  await assert.rejects(f.queue.read(new Workspace(f.workspace.root,{id:f.vault.id,key:randomBytes(32)})),{code:'ENCRYPTION_DAMAGED'});
  await holder.run('ROLLBACK');const restarted=new DashboardEdits(f.queue.directory);await restarted.apply(f.workspace);
  assert.deepEqual((await readWorkspaceDashboard(f.workspace)).settings,desired);assert.equal(await restarted.read(f.workspace),null);
 }finally{await holder.close();}
});
test('new unsaved changes coalesce and a pending next save follows its exact predecessor',async t=>{
 const f=await fixture(t),initial=await readWorkspaceDashboard(f.workspace),a=change(initial.settings,'planning'),b=change(a,'resources');
 let latest=await f.queue.submit(f.workspace,{id:randomUUID(),settings:a,etag:initial.etag});
 latest=await f.queue.submit(f.workspace,{id:randomUUID(),settings:b,etag:latest.etag});
 await f.queue.apply(f.workspace);assert.deepEqual((await readWorkspaceDashboard(f.workspace)).settings,b);
 const holder=await openCatalogue(f.workspace.root);await holder.run('BEGIN');await holder.lock();
 try{
  const c=change(b,'organizations'),d=change(c,'collaboration');latest=await f.queue.submit(f.workspace,{id:randomUUID(),settings:c,etag:latest.etag});
  await f.queue.apply(f.workspace);await f.queue.submit(f.workspace,{id:randomUUID(),settings:d,etag:latest.etag});
  await holder.run('ROLLBACK');assert.deepEqual(await f.queue.apply(f.workspace),{waiting:true});await f.queue.apply(f.workspace);assert.deepEqual((await readWorkspaceDashboard(f.workspace)).settings,d);
 }finally{await holder.close();}
});
test('a conflicting edit remains inspectable and can be explicitly discarded without replacing saved settings',async t=>{
 const f=await fixture(t),initial=await readWorkspaceDashboard(f.workspace),desired=change(initial.settings,'planning'),other=change(initial.settings,'resources');
 const queued=await f.queue.submit(f.workspace,{id:randomUUID(),settings:desired,etag:initial.etag});await writeWorkspaceDashboard(f.workspace,other,initial.etag);
 await assert.rejects(f.queue.apply(f.workspace),{code:'DASHBOARD_CHANGED'});const pending=await f.queue.read(f.workspace);assert.equal(pending.error,'DASHBOARD_CHANGED');assert.deepEqual(pending.settings,desired);assert.deepEqual((await readWorkspaceDashboard(f.workspace)).settings,other);
 await assert.rejects(f.queue.discard(f.workspace,randomUUID()),{code:'CONFLICT'});await f.queue.discard(f.workspace,queued.id);assert.equal(await f.queue.read(f.workspace),null);
});
test('a lost completion checkpoint is recognized and pending intent follows only an explicit verified handoff',async t=>{
 const f=await fixture(t),initial=await readWorkspaceDashboard(f.workspace),desired=change(initial.settings,'planning');
 await f.queue.submit(f.workspace,{id:randomUUID(),settings:desired,etag:initial.etag});
 const transaction=f.queue.transaction.bind(f.queue);let calls=0;f.queue.transaction=async(...args)=>{if(++calls===2)throw Error('Simulated lost completion checkpoint');return transaction(...args);};
 await assert.rejects(f.queue.apply(f.workspace),/lost completion/);assert.deepEqual((await readWorkspaceDashboard(f.workspace)).settings,desired);
 const restarted=new DashboardEdits(f.queue.directory);await restarted.apply(f.workspace);assert.equal(await restarted.read(f.workspace),null);
 const next=change(desired,'resources');await restarted.submit(f.workspace,{id:randomUUID(),settings:next,etag:(await readWorkspaceDashboard(f.workspace)).etag});
 const target=await copyWorkspaceTo(f.workspace.root,path.join(f.directory,'copy'),{vault:f.vault,activateCatalogue:true}),destination=new Workspace(target,f.vault);
 assert.equal(await restarted.read(destination),null);await restarted.relocate(f.workspace,destination);assert.equal(await restarted.read(f.workspace),null);await restarted.apply(destination);
 assert.deepEqual((await readWorkspaceDashboard(destination)).settings,next);assert.deepEqual((await readWorkspaceDashboard(f.workspace)).settings,desired);
});

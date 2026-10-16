import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';
import {WorkspaceRenames} from '../src/workspace-rename.js';
import {workspaceRename} from '../src/workspace-rename-state.js';
import {workspaceRenameRecovery,resumeWorkspaceRename} from '../src/workspace-rename-recovery.js';
import {startServer} from '../src/server.js';

async function fixture(t){
 const parent=await fs.mkdtemp(path.join(os.tmpdir(),'observanda-rename-recovery-')),provider=new WorkspaceDatabases({directory:path.join(parent,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),f=await encryptedFixture(parent,sampleNotebook());
 t.after(async()=>{await provider.close();detach();clearVault(f.vault);assert.equal(path.dirname(path.resolve(parent)),path.resolve(os.tmpdir()));assert.ok(path.basename(parent).startsWith('observanda-rename-recovery-'));await fs.rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});});return {...f,parent};
}
async function client(app){
 const opened=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});assert.equal(opened.status,200,await opened.clone().text());const cookie=opened.headers.get('set-cookie').split(';')[0];let context;
 const call=async(route,data)=>{const response=await fetch(app.origin+route,{signal:AbortSignal.timeout(60000),method:data===undefined?'GET':'POST',headers:{Origin:app.origin,Cookie:cookie,'Content-Type':'application/json',...(context?{'X-Observanda-Workspace':context}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:response.status,value:await response.json()};};context=(await call('/api/storage')).value.contextId;return {call,adopt:value=>context=value.contextId};
}

test('failed physical rename remains authenticated and resumes without confusing the access settings',{timeout:120000},async t=>{
 const f=await fixture(t),source=f.workspace.root,name='Renamed workspace',destination=path.join(f.parent,name),before=await f.workspace.read(),app=await startServer({root:source,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(f.parent,'preferences.json')});t.after(()=>app.close());const a=await client(app),etag=(await a.call('/api/notebook')).value.etag;
 const rename=fs.rename,finish=WorkspaceRenames.prototype.finishLocked;let fail=true,held,release;
 const reached=new Promise(resolve=>held=resolve),gate=new Promise(resolve=>release=resolve);
 fs.rename=async(from,to)=>{if(from===source&&to===destination&&fail){fail=false;throw Object.assign(Error('Disposable rename fault'),{code:'EBUSY'});}return rename(from,to);};syncBuiltinESMExports();
 WorkspaceRenames.prototype.finishLocked=function(value,vault,options){return finish.call(this,value,vault,{...options,checkpoint:async(stage,receipt)=>{await options?.checkpoint?.(stage,receipt);if(value.source===source&&stage==='renamed'){held();await gate;}}});};
 try{
  const failed=await a.call('/api/storage/rename',{name,etag});assert.equal(failed.value.code,'IO',JSON.stringify(failed));
  const pending=await a.call('/api/storage');assert.equal(pending.status,200,JSON.stringify(pending));assert.equal(pending.value.rename.name,name);assert.equal(pending.value.available,false);assert.ok(await workspaceRename(source));
  assert.equal((await a.call('/api/storage/rename/resume',{id:randomUUID()})).value.code,'STORAGE_RENAME_STATE');
  const resumed=a.call('/api/storage/rename/resume',{id:pending.value.rename.id});
  await Promise.race([reached,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Rename did not reach handoff')),45000);timer.unref();})]);
  await assert.rejects(fs.stat(source),{code:'ENOENT'});
  const access=await a.call('/api/access/status');assert.equal(access.status,200,JSON.stringify(access));assert.equal(access.value.encrypted,true);assert.equal(access.value.locked,false);
  assert.equal((await a.call('/api/activity')).status,200);release();const result=await resumed;assert.equal(result.status,200,JSON.stringify(result));a.adopt(result.value);
  assert.equal(result.value.root,destination);assert.equal(result.value.rename,undefined);assert.equal(await workspaceRename(destination),null);assert.deepEqual((await new Workspace(destination,f.vault).read()).book.entries,before.book.entries);
 }finally{release();fs.rename=rename;syncBuiltinESMExports();WorkspaceRenames.prototype.finishLocked=finish;}
});

test('completed rename fences remain recoverable and changed destination identity is rejected',{timeout:120000},async t=>{
 const f=await fixture(t),renames=new WorkspaceRenames(path.join(f.parent,'journals')),source=f.workspace.root,destination=path.join(f.parent,'Completed workspace');
 await assert.rejects(renames.begin(f.workspace,path.basename(destination),{checkpoint:async stage=>{if(stage==='complete')throw Error('Interrupted completion');}}),/Interrupted completion/);
 const descriptor=await workspaceRenameRecovery(renames,source);assert.equal(descriptor.phase,'complete');assert.ok(await workspaceRename(destination));
 const receipt=await renames.read(descriptor.id);await renames.save({...receipt,identity:{...receipt.identity,ino:receipt.identity.ino+'1'}});
 await assert.rejects(workspaceRenameRecovery(renames,source),{code:'STORAGE_RENAME_STATE'});
 await renames.save(receipt);const result=await resumeWorkspaceRename(renames,source,descriptor.id,f.vault);assert.equal(result.destination,destination);assert.equal(await workspaceRename(destination),null);
 // A final activation can still follow the receipt after its marker is removed.
 assert.equal((await workspaceRenameRecovery(renames,source)).id,descriptor.id);assert.equal(await workspaceRenameRecovery(renames,destination),null);
});

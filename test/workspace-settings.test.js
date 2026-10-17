import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from '../src/security/dashboard-storage.js';
import {projectDomainHandoff,projectDomainLock} from '../src/project-domain-lock.js';
import {catalogueStamp} from '../src/postgres.js';
import {catalogueFormat} from '../src/catalogue-format.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-workspace-settings-'));
 const runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime);
 const f=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{await runtime.close();detach();clearVault(f.vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-workspace-settings-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 return {...f,runtime};
}
test('workspace preferences persist independently of research writes with conflict and lifecycle fencing',{timeout:90000},async t=>{
 const f=await fixture(t);
 await f.workspace.update(book=>{book.entries[0].results={version:1,statements:[{id:randomUUID(),kind:'conclusion',title:'Retained observation',text:'Observed result',basis:'authored',source:null,limitations:'Test scope'}]};return book;});
 assert.equal(await f.workspace.catalogue(store=>catalogueFormat(store.db)),28);
 const before=await readWorkspaceDashboard(f.workspace),head=(await f.workspace.outline()).etag,stamp=await catalogueStamp(f.workspace.root),settings=structuredClone(before.settings);settings.enabledModules=['planning'];
 const db=await f.workspace.openCatalogue();
 try{
  await db.run('BEGIN');await db.lock();
  const saved=await writeWorkspaceDashboard(f.workspace,settings,before.etag);assert.deepEqual(saved.settings,settings);assert.notEqual(saved.etag,before.etag);
  assert.equal((await f.workspace.outline()).etag,head);assert.notEqual(await catalogueStamp(f.workspace.root),stamp);
  await assert.rejects(writeWorkspaceDashboard(f.workspace,before.settings,before.etag),{code:'DASHBOARD_CHANGED'});
  await db.run('ROLLBACK');await db.run('BEGIN');await projectDomainHandoff(db);
  await assert.rejects(writeWorkspaceDashboard(f.workspace,before.settings,saved.etag),{code:'LOCKED'});
  await db.run('ROLLBACK');await db.run('BEGIN');await projectDomainLock(db,'Observanda/workspace-settings/'+db.id+'/dashboard');
  await assert.rejects(writeWorkspaceDashboard(f.workspace,before.settings,saved.etag),{code:'LOCKED'});
  // A preferences lock does not block a research transaction.
  await f.workspace.update(book=>{book.description='Independent research change';return book;});
  await db.run('ROLLBACK');
 }finally{await db.close();}
 await f.runtime.closeWorkspace(f.workspace.root);
 assert.deepEqual((await readWorkspaceDashboard(new Workspace(f.workspace.root,f.vault))).settings,settings);
 await f.workspace.withLock(()=>assert.rejects(f.workspace.writeMetadata('.observanda/dashboard.observanda',JSON.stringify(before.settings)),{code:'ACCESS_UPGRADE'}));
});
test('missing or misbound workspace preference state fails verification instead of resetting settings',{timeout:90000},async t=>{
 const f=await fixture(t),verify=()=>f.workspace.catalogue(async store=>store.verify({format:'observanda-research-catalogue',version:2,workspaceId:(await store.snapshot()).metadata.id}));
 await verify();
 for(const slot of ['workspace-settings','workspace-settings:dashboard']){
  const saved=await f.workspace.catalogue(store=>store.db.get('SELECT payload FROM state WHERE slot=$1',slot));
  await f.workspace.withLock(()=>f.workspace.catalogue(store=>store.db.run('DELETE FROM state WHERE slot=$1',slot)));
  await assert.rejects(readWorkspaceDashboard(f.workspace),{code:'CATALOGUE_DAMAGED'});await assert.rejects(verify(),{code:'CATALOGUE_DAMAGED'});
  await f.workspace.withLock(()=>f.workspace.catalogue(store=>store.db.run('INSERT INTO state VALUES ($1,$2)',slot,saved.payload)));
 }
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{const value=store.decode('state','workspace-settings',(await store.db.get("SELECT payload FROM state WHERE slot='workspace-settings'")).payload);value.namespaceId=randomUUID();await store.db.run("UPDATE state SET payload=$1 WHERE slot='workspace-settings'",store.encode('state','workspace-settings',value));}));
 await assert.rejects(readWorkspaceDashboard(f.workspace),{code:'CATALOGUE_DAMAGED'});
});

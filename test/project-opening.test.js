import {ProjectStorage} from '../src/project-storage.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {createNotebook} from '../src/model.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectOpening} from '../src/project-opening.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {catalogueBinding} from '../src/postgres-activation.js';
import {RecordWriting} from '../src/record-writing.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {TestDeviceStore} from './device-fixture.js';
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-open-')),owners=[],vaults=[];let detach;
 const next=()=>{detach?.();const owner=new WorkspaceDatabases({directory:path.join(directory,'runtime-'+owners.length),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}});owners.push(owner);detach=installDatabaseProvider(owner);return owner;};
 const owner=next();t.after(async()=>{for(const item of owners.toReversed())await item.close();detach?.();vaults.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-open-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const f=await encryptedFixture(path.join(directory,'workspace'),createNotebook('Workspace',''));vaults.push(f.vault);const registry=new ProjectRegistry(f.workspace,(await f.workspace.outline()).metadata.id);
 const book=sampleNotebook(),id=book.projects[0].id,access=await createWorkspaceAccess('','Project password',f.deviceStore),vault=takeCreatedVault(access);vaults.push(vault);book.title=book.projects[0].title='project';const storage=await initializeProjectLocation(path.join(directory,'project'),id,book,access,vault);
 const command={id:randomUUID(),path:storage.root,username:'',password:'Project password',recovery:''},opening=new ProjectOpening(registry,f.deviceStore);return {...f,directory,registry,book,id,storage,command,opening,owner,next};
}

test('import registers one nested owner while workspace writes are held, retries a lost acknowledgement and preserves later edits',async t=>{
 const f=await fixture(t),before=await f.storage.outline(),access=(await readAccess(f.storage.root)).etag;let release,entered;const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve),holding=f.workspace.withLock(async()=>{entered();await gate;});await ready;
 try{
  await assert.rejects(f.opening.open({...f.command,password:'Wrong password'}),{code:'PROJECT_IMPORT_ACCESS'});assert.equal((await f.registry.read()).value.projects.length,0);assert.equal((await readAccess(f.storage.root)).etag,access);
  await assert.rejects(f.opening.open(f.command,{checkpoint:async stage=>{if(stage==='registered')throw Error('Lost opening reply');}}),/Lost opening reply/);assert.equal((await f.registry.read()).value.projects.length,1);
  const target={workspaceId:f.book.id,recordId:f.book.entries[0].id,sectionId:null},writing=new RecordWriting(new ProjectStorage((await f.registry.locate(f.id)).root,f.id,f.storage.vault)),view=await writing.read(target);await writing.save({...target,expectedRevision:view.revision,value:{body:'Authored after registration'}});
  const reopened=await f.opening.open(f.command);assert.equal(reopened.project.projectId,f.id);assert.equal(reopened.project.namespaceId,f.book.id);assert.equal((await f.registry.read()).value.projects.length,1);assert.equal((await writing.read(target)).value.body,'Authored after registration');assert.equal((await f.storage.outline()).etag,before.etag);assert.notEqual((await new ProjectStorage(reopened.project.root,f.id,f.storage.vault).outline()).etag,before.etag);assert.equal((await readAccess(f.storage.root)).etag,access);
 }finally{release();await holding;}
});

test('opening refuses workspace roots, overlapping owners and another location for an already registered identity',async t=>{
 const f=await fixture(t);await f.opening.open(f.command);const before=(await f.registry.read()).revision;
 await assert.rejects(f.opening.open({...f.command,id:randomUUID(),path:f.workspace.root}),{code:'STORAGE_PATH'});
 await assert.rejects(f.opening.open({...f.command,id:randomUUID(),path:f.storage.root}),{code:'PROJECT_LOCATION_EXISTS'});assert.equal((await f.registry.read()).revision,before);
 for(const command of [{...f.command,extra:true},{...f.command,password:3},{...f.command,recovery:'x'.repeat(1025)}])await assert.rejects(f.opening.open(command),{code:'INVALID'});
});

test('a portable project opens from a different installation and device using its project password and retained identities',async t=>{
 const f=await fixture(t),before=await f.storage.outline();await f.owner.close();f.next();const deviceStore=new TestDeviceStore({file:path.join(f.directory,'second-device')}),opening=new ProjectOpening(f.registry,deviceStore);
 await assert.rejects(opening.open({...f.command,password:''}),{code:'PROJECT_IMPORT_ACCESS'});
 let read;const result=await opening.open(f.command,{opened:async(entry,access,vault)=>{const {ProjectStorage}=await import('../src/project-storage.js');read=await new ProjectStorage(entry.root,entry.projectId,vault).outline();}});assert.equal(result.project.namespaceId,f.book.id);assert.equal(result.project.root,path.join(f.workspace.root,path.basename(f.storage.root)));assert.equal(read.etag,before.etag);assert.deepEqual(read.metadata,before.metadata);
});

test('a revoked opening cannot register or hand out an authenticated owner after its metadata read',async t=>{
 const f=await fixture(t);let revoked=false,called=false;
 await assert.rejects(f.opening.open(f.command,{check:async()=>{if(revoked)throw Object.assign(Error('Locked'),{code:'ACCESS_LOCKED'});},checkpoint:async stage=>{if(stage==='prepared')revoked=true;},opened:async()=>{called=true;}}),{code:'ACCESS_LOCKED'});assert.equal(called,false);assert.equal((await f.registry.read()).value.projects.length,0);
});

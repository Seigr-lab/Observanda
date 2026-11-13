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
 const owner=next();t.after(async()=>{for(const item of owners.toReversed())await item.close();detach?.();await Promise.all(vaults.map(clearVault));assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-open-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const f=await encryptedFixture(path.join(directory,'workspace'),createNotebook('Workspace',''));vaults.push(f.vault);const registry=new ProjectRegistry(f.workspace,(await f.workspace.outline()).metadata.id);
 const book=sampleNotebook(),id=book.projects[0].id,access=await createWorkspaceAccess('','Project password',f.deviceStore),vault=takeCreatedVault(access);vaults.push(vault);book.title=book.projects[0].title='project';
 // The selected folder is a project of another workspace (every project lives in one).
 const source=await encryptedFixture(path.join(directory,'source'),createNotebook('Source workspace',''));vaults.push(source.vault);await source.workspace.outline();
 const storage=await initializeProjectLocation(path.join(source.workspace.root,'project'),id,book,access,vault);
 const command={id:randomUUID(),path:storage.root,username:'',password:'Project password',recovery:''},opening=new ProjectOpening(registry,f.deviceStore);return {...f,directory,source,registry,book,id,storage,command,opening,owner,next};
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
 // Another installation receives the project as a portable copy, which carries no database.
 const f=await fixture(t),before=await f.storage.outline(),{copyProjectLocation}=await import('../src/project-transfer.js'),portable=path.join(f.directory,'portable',path.basename(f.storage.root));await mkdir(path.dirname(portable));await copyProjectLocation(f.storage,portable,{id:randomUUID(),portable:true});
 await f.owner.close();f.next();const deviceStore=new TestDeviceStore({file:path.join(f.directory,'second-device')}),opening=new ProjectOpening(f.registry,deviceStore),command={...f.command,path:portable};
 await assert.rejects(opening.open({...command,password:''}),{code:'PROJECT_IMPORT_ACCESS'});
 let read;const result=await opening.open(command,{opened:async(entry,access,vault)=>{const {ProjectStorage}=await import('../src/project-storage.js');read=await new ProjectStorage(entry.root,entry.projectId,vault).outline();}});assert.equal(result.project.namespaceId,f.book.id);assert.equal(result.project.root,path.join(f.workspace.root,path.basename(f.storage.root)));assert.equal(read.etag,before.etag);assert.deepEqual(read.metadata,before.metadata);
});

test('a revoked opening cannot register or hand out an authenticated owner after its metadata read',async t=>{
 const f=await fixture(t);let revoked=false,called=false;
 await assert.rejects(f.opening.open(f.command,{check:async()=>{if(revoked)throw Object.assign(Error('Locked'),{code:'ACCESS_LOCKED'});},checkpoint:async stage=>{if(stage==='prepared')revoked=true;},opened:async()=>{called=true;}}),{code:'ACCESS_LOCKED'});assert.equal(called,false);assert.equal((await f.registry.read()).value.projects.length,0);
});

test('a project folder outside the workspace is never registered, reopened or opened from an earlier registration',async t=>{
 const f=await fixture(t),entry=await f.registry.describe(f.storage,null);assert.notEqual(path.dirname(entry.root),f.workspace.root);
 await assert.rejects(f.registry.attach(f.storage,{expected:'new'}),{code:'PROJECT_OUTSIDE_WORKSPACE'});
 await assert.rejects(f.registry.registerExisting('new',entry),{code:'PROJECT_OUTSIDE_WORKSPACE'});assert.equal((await f.registry.read()).value.projects.length,0);
 // A location an earlier version registered stays listed, but is refused.
 await f.registry.apply('new',[{state:'active',entry}]);const revision=(await f.registry.read()).revision;
 await assert.rejects(f.opening.open({...f.command,id:randomUUID()}),{code:'PROJECT_OUTSIDE_WORKSPACE'});assert.equal((await f.registry.read()).revision,revision);
 const {ProjectRouter}=await import('../src/project-router.js');let unlocked=0;
 for(const transit of [undefined,async()=>false]){
  const router=new ProjectRouter(f.registry,{authorize:async()=>true,unlock:async()=>{unlocked++;return f.storage.vault;},...(transit?{transit}:{})});
  await assert.rejects(router.withProject(f.id,()=>assert.fail('An outside owner was opened')),error=>error.code==='PROJECT_OUTSIDE_WORKSPACE'&&error.projectId===f.id);
 }
 assert.equal(unlocked,0);assert.equal((await f.registry.read()).revision,revision);
});

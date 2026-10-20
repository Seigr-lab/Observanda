import '../src/storage.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {ScopedLocationAccess} from '../src/scoped-location-access.js';
import {ProjectSessionOwner} from '../src/project-session-owner.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {createNotebook} from '../src/model.js';
import {cloneVault,clearVault} from '../src/encryption.js';
import {projectTreeFixture} from './project-tree-fixture.js';
import {ProjectApplication} from '../src/project-application.js';
import {ProjectRenames} from '../src/project-rename.js';
import {readAccess} from '../src/access.js';
import {workspaceRename} from '../src/workspace-rename-state.js';

test('scoped location admission releases every borrowed key and checks recorded parent/book revocation',{timeout:120000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-scoped-access-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime);let vault;
 t.after(async()=>{await runtime.close();detach();clearVault(vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-scoped-access-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const fixture=await encryptedFixture(path.join(directory,'Scoped Access Workspace'),createNotebook('Scoped Access Workspace'));vault=fixture.vault;await fixture.workspace.outline();
 const session=new Map(),application={closed:false,session:()=>session,tracked:operation=>operation()},client={};let active=0,peak=0,last;
 const close=ProjectSessionOwner.prototype.close;
 t.mock.method(ProjectSessionOwner.prototype,'use',async function(operation){this.vault={id:randomUUID(),key:randomBytes(32)};active++;peak=Math.max(peak,active);return operation({projectId:this.projectId,vault:this.vault});});
 t.mock.method(ProjectSessionOwner.prototype,'close',async function(){const had=!!this.vault;await close.call(this);if(had)active--;});
 await ScopedLocationAccess.run(application,client,{},async scoped=>{
  for(let n=0;n<129;n++){const id=randomUUID();await scoped.withProject(id,storage=>{last=storage.vault;assert.ok(Buffer.isBuffer(last.key));});assert.equal(last.key,null);assert.equal(active,0);}
  const parent=randomUUID(),book=randomUUID(),bookId='book:'+parent+':'+book;
  await scoped.remember(parent,undefined);await scoped.remember(bookId,undefined);await scoped.check({projectId:parent,labBookId:book});
  session.set(parent,{locked:true});await assert.rejects(scoped.check({projectId:parent,labBookId:book}),error=>error.code==='ACCESS_LOCKED'&&error.projectId===parent);session.delete(parent);
  session.set(bookId,{locked:true});await assert.rejects(scoped.check({projectId:parent,labBookId:book}),error=>error.code==='ACCESS_LOCKED'&&error.labBookId===book);session.delete(bookId);await scoped.check();
 });assert.equal(peak,1);assert.equal(active,0);
});

test('native rename refuses a captured book grant revoked before publication without fencing the tree',{timeout:180000},async t=>{
 const f=await projectTreeFixture(t),application=new ProjectApplication(f.workspace,{deviceStore:f.deviceStore}),client={},session=application.session(client),selected=f.projects[0],book=f.books[1];t.after(()=>application.close());
 for(const item of [...f.projects,...f.books]){const id=item.labBookId?'book:'+item.projectId+':'+item.labBookId:item.projectId,saved={root:item.root,etag:(await readAccess(item.root)).etag,vault:cloneVault(item.key),expires:Date.now()+60000};session.set(id,saved);application.credentials.add(saved);}
 const renames=new ProjectRenames(f.registry,selected.projectId),id=randomUUID();
 await assert.rejects(ScopedLocationAccess.run(application,client,{skipRenameId:id},scoped=>scoped.withProject(selected.projectId,storage=>renames.run(storage,{id,name:'Revoked Relocation',expectedName:path.basename(storage.root),withProject:(id,use)=>scoped.withProject(id,use),withBook:(parent,id,use)=>scoped.withBook(parent,id,use),check:owner=>scoped.check(owner),checkpoint:async stage=>{if(stage==='prepared'){application.forget(session,'book:'+book.projectId+':'+book.labBookId);session.set('book:'+book.projectId+':'+book.labBookId,{locked:true});}}}))),error=>error.code==='ACCESS_LOCKED'&&error.labBookId===book.labBookId);
 assert.equal((await renames.read()).phase,'prepared');assert.equal(await workspaceRename(selected.root),null);assert.equal((await f.registry.locate(selected.projectId)).root,selected.root);
 await renames.cancelPrepared(selected.key);assert.equal((await renames.read()).keysReleased,true);
});

test('scoped installation binds replacement applications to the staged workspace destination',async()=>{
 const client={},session=new Map(),source=path.resolve('Source Workspace'),destination=path.resolve('Renamed Workspace');let reads=0;
 const application={workspace:{root:source},session:()=>session,registry:async()=>{reads++;return {};}};
 const scoped=new ScopedLocationAccess(application,client,{},null,{async *items(){}});scoped.destination=destination;
 const replacement={...application,workspace:{root:path.resolve('Unrelated Workspace')}};
 await assert.rejects(scoped.install(replacement),{code:'ACCESS_DENIED'});assert.equal(reads,0);
 replacement.workspace.root=destination;await scoped.install(replacement);assert.equal(reads,1);
 await scoped.install();assert.equal(reads,2);
});

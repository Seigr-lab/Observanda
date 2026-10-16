import {LabBookRenames} from '../src/lab-book-rename.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat,readdir} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {createNotebook} from '../src/model.js';
import {sampleNotebook} from '../src/sample.js';
import {initializeLocation} from '../src/locations.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {TestDeviceStore} from './device-fixture.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectCreation} from '../src/project-creation.js';
import {ProjectStorage} from '../src/project-storage.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {WorkspaceRenames} from '../src/workspace-rename.js';
import {workspaceRename} from '../src/workspace-rename-state.js';
import {catalogueBinding} from '../src/postgres-activation.js';
import {startServer} from '../src/server.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-nested-rename-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),vaults=[];
 t.after(async()=>{await provider.close();detach();vaults.forEach(clearVault);assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-nested-rename-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const deviceStore=new TestDeviceStore({file:path.join(directory,'device.key')}),book=createNotebook('Research Workspace 1'),root=path.join(directory,book.title),access=await createWorkspaceAccess('','',deviceStore),vault=takeCreatedVault(access);vaults.push(vault);await initializeLocation(root,book,access,vault);
 const workspace=new Workspace(root,vault),registry=new ProjectRegistry(workspace,book.id),projectId=randomUUID(),{project:entry}=await new ProjectCreation(registry,deviceStore).create({id:randomUUID(),username:'',password:'',project:{id:projectId,title:'Field Project 1',description:'',parentId:null,share:false,logoId:null}});
 const projectKey=await verifyAccess(await readAccess(entry.root),'','',{deviceStore});vaults.push(projectKey);const project=new ProjectStorage(entry.root,projectId,projectKey),creation=new LabBookCreation(project,deviceStore),books=[];
 for(const title of ['Field observations 1','Measurements 2']){const password=title==='Measurements 2'?'Protected book password 345!':'',result=await creation.create({id:randomUUID(),username:'',password,book:{id:randomUUID(),projectId,title}}),key=await verifyAccess(await readAccess(result.book.root),'',password,{deviceStore});vaults.push(key);const storage=new LabBookStorage(result.book.root,result.book.labBookId,key);await storage.update(book=>{book.entries=[{...sampleNotebook().entries[0],id:randomUUID(),notebookId:storage.labBookId,title:'Observation in '+title}];return book;});books.push({entry:result.book,key,password,before:await storage.read(),binding:await catalogueBinding(storage.root),inode:(await stat(path.join(storage.root,'.observanda/postgresql/data/PG_VERSION'))).ino});}
 return {directory,provider,deviceStore,vault,workspace,project,projectKey,projectId,books};
}
async function assertBooks(f,root){
 const project=new ProjectStorage(path.join(root,'Field Project 1'),f.projectId,f.projectKey),registry=new LabBookRegistry(project);
 for(const saved of f.books){const entry=await registry.locate(saved.entry.labBookId),storage=new LabBookStorage(entry.root,entry.labBookId,saved.key);const read=await storage.read();if(saved.renamedName){assert.deepEqual(read.book.entries,saved.before.book.entries);assert.equal(read.book.title,saved.renamedName);assert.equal(read.book.notebooks[0].title,saved.renamedName);}else assert.deepEqual(read,saved.before);assert.deepEqual(await catalogueBinding(entry.root),saved.binding);assert.equal((await stat(path.join(entry.root,'.observanda/postgresql/data/PG_VERSION'))).ino,saved.inode);assert.equal(await workspaceRename(entry.root),null);}
 return project;
}
test('parent rename recovers nested dedicated books without replacing their databases',{timeout:240000},async t=>{
 const f=await fixture(t),renames=new WorkspaceRenames(path.join(f.directory,'rename-journals'));let source=f.workspace.root;
 for(const boundary of ['book-stopped','renamed','complete']){
  let competingWrite;
  const workspace=new Workspace(source,f.vault),project=new ProjectStorage(path.join(source,'Field Project 1'),f.projectId,f.projectKey),name='Research Workspace '+boundary,target=path.join(f.directory,name),options={withProject:async(id,use)=>{assert.equal(id,f.projectId);return use(project);},withBook:async(parent,id,use)=>{const entry=await new LabBookRegistry(parent).locate(id),saved=f.books.find(book=>book.entry.labBookId===id);return use(new LabBookStorage(entry.root,id,saved.key));},checkpoint:async stage=>{if(stage==='prepared'&&boundary==='book-stopped'){const saved=f.books[1];competingWrite=new LabBookStorage(path.join(source,'Field Project 1',saved.entry.directory),saved.entry.labBookId,saved.key).update(book=>({...book,description:'Must not commit during the parent handoff'})).then(()=>({committed:true}),error=>({code:error.code}));}if(stage===boundary)throw Error('Interrupted '+boundary);}};
  await assert.rejects(renames.begin(workspace,name,options),new RegExp('Interrupted '+boundary));
  if(boundary==='book-stopped'){
   assert.deepEqual(await competingWrite,{code:'STORAGE_RENAMING'});
   await assert.rejects(new LabBookStorage(path.join(source,'Field Project 1','Measurements 2'),f.books[1].entry.labBookId,f.books[1].key).read(),{code:'STORAGE_RENAMING'});
   await assert.rejects(new LabBookCreation(project,f.deviceStore).create({id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId:f.projectId,title:'Blocked during handoff'}}),{code:'STORAGE_RENAMING'});
  }
  const restart=new WorkspaceRenames(path.join(f.directory,'rename-journals')),located=await restart.resolvedRoot(source);
  if(boundary==='complete')await restart.clearCompleted(target);else await restart.resume(located,f.vault);
  const moved=await assertBooks(f,target);assert.equal(await workspaceRename(target),null);assert.equal(await workspaceRename(moved.root),null);await assert.rejects(readdir(source),{code:'ENOENT'});await assert.rejects(readFile(path.join(moved.root,'.observanda/rename-project-keys.observanda')),{code:'ENOENT'});source=target;
 }
});
async function client(app){
 const opened=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});assert.equal(opened.status,200);const cookie=opened.headers.get('set-cookie').split(';')[0];let context;
 const call=async(route,data)=>{const response=await fetch(app.origin+route,{signal:AbortSignal.timeout(120000),method:data===undefined?'GET':'POST',headers:{Origin:app.origin,Cookie:cookie,'Content-Type':'application/json','X-Observanda-Wait':'1',...(context?{'X-Observanda-Workspace':context}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:response.status,value:await response.json()};};
 context=(await call('/api/storage')).value.contextId;return {call,adopt:value=>context=value.contextId};
}
test('HTTP parent rename authenticates protected books and retains only the requesting grants',{timeout:180000},async t=>{
 const f=await fixture(t),options={root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(f.directory,'preferences.json')};let app=await startServer(options);t.after(()=>app.close());
 const a=await client(app),b=await client(app),snapshot=(await a.call('/api/notebook')).value,protectedBook=f.books[1],prefix='/api/projects/'+f.projectId+'/lab-books/'+protectedBook.entry.labBookId;
 protectedBook.renamedName='Measurements archive 2';await assert.rejects(new LabBookRenames(f.project).run(new LabBookStorage(protectedBook.entry.root,protectedBook.entry.labBookId,protectedBook.key),{id:randomUUID(),expectedName:protectedBook.entry.directory,name:protectedBook.renamedName,checkpoint:async stage=>{if(stage==='renamed')throw Error('Interrupted book rename');}}),/Interrupted book rename/);
 const denied=await a.call('/api/storage/rename',{name:'Renamed Research Workspace',etag:snapshot.etag});assert.equal(denied.status,422,JSON.stringify(denied));assert.equal(denied.value.code,'DEVICE_UNKNOWN');assert.equal(denied.value.projectId,f.projectId);assert.equal(denied.value.labBookId,protectedBook.entry.labBookId);assert.equal(await workspaceRename(f.workspace.root),null);
 assert.equal((await a.call(prefix+'/access/unlock',{username:'',password:protectedBook.password,recovery:''})).status,200);
 const moved=await a.call('/api/storage/rename',{name:'Renamed Research Workspace',etag:snapshot.etag});assert.equal(moved.status,200,JSON.stringify(moved));a.adopt(moved.value);await assertBooks(f,moved.value.root);
 const selected=await a.call(prefix+'/workspace/read/start',{});assert.equal(selected.status,200,JSON.stringify(selected));assert.equal((await b.call(prefix+'/workspace/read/start',{})).status,409);
 await app.close();app=await startServer({...options,root:moved.value.root});const reopened=await client(app);const locked=await reopened.call(prefix+'/workspace/read/start',{});assert.equal(locked.value.code,'DEVICE_UNKNOWN');assert.equal((await reopened.call(prefix+'/access/unlock',{username:'',password:protectedBook.password,recovery:''})).status,200);assert.equal((await reopened.call(prefix+'/workspace/read/start',{})).status,200);
});


test('HTTP interrupted parent rename retains existing protected book access when the source is already absent',{timeout:180000},async t=>{
 const f=await fixture(t),app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(f.directory,'preferences.json')});t.after(()=>app.close());
 const a=await client(app),b=await client(app),snapshot=(await a.call('/api/notebook')).value,protectedBook=f.books[1],prefix='/api/projects/'+f.projectId+'/lab-books/'+protectedBook.entry.labBookId;
 assert.equal((await a.call(prefix+'/access/unlock',{username:'',password:protectedBook.password,recovery:''})).status,200);
 const finish=WorkspaceRenames.prototype.finishLocked;let interrupted=false;
 WorkspaceRenames.prototype.finishLocked=function(value,vault,options){return finish.call(this,value,vault,{...options,checkpoint:async(stage,receipt)=>{await options?.checkpoint?.(stage,receipt);if(value.source===f.workspace.root&&stage==='renamed'&&!interrupted){interrupted=true;throw Object.assign(Error('Disposable interruption after move'),{code:'EBUSY'});}}});};
 try{
  const failed=await a.call('/api/storage/rename',{name:'Resumed Research Workspace',etag:snapshot.etag});assert.equal(failed.value.code,'IO',JSON.stringify(failed));await assert.rejects(readdir(f.workspace.root),{code:'ENOENT'});
  const pending=await a.call('/api/storage');assert.equal(pending.status,200,JSON.stringify(pending));assert.ok(pending.value.rename);
  const moved=await a.call('/api/storage/rename/resume',{id:pending.value.rename.id});assert.equal(moved.status,200,JSON.stringify(moved));a.adopt(moved.value);await assertBooks(f,moved.value.root);
  assert.equal((await a.call(prefix+'/workspace/read/start',{})).status,200);assert.equal((await b.call(prefix+'/workspace/read/start',{})).status,409);
  b.adopt(moved.value);assert.equal((await b.call(prefix+'/workspace/read/start',{})).value.code,'DEVICE_UNKNOWN');
 }finally{WorkspaceRenames.prototype.finishLocked=finish;}
});

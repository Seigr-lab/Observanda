import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {ProjectAccessSettings} from '../src/project-access-settings.js';
import {startServer} from '../src/server.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,readdir,readFile} from 'node:fs/promises';
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
import {ProjectRenames} from '../src/project-rename.js';
import {WorkspaceRenames} from '../src/workspace-rename.js';
import {workspaceRename} from '../src/workspace-rename-state.js';
import {catalogueBinding} from '../src/postgres-activation.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-rename-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),vaults=[];
 t.after(async()=>{await provider.close();detach();vaults.forEach(clearVault);assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-rename-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const deviceStore=new TestDeviceStore({file:path.join(directory,'device.key')}),metadata=createNotebook('Research Workspace 1'),root=path.join(directory,metadata.title),access=await createWorkspaceAccess('','',deviceStore),vault=takeCreatedVault(access);vaults.push(vault);await initializeLocation(root,metadata,access,vault);
 const workspace=new Workspace(root,vault),registry=new ProjectRegistry(workspace,metadata.id),creation=new ProjectCreation(registry,deviceStore),projects=[],books=[];
 for(const title of ['Field Project 1','Nested Project 2']){
  const projectId=randomUUID(),{project:entry}=await creation.create({id:randomUUID(),username:'',password:'',project:{id:projectId,title,description:'',parentId:projects[0]?.projectId??null,share:false,logoId:null}}),key=await verifyAccess(await readAccess(entry.root),'','',{deviceStore});vaults.push(key);
  const storage=new ProjectStorage(entry.root,projectId,key);projects.push({...entry,key,binding:await catalogueBinding(entry.root),inode:(await stat(path.join(entry.root,'.observanda/postgresql/data/PG_VERSION'))).ino});
  const {book}=await new LabBookCreation(storage,deviceStore).create({id:randomUUID(),username:'',password:'Protected observations 456!',book:{id:randomUUID(),projectId,title:'Observations for '+title}}),bookKey=await verifyAccess(await readAccess(book.root),'','Protected observations 456!',{deviceStore});vaults.push(bookKey);const bookStorage=new LabBookStorage(book.root,book.labBookId,bookKey);
  await bookStorage.update(value=>{value.entries=[{...sampleNotebook().entries[0],id:randomUUID(),notebookId:book.labBookId,title:'Retained observation'}];return value;});books.push({...book,projectId,key:bookKey,before:await bookStorage.read(),inode:(await stat(path.join(book.root,'.observanda/postgresql/data/PG_VERSION'))).ino});
 }
 return {directory,provider,deviceStore,workspace,registry,creation,projects,books,root};
}
test('project rename carries nested projects and books through interrupted native handoffs',{timeout:360000},async t=>{
 const {directory,provider,deviceStore,workspace,registry,creation,projects,books,root}=await fixture(t);
 const callbacks={withProject:async(id,use)=>{const entry=await registry.locate(id),saved=projects.find(p=>p.projectId===id);return use(new ProjectStorage(entry.root,id,saved.key));},withBook:async(parent,id,use)=>{const entry=await new LabBookRegistry(parent).locate(id),saved=books.find(b=>b.labBookId===id);return use(new LabBookStorage(entry.root,id,saved.key));}};
 const renames=new ProjectRenames(registry,projects[0].projectId);
 for(const boundary of ['prepared','book-stopped','renamed','registered','complete','unicode','case-only']){
  const old=await registry.locate(projects[0].projectId),storage=new ProjectStorage(old.root,old.projectId,projects[0].key),name=boundary==='unicode'?'Field Project caf\u00e9 2':boundary==='case-only'?path.basename(old.root).toUpperCase():'Field Project '+boundary,before=await storage.outline();
  await assert.rejects(renames.run(storage,{id:randomUUID(),name,expectedName:path.basename(old.root),...callbacks,checkpoint:async stage=>{if(stage===(['unicode','case-only'].includes(boundary)?'renamed':boundary))throw Error('Interrupted '+boundary);}}),new RegExp('Interrupted '+boundary));
  const result=await new ProjectRenames(registry,old.projectId).resume(projects[0].key);assert.equal(result.complete,true);assert.equal(result.project.root,path.join(root,name));if(!['win32','darwin'].includes(process.platform)||boundary!=='case-only')await assert.rejects(readdir(old.root),{code:'ENOENT'});assert.equal((await new ProjectStorage(result.project.root,old.projectId,projects[0].key).readRevision(before.etag)).projects[0].title,before.metadata.projects[0].title);
  for(const saved of projects){const entry=await registry.locate(saved.projectId),project=new ProjectStorage(entry.root,entry.projectId,saved.key);assert.equal(path.dirname(entry.root),saved.parentId?result.project.root:root);assert.equal((await project.outline()).metadata.projects[0].title,path.basename(entry.root));assert.deepEqual(await catalogueBinding(entry.root),saved.binding);assert.equal((await stat(path.join(entry.root,'.observanda/postgresql/data/PG_VERSION'))).ino,saved.inode);assert.equal(await workspaceRename(entry.root),null);await assert.rejects(readFile(path.join(entry.root,'.observanda/rename-project-keys.observanda')),{code:'ENOENT'});await assert.rejects(readFile(path.join(entry.root,'.observanda/rename-book-keys.observanda')),{code:'ENOENT'});
   for(const book of books.filter(book=>book.projectId===saved.projectId)){const item=await new LabBookRegistry(project).locate(book.labBookId),opened=new LabBookStorage(item.root,item.labBookId,book.key);assert.deepEqual(await opened.read(),book.before);assert.equal((await stat(path.join(item.root,'.observanda/postgresql/data/PG_VERSION'))).ino,book.inode);assert.equal(await workspaceRename(item.root),null);}
  }
  const moved=new ProjectStorage(result.project.root,old.projectId,projects[0].key),latest=await moved.outline(),restored=await moved.restore(before.etag,latest.etag);assert.equal(restored.book.title,name);assert.equal(restored.book.projects[0].title,name);assert.equal((await moved.readRevision(before.etag)).title,before.metadata.title);await moved.catalogue(store=>store.verifySnapshot(before.etag,before.metadata.id));
  assert.equal((await workspace.outline()).metadata.title,'Research Workspace 1');
 }
});

async function client(app){
 const opened=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});assert.equal(opened.status,200);const cookie=opened.headers.get('set-cookie').split(';')[0];let context;
 const call=async(route,data)=>{const response=await fetch(app.origin+route,{signal:AbortSignal.timeout(120000),method:data===undefined?'GET':'POST',headers:{Origin:app.origin,Cookie:cookie,'Content-Type':'application/json','X-Observanda-Wait':'1',...(context?{'X-Observanda-Workspace':context}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:response.status,value:await response.json()};};
 context=(await call('/api/storage')).value.contextId;return call;
}
test('project settings rename authenticates nested books and HTTP reads recover interrupted relocation',{timeout:240000},async t=>{
 const f=await fixture(t),options={root:f.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(f.directory,'preferences.json')};let app=await startServer(options);t.after(()=>app.close());
 const a=await client(app),b=await client(app),selected=f.projects[0],prefix='/api/projects/'+selected.projectId,opened=await a(prefix+'/workspace/read/start',{});assert.equal(opened.status,200,JSON.stringify(opened));
 const deniedTitle=await a(prefix+'/workspace/structure',{etag:opened.value.etag,change:{kind:'project',value:{...opened.value.metadata.projects[0],title:'Metadata only name'}},response:'outline'});assert.equal(deniedTitle.value.code,'STORAGE_NAME_MISMATCH');assert.equal((await a(prefix+'/workspace/read/start',{})).value.etag,opened.value.etag);
 const command={id:randomUUID(),etag:opened.value.etag,project:{...opened.value.metadata.projects[0],title:'Renamed Field Project',description:'Retained project settings'}};
 for(const book of [f.books[1],f.books[0]]){
  const denied=await a(prefix+'/settings/save',command);assert.equal(denied.value.code,'DEVICE_UNKNOWN',JSON.stringify(denied));assert.equal(denied.value.projectId,book.projectId);assert.equal(denied.value.labBookId,book.labBookId);assert.equal(await workspaceRename(selected.root),null);
  const unlock=await a('/api/projects/'+book.projectId+'/lab-books/'+book.labBookId+'/access/unlock',{username:'',password:'Protected observations 456!',recovery:''});assert.equal(unlock.status,200,JSON.stringify(unlock));
 }
 const result=await a(prefix+'/settings/save',command);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.value.book.title,command.project.title);assert.equal(result.value.book.projects[0].description,command.project.description);assert.equal((await f.registry.locate(selected.projectId)).root,path.join(f.root,command.project.title));
 assert.equal((await a(prefix+'/settings/save',command)).status,200);
 for(const book of f.books){const route='/api/projects/'+book.projectId+'/lab-books/'+book.labBookId+'/workspace/read/start';assert.equal((await a(route,{})).status,200);assert.equal((await b(route,{})).value.code,'DEVICE_UNKNOWN');}
 const storage=new ProjectStorage(path.join(f.root,command.project.title),selected.projectId,selected.key),renames=new ProjectRenames(f.registry,selected.projectId);
 await assert.rejects(renames.run(storage,{id:randomUUID(),name:'Recovered Field Project',expectedName:command.project.title,withProject:async(id,use)=>use(new ProjectStorage((await f.registry.locate(id)).root,id,f.projects.find(p=>p.projectId===id).key)),withBook:async(parent,id,use)=>use(new LabBookStorage((await new LabBookRegistry(parent).locate(id)).root,id,f.books.find(book=>book.labBookId===id).key)),checkpoint:async stage=>{if(stage==='registered')throw Error('Interrupted registry reply');}}),/Interrupted registry reply/);
 await app.close();app=await startServer(options);const c=await client(app),recovered=await c('/api/projects/'+f.projects[1].projectId+'/workspace/read/start',{});assert.equal(recovered.status,200,JSON.stringify(recovered));assert.equal(await workspaceRename(path.join(f.root,'Recovered Field Project')),null);
 const final=await c(prefix+'/workspace/read/start',{});assert.equal(final.value.metadata.projects[0].title,'Recovered Field Project');
});


test('prepared project rename refreshes child ownership and credentials and preserves later settings',{timeout:240000},async t=>{
 const f=await fixture(t),selected=f.projects[0],storage=new ProjectStorage(selected.root,selected.projectId,selected.key),renames=new ProjectRenames(f.registry,selected.projectId);
 const callbacks={withProject:async(id,use)=>use(new ProjectStorage((await f.registry.locate(id)).root,id,f.projects.find(p=>p.projectId===id).key)),withBook:async(parent,id,use)=>use(new LabBookStorage((await new LabBookRegistry(parent).locate(id)).root,id,f.books.find(book=>book.labBookId===id).key))};
 const prepare=async name=>{const before=await storage.outline();await assert.rejects(renames.run(storage,{id:randomUUID(),name,expectedName:path.basename(storage.root),settings:{etag:before.etag,project:{...before.metadata.projects[0],title:name}},...callbacks,checkpoint:async stage=>{if(stage==='prepared')throw Error('Stopped before fencing');}}),/Stopped before fencing/);};
 await prepare('Superseded Project');await storage.update(book=>{book.projects[0].description='Newer saved work';return book;});const retained=(await storage.outline()).etag;
 const app=await startServer({root:f.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(f.directory,'preferences.json')});t.after(()=>app.close());const a=await client(app),prefix='/api/projects/'+selected.projectId;
 const ordinary=await a(prefix+'/workspace/read/start',{});assert.equal(ordinary.status,200,JSON.stringify(ordinary));assert.equal(ordinary.value.etag,retained);assert.equal((await renames.read()).phase,'cancelled');assert.equal((await f.registry.locate(selected.projectId)).root,selected.root);
 for(const book of f.books)assert.equal((await a('/api/projects/'+book.projectId+'/lab-books/'+book.labBookId+'/access/unlock',{username:'',password:'Protected observations 456!',recovery:''})).status,200);
 await prepare('Current Field Project');
 const {book:added}=await new LabBookCreation(storage,f.deviceStore).create({id:randomUUID(),username:'',password:'New independent book 678!',book:{id:randomUUID(),projectId:selected.projectId,title:'Additional observations'}});
 const settings=new ProjectAccessSettings(storage);await settings.password({etag:(await settings.details()).etag,username:'',password:'Updated project password 789!'},{deviceStore:f.deviceStore});
 const locked=await a(prefix+'/workspace/read/start',{});assert.equal(locked.value.code,'DEVICE_UNKNOWN',JSON.stringify(locked));assert.equal(locked.value.projectId,selected.projectId);
 assert.equal((await a(prefix+'/access/unlock',{username:'',password:'Updated project password 789!',recovery:''})).status,200);
 // Each request authenticates the currently owned books, including the book
 // added after the interrupted attempt. No old receipt grants that access.
 const requested=new Set();for(let attempt=0;attempt<4;attempt++){
  const response=await a(prefix+'/workspace/read/start',{});if(response.status===200){assert.equal(response.value.metadata.projects[0].title,'Current Field Project');break;}
  assert.equal(response.value.code,'DEVICE_UNKNOWN',JSON.stringify(response));assert.ok(response.value.labBookId);requested.add(response.value.labBookId);assert.equal(await workspaceRename(selected.root),null);
  const password=response.value.labBookId===added.labBookId?'New independent book 678!':'Protected observations 456!';assert.equal((await a('/api/projects/'+response.value.projectId+'/lab-books/'+response.value.labBookId+'/access/unlock',{username:'',password,recovery:''})).status,200);
 }
 assert.ok(requested.has(added.labBookId));assert.equal((await renames.read()).phase,'complete');const entry=await f.registry.locate(selected.projectId);assert.equal(path.basename(entry.root),'Current Field Project');
 const after=await a(prefix+'/lab-books/'+added.labBookId+'/workspace/read/start',{});assert.equal(after.status,200,JSON.stringify(after));assert.equal(after.value.metadata.notebooks[0].title,'Additional observations');
});


test('workspace rename completes an interrupted nested project rename before moving its parent',{timeout:180000},async t=>{
 const f=await fixture(t),selected=f.projects[1],child=new ProjectStorage(selected.root,selected.projectId,selected.key),name='Renamed nested project';
 const withBook=async(parent,id,use)=>{const entry=await new LabBookRegistry(parent).locate(id),saved=f.books.find(book=>book.labBookId===id);return use(new LabBookStorage(entry.root,id,saved.key));};
 await assert.rejects(new ProjectRenames(f.registry,selected.projectId).run(child,{id:randomUUID(),name,expectedName:path.basename(child.root),withBook,checkpoint:async stage=>{if(stage==='renamed')throw Error('Interrupted nested rename');}}),/Interrupted nested rename/);
 const result=await new WorkspaceRenames(path.join(f.directory,'workspace-renames')).begin(f.workspace,'Renamed Research Workspace',{
  withProject:async(id,use)=>{const saved=f.projects.find(project=>project.projectId===id);if(id===selected.projectId)await new ProjectRenames(f.registry,id).resume(saved.key);const entry=await f.registry.locate(id);return use(new ProjectStorage(entry.root,id,saved.key));},withBook
 });
 assert.equal(result.complete,true);await assert.rejects(readdir(f.root),{code:'ENOENT'});
 const workspace=new Workspace(result.destination,f.workspace.vault),registry=new ProjectRegistry(workspace,(await workspace.outline()).metadata.id),parent=await registry.locate(f.projects[0].projectId),nested=await registry.locate(selected.projectId);
 assert.equal(parent.root,path.join(result.destination,'Field Project 1'));assert.equal(nested.root,path.join(parent.root,name));assert.equal((await new ProjectRenames(registry,selected.projectId).read()).phase,'complete');
 for(const saved of f.projects){const entry=await registry.locate(saved.projectId),storage=new ProjectStorage(entry.root,entry.projectId,saved.key);assert.deepEqual(await catalogueBinding(entry.root),saved.binding);assert.equal((await stat(path.join(entry.root,'.observanda/postgresql/data/PG_VERSION'))).ino,saved.inode);assert.equal((await storage.outline()).metadata.title,path.basename(entry.root));
  for(const book of f.books.filter(book=>book.projectId===saved.projectId)){const item=await new LabBookRegistry(storage).locate(book.labBookId);assert.deepEqual(await new LabBookStorage(item.root,item.labBookId,book.key).read(),book.before);assert.equal((await stat(path.join(item.root,'.observanda/postgresql/data/PG_VERSION'))).ino,book.inode);assert.equal(await workspaceRename(item.root),null);}
 }
});


async function destinationProject(f,t,password=''){
 const id=randomUUID(),result=await f.creation.create({id:randomUUID(),username:'',password,project:{id,title:'Destination Project',description:'',parentId:null,share:false,logoId:null}}),key=await verifyAccess(await readAccess(result.project.root),'',password,{deviceStore:f.deviceStore});t.after(()=>clearVault(key));return {...result.project,key};
}
test('project placement moves existing nested owners and recovers interruption without copying',{timeout:300000},async t=>{
 const f=await fixture(t),target=await destinationProject(f,t),selected=f.projects[0],renames=new ProjectRenames(f.registry,selected.projectId);
 const callbacks={withProject:async(id,use)=>use(new ProjectStorage((await f.registry.locate(id)).root,id,f.projects.find(p=>p.projectId===id).key)),withBook:async(parent,id,use)=>use(new LabBookStorage((await new LabBookRegistry(parent).locate(id)).root,id,f.books.find(book=>book.labBookId===id).key))};
 await assert.rejects(f.registry.reparent(selected.projectId,target.projectId,{expected:(await f.registry.read()).revision}),{code:'STORAGE_PATH'});
 await assert.rejects(renames.run(new ProjectStorage(selected.root,selected.projectId,selected.key),{id:randomUUID(),name:path.basename(selected.root),expectedName:path.basename(selected.root),placement:{parentId:f.projects[1].projectId,expectedParentId:null},...callbacks}),{code:'STORAGE_PATH'});
 let parentId=null;
 for(const boundary of ['prepared','book-stopped','renamed','registered','complete']){
  const old=await f.registry.locate(selected.projectId),destinationParent=parentId===null?target.projectId:null,storage=new ProjectStorage(old.root,old.projectId,selected.key),head=(await storage.outline()).etag,operation=randomUUID();
  await assert.rejects(renames.run(storage,{id:operation,name:path.basename(old.root),expectedName:path.basename(old.root),placement:{parentId:destinationParent,expectedParentId:parentId},...callbacks,checkpoint:async stage=>{if(stage===boundary)throw Error('Interrupted placement '+boundary);}}),new RegExp('Interrupted placement '+boundary));
  if(boundary==='book-stopped'){
   // Independent parent edits remain available while only its placement is reserved.
   const container=new ProjectStorage(target.root,target.projectId,target.key);await container.update(value=>{value.projects[0].description='Independent parent edit';return value;});
   await assert.rejects(new ProjectRenames(f.registry,target.projectId).run(container,{id:randomUUID(),name:'Cannot move reserved parent',expectedName:path.basename(target.root),...callbacks}),error=>['STORAGE_PROJECT_BUSY','STORAGE_RENAMING'].includes(error.code));
  }
  const result=await new ProjectRenames(f.registry,selected.projectId).resume(selected.key,{...callbacks});assert.equal(result.complete,true);assert.equal(result.project.parentId,destinationParent);
  const expected=path.join(destinationParent?target.root:f.root,path.basename(selected.root));assert.equal(result.project.root,expected);await assert.rejects(readdir(old.root),{code:'ENOENT'});assert.equal((await new ProjectStorage(expected,selected.projectId,selected.key).outline()).etag,head);
  for(const saved of f.projects){const entry=await f.registry.locate(saved.projectId),project=new ProjectStorage(entry.root,entry.projectId,saved.key);assert.equal(entry.root,saved.projectId===selected.projectId?expected:path.join(expected,path.basename(saved.root)));assert.deepEqual(await catalogueBinding(entry.root),saved.binding);assert.equal((await stat(path.join(entry.root,'.observanda/postgresql/data/PG_VERSION'))).ino,saved.inode);
   for(const book of f.books.filter(book=>book.projectId===saved.projectId)){const item=await new LabBookRegistry(project).locate(book.labBookId);assert.deepEqual(await new LabBookStorage(item.root,item.labBookId,book.key).read(),book.before);assert.equal((await stat(path.join(item.root,'.observanda/postgresql/data/PG_VERSION'))).ino,book.inode);assert.equal(await workspaceRename(item.root),null);}
  }
  parentId=destinationParent;
 }
});

test('HTTP project placement requires destination and nested-book access and survives restart',{timeout:180000},async t=>{
 const f=await fixture(t),target=await destinationProject(f,t,'Destination project password 456!'),selected=f.projects[0],options={root:f.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(f.directory,'preferences.json')};let app=await startServer(options);t.after(()=>app.close());let a=await client(app);const prefix='/api/projects/'+selected.projectId,command={id:randomUUID(),parentId:target.projectId,expectedParentId:null};
 assert.equal((await a(prefix+'/storage/move',{id:randomUUID(),path:path.join(f.directory,'External project')})).value.code,'INVALID');
 const denied=await a(prefix+'/storage/move',command);assert.equal(denied.value.code,'DEVICE_UNKNOWN',JSON.stringify(denied));assert.equal(denied.value.projectId,target.projectId);assert.equal((await f.registry.locate(selected.projectId)).parentId,null);
 assert.equal((await a('/api/projects/'+target.projectId+'/access/unlock',{username:'',password:'Destination project password 456!',recovery:''})).status,200);
 for(const book of [f.books[1],f.books[0]]){const locked=await a(prefix+'/directory/reparent',command);assert.equal(locked.value.code,'DEVICE_UNKNOWN',JSON.stringify(locked));assert.equal(locked.value.labBookId,book.labBookId);assert.equal(locked.value.projectId,book.projectId);assert.equal((await a('/api/projects/'+book.projectId+'/lab-books/'+book.labBookId+'/access/unlock',{username:'',password:'Protected observations 456!',recovery:''})).status,200);}
 const moved=await a(prefix+'/storage/move',command);assert.equal(moved.status,200,JSON.stringify(moved));assert.equal(moved.value.project.root,path.join(target.root,path.basename(selected.root)));assert.equal((await a(prefix+'/directory/reparent',command)).status,200);
 for(const book of f.books)assert.equal((await a('/api/projects/'+book.projectId+'/lab-books/'+book.labBookId+'/workspace/read/start',{})).status,200);
 await app.close();app=await startServer(options);a=await client(app);const reopened=await a(prefix+'/workspace/read/start',{});assert.equal(reopened.status,200,JSON.stringify(reopened));assert.equal(reopened.value.metadata.title,path.basename(selected.root));const directory=await f.registry.read();assert.equal(directory.value.projects.find(item=>item.projectId===selected.projectId).parentId,target.projectId);
 const placed=await f.registry.locate(selected.projectId),renames=new ProjectRenames(f.registry,selected.projectId),callbacks={withProject:async(id,use)=>use(new ProjectStorage((await f.registry.locate(id)).root,id,f.projects.find(p=>p.projectId===id).key)),withBook:async(parent,id,use)=>use(new LabBookStorage((await new LabBookRegistry(parent).locate(id)).root,id,f.books.find(book=>book.labBookId===id).key))};
 await assert.rejects(renames.run(new ProjectStorage(placed.root,selected.projectId,selected.key),{id:randomUUID(),name:path.basename(placed.root),expectedName:path.basename(placed.root),placement:{parentId:null,expectedParentId:target.projectId},...callbacks,checkpoint:async stage=>{if(stage==='prepared')throw Error('Restart with pending placement');}}),/Restart with pending placement/);
 await app.close();app=await startServer(options);a=await client(app);
 for(const book of [f.books[1],f.books[0]]){const locked=await a(prefix+'/workspace/read/start',{});assert.equal(locked.value.code,'DEVICE_UNKNOWN',JSON.stringify(locked));assert.equal(locked.value.labBookId,book.labBookId);assert.equal(locked.value.projectId,book.projectId);assert.equal((await a('/api/projects/'+book.projectId+'/lab-books/'+book.labBookId+'/access/unlock',{username:'',password:'Protected observations 456!',recovery:''})).status,200);}
 assert.equal((await a(prefix+'/workspace/read/start',{})).status,200);assert.equal((await f.registry.locate(selected.projectId)).root,selected.root);assert.equal((await f.registry.locate(selected.projectId)).parentId,null);
});


test('workspace rename resolves a prepared project placement and retains its new ancestry',{timeout:180000},async t=>{
 const f=await fixture(t),target=await destinationProject(f,t),selected=f.projects[0],keys=new Map([...f.projects,target].map(entry=>[entry.projectId,entry.key])),renames=new ProjectRenames(f.registry,selected.projectId);
 const callbacks={withProject:async(id,use)=>use(new ProjectStorage((await f.registry.locate(id)).root,id,keys.get(id))),withBook:async(parent,id,use)=>use(new LabBookStorage((await new LabBookRegistry(parent).locate(id)).root,id,f.books.find(book=>book.labBookId===id).key))};
 await assert.rejects(renames.run(new ProjectStorage(selected.root,selected.projectId,selected.key),{id:randomUUID(),name:path.basename(selected.root),expectedName:path.basename(selected.root),placement:{parentId:target.projectId,expectedParentId:null},...callbacks,checkpoint:async stage=>{if(stage==='prepared')throw Error('Interrupted placement admission');}}),/Interrupted placement admission/);
 const moved=await new WorkspaceRenames(path.join(f.directory,'workspace-renames')).begin(f.workspace,'Renamed Research Workspace',{...callbacks,withProject:async(id,use)=>{if(id===selected.projectId)await renames.resume(selected.key,callbacks);return callbacks.withProject(id,use);}});
 const workspace=new Workspace(moved.destination,f.workspace.vault),registry=new ProjectRegistry(workspace,(await workspace.outline()).metadata.id),entry=await registry.locate(selected.projectId);assert.equal(entry.parentId,target.projectId);assert.equal(entry.root,path.join(moved.destination,'Destination Project',path.basename(selected.root)));
 for(const book of f.books){const owner=await registry.locate(book.projectId),project=new ProjectStorage(owner.root,owner.projectId,keys.get(owner.projectId)),item=await new LabBookRegistry(project).locate(book.labBookId);assert.deepEqual(await new LabBookStorage(item.root,item.labBookId,book.key).read(),book.before);assert.equal((await stat(path.join(item.root,'.observanda/postgresql/data/PG_VERSION'))).ino,book.inode);}
});


test('unsupported volume placement restores the entire project tree through interrupted cancellation',{timeout:240000},async t=>{
 const f=await fixture(t),target=await destinationProject(f,t),selected=f.projects[0],renames=new ProjectRenames(f.registry,selected.projectId),source=new ProjectStorage(selected.root,selected.projectId,selected.key);
 const callbacks={withProject:async(id,use)=>use(new ProjectStorage((await f.registry.locate(id)).root,id,f.projects.find(p=>p.projectId===id).key)),withBook:async(parent,id,use)=>use(new LabBookStorage((await new LabBookRegistry(parent).locate(id)).root,id,f.books.find(book=>book.labBookId===id).key))};
 for(const boundary of ['cancelling','cancel-projects-cleared','cancel-books-cleared','cancel-unfrozen','cancelled']){
  const command={id:randomUUID(),name:path.basename(source.root),expectedName:path.basename(source.root),placement:{parentId:target.projectId,expectedParentId:null},...callbacks},original=fs.rename;
  fs.rename=async(from,to)=>{if(from===source.root)throw Object.assign(Error('Another filesystem'),{code:'EXDEV'});return original(from,to);};syncBuiltinESMExports();
  try{await assert.rejects(renames.run(source,{...command,checkpoint:async stage=>{if(stage===boundary)throw Error('Interrupted '+boundary);}}),new RegExp('Interrupted '+boundary));}finally{fs.rename=original;syncBuiltinESMExports();}
  await assert.rejects(renames.run(source,command),{code:'STORAGE_RENAME_VOLUME'});assert.equal((await renames.read()).phase,'cancelled');
  await assert.rejects(stat(path.join(target.root,path.basename(source.root))),{code:'ENOENT'});
  for(const saved of f.projects){
   const entry=await f.registry.locate(saved.projectId);assert.equal(entry.root,saved.root);assert.equal(entry.parentId,saved.parentId);assert.equal(await workspaceRename(entry.root),null);
   assert.equal((await stat(path.join(entry.root,'.observanda/postgresql/data/PG_VERSION'))).ino,saved.inode);
   for(const name of ['rename-project-keys.observanda','rename-book-keys.observanda'])await assert.rejects(stat(path.join(entry.root,'.observanda',name)),{code:'ENOENT'});
   const project=new ProjectStorage(entry.root,entry.projectId,saved.key);assert.equal((await project.outline()).metadata.title,path.basename(entry.root));
   for(const book of f.books.filter(book=>book.projectId===saved.projectId)){const item=await new LabBookRegistry(project).locate(book.labBookId);assert.equal(await workspaceRename(item.root),null);assert.deepEqual(await new LabBookStorage(item.root,item.labBookId,book.key).read(),book.before);}
  }
 }
 const moved=await renames.run(source,{id:randomUUID(),name:path.basename(source.root),expectedName:path.basename(source.root),placement:{parentId:target.projectId,expectedParentId:null},...callbacks});assert.equal(moved.project.parentId,target.projectId);assert.equal(moved.complete,true);
});

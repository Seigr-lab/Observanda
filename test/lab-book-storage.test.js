import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {ProjectStorage} from '../src/project-storage.js';
import {Workspace} from '../src/storage.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {readAccess,verifyAccess} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {sampleNotebook} from '../src/sample.js';
import {catalogueBinding,CATALOGUE_FILE} from '../src/postgres-activation.js';
import {openCatalogue} from '../src/postgres.js';
import {MediaImports} from '../src/media-imports.js';
import {contentBuffer} from '../src/file-content.js';
import {withScratch} from '../src/scratch-work.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectCreation} from '../src/project-creation.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {LabBookReparents} from '../src/lab-book-reparent.js';
import {LabBookCopies} from '../src/lab-book-copy.js';
import {ResearchRecords} from '../src/research.js';
import {MediaStore} from '../src/media.js';
import {ownerWorkspace,assertArchiveCopy,importLabBookCopy} from './owner-workspace-fixture.js';

const password='Independent book password';
// Lab books are created as the product creates them: inside a project of an
// open workspace, whose single database cluster serves every owner below it.
async function fixture(t){
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-book-storage-')),vaults=[];
 const owner=new WorkspaceDatabases({directory:path.join(parent,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner);
 t.after(async()=>{await owner.close();detach();for(const vault of vaults)await clearVault(vault);assert.equal(path.dirname(path.resolve(parent)),path.resolve(os.tmpdir()));assert.ok(path.basename(parent).startsWith('observanda-book-storage-'));await rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const home=await ownerWorkspace(parent,{name:'Research Workspace 1'});vaults.push(home.vault);
 const registry=new ProjectRegistry(home.workspace,(await home.workspace.outline()).metadata.id),addresses=new LabBookDirectory(registry),projects=new ProjectCreation(registry,home.deviceStore);
 async function project(title){
  const entry=(await projects.create({id:randomUUID(),project:{id:randomUUID(),title,description:'',parentId:null,share:false,logoId:null},username:'',password:''})).project,vault=await verifyAccess(await readAccess(entry.root),'','',{deviceStore:home.deviceStore});vaults.push(vault);
  return new ProjectStorage(entry.root,entry.projectId,vault);
 }
 const field=await project('Field Project 1');
 async function create(name){
  const entry=(await new LabBookCreation(field,home.deviceStore,{publish:book=>addresses.register(field.projectId,book)}).create({id:randomUUID(),username:'',password,book:{id:randomUUID(),projectId:field.projectId,title:name}})).book;
  const vault=await verifyAccess(await readAccess(entry.root),'',password,{deviceStore:home.deviceStore});vaults.push(vault);
  const storage=new LabBookStorage(entry.root,entry.labBookId,vault),record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:entry.labBookId};
  await new ResearchRecords(storage,new MediaStore(storage)).save({workspaceId:entry.namespaceId,changes:[{id:record.id,expectedRevision:null,record}]});
  return {storage,id:entry.labBookId,vault,entry,projectId:field.projectId};
 }
 return {parent,owner,home,registry,field,project,create,vaults};
}

test('book records, revisions and evidence remain owned after a move to a different project',async t=>{
 const f=await fixture(t),a=await f.create('Soil observations'),b=await f.create('Water observations'),before=await a.storage.read();
 assert.equal((await catalogueBinding(a.storage.root)).placement,'lab-book');assert.equal((await catalogueBinding(b.storage.root)).labBookId,b.id);
 let entered,release;const started=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve);
 const writing=a.storage.withLock(async()=>{entered();await hold;});await started;
 try{await b.storage.update(book=>{book.entries[0].title='Saved while the other book is busy';return book;});}finally{release();await writing;}
 await a.storage.update(book=>{book.entries[0].title='A revised observation';return book;});
 const saved=await a.storage.read();assert.equal(saved.book.entries[0].title,'A revised observation');assert.deepEqual(await a.storage.readRevision(before.etag),before.book);
 const original=Buffer.from('Exact retained measurement bytes'),imports=new MediaImports(a.storage),intake=await imports.start({name:'measurements.txt',size:original.length,kind:'file'});await imports.receive(intake.id,[original]);
 await a.storage.catalogue(()=>withScratch(async scratch=>{assert.equal(await scratch.add('selected',{value:37}),true);}));
 // A book changes project through the product's move command, never by moving its folder by hand.
 const other=await f.project('Other Project'),moved=await new LabBookReparents(f.registry,a.id).run(f.field,other,a.vault,{id:randomUUID()});
 assert.equal(moved.complete,true);assert.equal(moved.book.root,path.join(other.root,a.entry.directory));
 const reopened=new LabBookStorage(moved.book.root,a.id,a.vault),current=await reopened.read();
 // A move withdraws every publication grant; the records are otherwise unchanged.
 const content=entries=>entries.map(({share,updatedAt,...rest})=>rest);
 assert.deepEqual(content(current.book.entries),content(saved.book.entries));assert.ok(current.book.entries.every(entry=>entry.share===false));assert.equal(current.book.projects[0].id,other.projectId);assert.equal(current.book.notebooks[0].projectId,other.projectId);
 assert.deepEqual(await reopened.readRevision(saved.etag),saved.book);assert.deepEqual(await reopened.readRevision(before.etag),before.book);
 const retained=await new MediaImports(reopened).original(intake.id);assert.deepEqual(await contentBuffer(retained.content),original);
 assert.equal((await b.storage.read()).book.entries[0].title,'Saved while the other book is busy');
});

test('book routes reject workspace, project and sibling owners including cached transactions',async t=>{
 const f=await fixture(t),a=await f.create('Selected Book'),b=await f.create('Sibling Book'),before=await a.storage.read(),file=path.join(a.storage.root,CATALOGUE_FILE),binding=await readFile(file);
 for(const wrong of [new Workspace(a.storage.root,a.vault),new ProjectStorage(a.storage.root,a.projectId,a.vault),new LabBookStorage(a.storage.root,b.id,a.vault)])await assert.rejects(wrong.read(),{code:'DATABASE_LOCATION'});
 const env=await f.owner.environment(b.storage.root,{labBookId:b.id,vault:b.vault});await assert.rejects(openCatalogue(a.storage.root,{labBookId:a.id,vault:a.vault,env}),{code:'DATABASE_LOCATION'});
 await assert.rejects(openCatalogue(a.storage.root,{labBookId:a.id,projectId:a.projectId,vault:a.vault}),{code:'INVALID'});
 await a.storage.withLock(async()=>{await assert.rejects(new Workspace(a.storage.root,a.vault).catalogue(store=>store.head()),{code:'DATABASE_LOCATION'});await assert.rejects(new LabBookStorage(a.storage.root,b.id,a.vault).readMetadata('.observanda/test.json',4096),{code:'DATABASE_LOCATION'});});
 await a.storage.catalogue(async()=>{await assert.rejects(new Workspace(a.storage.root,a.vault).catalogue(store=>store.head()),{code:'DATABASE_LOCATION'});await assert.rejects(new LabBookStorage(a.storage.root,a.id,{id:a.vault.id,key:Buffer.alloc(32,1)}).catalogue(store=>store.head()),{code:'ACCESS_DENIED'});});
 await assert.rejects(a.storage.update(book=>{book.notebooks.push({...book.notebooks[0],id:randomUUID()});return book;}),{code:'INVALID'});
 await assert.rejects(a.storage.update(book=>{book.title=book.notebooks[0].title='Different name';return book;}),{code:'STORAGE_NAME_MISMATCH'});
 assert.deepEqual(await readFile(file),binding);assert.deepEqual(await a.storage.read(),before);
});

test('a selected book copy restores independently without changing its source',async t=>{
 const f=await fixture(t),a=await f.create('Copied Book'),before=await a.storage.read(),copies=path.join(f.parent,'Copies');await mkdir(copies);
 // "Copy to..." writes the selected book outside every workspace in archive form.
 const done=await new LabBookCopies(f.field,a.id).run(a.storage,{id:randomUUID(),parent:copies}),archive=path.join(copies,a.entry.directory);
 assert.equal(done.phase,'complete');await assertArchiveCopy(archive);assert.deepEqual(await a.storage.read(),before);
 // The product's import restores it into a project of another workspace.
 const copy=await importLabBookCopy(f.parent,{deviceStore:f.home.deviceStore,source:archive,password,labBookId:a.id,vault:a.vault,vaults:f.vaults,name:'Another Workspace'}),restored=await copy.read();
 assert.deepEqual(restored.book.entries,before.book.entries);assert.equal(restored.book.projects[0].title,'Receiving project');assert.notEqual(restored.book.projects[0].id,a.projectId);
 assert.equal((await catalogueBinding(copy.root)).placement,'lab-book');assert.notEqual((await catalogueBinding(copy.root)).id,(await catalogueBinding(a.storage.root)).id);
 await copy.update(book=>{book.entries[0].title='Edited in the copied book';return book;});assert.deepEqual(await a.storage.read(),before);
 assert.equal((await copy.read()).book.entries[0].title,'Edited in the copied book');
 await assert.rejects(readFile(path.join(copy.root,'.observanda/project-registry.observanda')),{code:'ENOENT'});
});

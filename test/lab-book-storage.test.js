import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {ProjectStorage} from '../src/project-storage.js';
import {Workspace,workspaceFile} from '../src/storage.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {TestDeviceStore} from './device-fixture.js';
import {clearVault} from '../src/encryption.js';
import {sampleNotebook} from '../src/sample.js';
import {catalogueBinding,CATALOGUE_FILE} from '../src/postgres-activation.js';
import {openCatalogue,backupCatalogue} from '../src/postgres.js';
import {MediaImports} from '../src/media-imports.js';
import {contentBuffer} from '../src/file-content.js';
import {withScratch} from '../src/scratch-work.js';

async function fixture(t){
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-book-storage-')),vaults=[];
 const owner=new WorkspaceDatabases({directory:path.join(parent,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner);
 t.after(async()=>{await owner.close();detach();for(const vault of vaults)clearVault(vault);assert.equal(path.dirname(path.resolve(parent)),path.resolve(os.tmpdir()));assert.ok(path.basename(parent).startsWith('observanda-book-storage-'));await rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 async function create(name){
  const book=sampleNotebook();book.title=name;book.projects[0].title='Field Project 1';book.notebooks[0].title=name;
  const id=book.notebooks[0].id,device=new TestDeviceStore({file:path.join(parent,randomUUID()+'.device')}),access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);vaults.push(vault);
  const root=path.join(parent,'Research Workspace 1','Field Project 1',name);await mkdir(path.join(root,'.observanda'),{recursive:true});await writeFile(path.join(root,'.observanda/access.json'),JSON.stringify(access));
  const storage=new LabBookStorage(root,id,vault);await storage.initializeResearch(book);return {storage,id,vault,book};
 }
 return {parent,owner,create};
}

test('book records, revisions and evidence remain owned after reopen in a different project',async t=>{
 const f=await fixture(t),a=await f.create('Soil observations'),b=await f.create('Water observations'),before=await a.storage.read();
 assert.equal((await catalogueBinding(a.storage.root)).placement,'lab-book');assert.equal((await catalogueBinding(b.storage.root)).labBookId,b.id);
 let entered,release;const started=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve);
 const writing=a.storage.withLock(async()=>{entered();await hold;});await started;
 try{await b.storage.update(book=>{book.entries[0].title='Saved while the other book is busy';return book;});}finally{release();await writing;}
 await a.storage.update(book=>{book.entries[0].title='A revised observation';return book;});
 const saved=await a.storage.read();assert.equal(saved.book.entries[0].title,'A revised observation');assert.deepEqual(await a.storage.readRevision(before.etag),before.book);
 const original=Buffer.from('Exact retained measurement bytes'),imports=new MediaImports(a.storage),intake=await imports.start({name:'measurements.txt',size:original.length,kind:'file'});await imports.receive(intake.id,[original]);
 await a.storage.catalogue(()=>withScratch(async scratch=>{assert.equal(await scratch.add('selected',{value:37}),true);}));
 await f.owner.closeLabBook(a.storage.root);const nextProject=path.join(f.parent,'Other Workspace','Other Project');await mkdir(nextProject,{recursive:true});const moved=path.join(nextProject,path.basename(a.storage.root));await rename(a.storage.root,moved);
 const reopened=new LabBookStorage(moved,a.id,a.vault);assert.deepEqual(await reopened.read(),saved);assert.deepEqual(await reopened.readRevision(before.etag),before.book);
 const retained=await new MediaImports(reopened).original(intake.id);assert.deepEqual(await contentBuffer(retained.content),original);
 assert.equal((await b.storage.read()).book.entries[0].title,'Saved while the other book is busy');
});

test('book routes reject workspace, project and sibling owners including cached transactions',async t=>{
 const f=await fixture(t),a=await f.create('Selected Book'),b=await f.create('Sibling Book'),before=await a.storage.read(),file=path.join(a.storage.root,CATALOGUE_FILE),binding=await readFile(file);
 for(const wrong of [new Workspace(a.storage.root,a.vault),new ProjectStorage(a.storage.root,a.book.projects[0].id,a.vault),new LabBookStorage(a.storage.root,b.id,a.vault)])await assert.rejects(wrong.read(),{code:'DATABASE_LOCATION'});
 const env=await f.owner.environment(b.storage.root,{labBookId:b.id,vault:b.vault});await assert.rejects(openCatalogue(a.storage.root,{labBookId:a.id,vault:a.vault,env}),{code:'DATABASE_LOCATION'});
 await assert.rejects(openCatalogue(a.storage.root,{labBookId:a.id,projectId:a.book.projects[0].id,vault:a.vault}),{code:'INVALID'});
 await a.storage.withLock(async()=>{await assert.rejects(new Workspace(a.storage.root,a.vault).catalogue(store=>store.head()),{code:'DATABASE_LOCATION'});await assert.rejects(new LabBookStorage(a.storage.root,b.id,a.vault).readMetadata('.observanda/test.json',4096),{code:'DATABASE_LOCATION'});});
 await a.storage.catalogue(async()=>{await assert.rejects(new Workspace(a.storage.root,a.vault).catalogue(store=>store.head()),{code:'DATABASE_LOCATION'});await assert.rejects(new LabBookStorage(a.storage.root,a.id,{id:a.vault.id,key:Buffer.alloc(32,1)}).catalogue(store=>store.head()),{code:'ACCESS_DENIED'});});
 await assert.rejects(a.storage.update(book=>{book.notebooks.push({...book.notebooks[0],id:randomUUID()});return book;}),{code:'INVALID'});
 await assert.rejects(a.storage.update(book=>{book.title=book.notebooks[0].title='Different name';return book;}),{code:'STORAGE_NAME_MISMATCH'});
 assert.deepEqual(await readFile(file),binding);assert.deepEqual(await a.storage.read(),before);
});

test('a selected book archive restores independently without changing its source',async t=>{
 const f=await fixture(t),a=await f.create('Copied Book'),before=await a.storage.read(),destination=path.join(f.parent,'Another Workspace','Another Project','Copied Book');await mkdir(path.join(destination,'.observanda'),{recursive:true});
 for(const relative of [path.basename(await workspaceFile(a.storage.root)),'.observanda/access.json'])await copyFile(path.join(a.storage.root,relative),path.join(destination,relative));
 const db=await a.storage.openCatalogue();try{await backupCatalogue(a.storage.root,destination,{connection:db});}finally{await db.close();}
 await f.owner.closeLabBook(a.storage.root);const copy=new LabBookStorage(destination,a.id,a.vault);assert.deepEqual(await copy.read(),before);
 assert.equal((await catalogueBinding(destination)).placement,'lab-book');assert.notEqual((await catalogueBinding(destination)).id,(await catalogueBinding(a.storage.root)).id);
 await copy.update(book=>{book.projects[0].title='Another Project';book.entries[0].title='Edited in the copied book';return book;});assert.deepEqual(await a.storage.read(),before);
 assert.equal((await copy.read()).book.projects[0].title,'Another Project');
 await assert.rejects(readFile(path.join(destination,'.observanda/project-registry.observanda')),{code:'ENOENT'});
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectApplication,projectRequest} from '../src/project-application.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';

test('source chooser lists protected books through their owner registry without opening their databases',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-publication-directory-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),keys=[];let application;const catalogue=LabBookStorage.prototype.catalogue;
 try{
  const host=sampleNotebook(),f=await encryptedFixture(directory,host);keys.push(f.vault);const registry=new ProjectRegistry(f.workspace,host.id),project=sampleNotebook();project.title=project.projects[0].title='Research project';project.entries=[];
  const access=await createWorkspaceAccess('','Project password',f.deviceStore),key=takeCreatedVault(access);keys.push(key);
  const storage=await initializeProjectLocation(path.join(f.workspace.root,project.title),project.projects[0].id,project,access,key);await registry.attach(storage,{expected:(await registry.read()).revision});
  const created=await new LabBookCreation(storage,f.deviceStore,{publish:book=>new LabBookDirectory(registry).register(storage.projectId,book)}).create({id:randomUUID(),username:'',password:'Separate book password',book:{id:randomUUID(),projectId:storage.projectId,title:'Measurements 1',configuration:{profiles:[],sections:[]}}});
  application=new ProjectApplication(f.workspace,{deviceStore:f.deviceStore});const client={},route=projectRequest('/api/projects/publication-source-directory','POST'),command={workspaceId:host.id,projectId:storage.projectId,search:'',offset:0,limit:25,revision:null};
  LabBookStorage.prototype.catalogue=()=>{throw Error('Source discovery opened a book database');};
  const roots=await application.run(client,route,{...command,projectId:null});assert.equal(roots.items.find(row=>row.projectId===storage.projectId).workspaceId,project.id);
  await assert.rejects(application.run(client,route,command),error=>['ACCESS_LOCKED','DEVICE_UNKNOWN'].includes(error.code)&&error.projectId===storage.projectId);
  await application.unlock(client,storage.projectId,{password:'Project password'});const books=await application.run(client,route,command);assert.equal(books.total,2);const book=books.items.find(row=>row.kind==='book');assert.equal(book.label,'Measurements 1');assert.equal(book.workspaceId,created.book.namespaceId);assert.deepEqual(book.ancestors,['Research project']);assert.ok(!('root' in book));
  const scoped=projectRequest('/api/projects/'+storage.projectId+'/lab-books/'+created.book.labBookId+'/publication-source-directory','POST');const fromBook=await application.run(client,scoped,{...command,workspaceId:created.book.namespaceId});assert.equal(fromBook.total,1);assert.equal(fromBook.items[0].kind,'content');
  await application.lock(client,storage.projectId);await assert.rejects(application.run(client,route,command),error=>error.code==='ACCESS_LOCKED'&&error.projectId===storage.projectId);
 }finally{LabBookStorage.prototype.catalogue=catalogue;await application?.close();await runtime.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-publication-directory-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

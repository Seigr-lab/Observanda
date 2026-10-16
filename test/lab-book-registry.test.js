import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {ProjectStorage,initializeProjectLocation} from '../src/project-storage.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {TestDeviceStore} from './device-fixture.js';
import {clearVault} from '../src/encryption.js';
import {sampleNotebook} from '../src/sample.js';

test('book registration is independent of project writes and remains relative after parent relocation',async t=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-book-directory-')),vaults=[],owner=new WorkspaceDatabases({directory:path.join(parent,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner);
 t.after(async()=>{await owner.close();detach();for(const vault of vaults)clearVault(vault);assert.equal(path.dirname(path.resolve(parent)),path.resolve(os.tmpdir()));assert.ok(path.basename(parent).startsWith('observanda-book-directory-'));await rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 async function accessFor(){const access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(parent,randomUUID()+'.device')})),vault=takeCreatedVault(access);vaults.push(vault);return {access,vault};}
 const projectBook=sampleNotebook();projectBook.title='Field Project 1';projectBook.projects[0].title='Field Project 1';projectBook.notebooks=[];projectBook.entries=[];
 const projectRoot=path.join(parent,'Research Workspace 1','Field Project 1');await mkdir(path.dirname(projectRoot),{recursive:true});const credentials=await accessFor(),project=await initializeProjectLocation(projectRoot,projectBook.projects[0].id,projectBook,credentials.access,credentials.vault),registry=new LabBookRegistry(project);
 async function makeBook(title,root=path.join(projectRoot,title)){
  const book=sampleNotebook();book.title=title;book.projects=[{...projectBook.projects[0]}];book.notebooks[0].projectId=project.projectId;book.notebooks[0].title=title;
  const {access,vault}=await accessFor();await mkdir(path.join(root,'.observanda'),{recursive:true});await writeFile(path.join(root,'.observanda/access.json'),JSON.stringify(access));const storage=new LabBookStorage(root,book.notebooks[0].id,vault);await storage.initializeResearch(book);return storage;
 }
 const first=await makeBook('Field Book 1'),second=await makeBook('Field Book 2'),initial=await registry.read();
 let enter,release;const entered=new Promise(resolve=>enter=resolve),hold=new Promise(resolve=>release=resolve),busy=project.withLock(async()=>{enter();await hold;});await entered;
 try{
  await registry.attach(first,{expected:initial.revision});assert.equal((await registry.locate(first.labBookId)).directory,'Field Book 1');
  await assert.rejects(registry.attach(second,{expected:initial.revision}),{code:'CONFLICT'});
  await registry.attach(second,{expected:(await registry.read()).revision});
 }finally{release();await busy;}
 const saved=await registry.read(),bytes=await readFile(registry.file);assert.equal(bytes.includes(Buffer.from('Field Book')),false);
 const plaintext=await project.readFile(registry.file,'utf8');assert.equal(plaintext.includes(project.root),false);assert.equal(plaintext.includes('Research Workspace 1'),false);
 const page=await registry.list({limit:1});assert.equal(page.items.length,1);assert.ok(page.next);const last=await registry.list({after:page.next,limit:1,revision:page.revision});assert.equal(last.items.length,1);assert.equal(last.next,null);assert.notEqual(last.items[0].labBookId,page.items[0].labBookId);
 await assert.rejects(registry.change(saved.revision,value=>{value.books[0].directory='../escape';return value;}),{code:'FORMAT'});
 await assert.rejects(registry.change(saved.revision,value=>{value.books[1].directory=value.books[0].directory;return value;}),{code:'FORMAT'});
 const wrong=await makeBook('Outside Book',path.join(parent,'Outside Book'));await assert.rejects(registry.attach(wrong,{expected:saved.revision}),{code:'DATABASE_LOCATION'});
 assert.deepEqual(await registry.read(),saved);
 for(const storage of [first,second])await owner.closeLabBook(storage.root);await owner.closeProject(project.root);
 const newWorkspace=path.join(parent,'Moved Workspace');await mkdir(newWorkspace);const moved=path.join(newWorkspace,'Field Project 1');await rename(project.root,moved);
 const reopened=new LabBookRegistry(new ProjectStorage(moved,project.projectId,project.vault)),located=await reopened.locate(first.labBookId);assert.equal(located.root,path.join(moved,'Field Book 1'));assert.deepEqual(await reopened.read(),saved);
 const book=new LabBookStorage(located.root,located.labBookId,first.vault);assert.equal((await book.outline()).metadata.notebooks[0].title,'Field Book 1');assert.equal((await reopened.namespace(located.namespaceId)).labBookId,located.labBookId);
});

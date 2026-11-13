import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,stat,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {TestDeviceStore} from './device-fixture.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {createNotebook} from '../src/model.js';
import {sampleNotebook} from '../src/sample.js';
import {Workspace} from '../src/storage.js';
import {initializeLocation} from '../src/locations.js';
import {ProjectStorage,initializeProjectLocation} from '../src/project-storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectMoves} from '../src/project-move.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {ResearchRecords} from '../src/research.js';
import {MediaStore} from '../src/media.js';
import {RecordWriting} from '../src/record-writing.js';
import {catalogueBinding} from '../src/postgres-activation.js';
import {MOVE_BOOK_KEYS_FILE} from '../src/owned-operation-keys.js';
import {moveSource} from '../src/workspace-move-state.js';

test('a project with nested books is never moved out of its workspace and its books stay writable',{timeout:180000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-book-move-')),options={directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}},vaults=[];const provider=new WorkspaceDatabases(options),detach=installDatabaseProvider(provider);
 t.after(async()=>{await provider.close();detach();await Promise.all(vaults.map(clearVault));assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-book-move-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const device=new TestDeviceStore({file:path.join(directory,'device.key')}),access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);vaults.push(vault);
 const root=path.join(directory,'Workspace 1'),workspaceMetadata=createNotebook('Workspace 1');await initializeLocation(root,workspaceMetadata,access,vault);const workspace=new Workspace(root,vault),registry=new ProjectRegistry(workspace,workspaceMetadata.id);await workspace.outline();
 const metadata=createNotebook('Field Project Å 1'),projectId=randomUUID();metadata.projects=[{id:projectId,title:metadata.title,parentId:null,description:'',share:false,logoId:null}];
 const project=await initializeProjectLocation(path.join(root,metadata.title),projectId,metadata,access,vault);await registry.attach(project,{expected:'new'});
 const books=[];
 for(const title of ['Observations Å 1','Measurements 2']){
  const created=await new LabBookCreation(project,device).create({id:randomUUID(),username:'',password:'Book move password',book:{id:randomUUID(),projectId,title}}),key=await verifyAccess(await readAccess(created.book.root),'','Book move password',{deviceStore:device});vaults.push(key);
  const storage=new LabBookStorage(created.book.root,created.book.labBookId,key),outline=await storage.outline(),record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:storage.labBookId};
  await new ResearchRecords(storage,new MediaStore(storage)).save({workspaceId:outline.metadata.id,changes:[{id:record.id,expectedRevision:null,record}]});await storage.writeFile(path.join(storage.root,'.observanda/evidence.bin'),'Original evidence '+title);
  books.push({storage,key,directory:title,target:{workspaceId:outline.metadata.id,recordId:record.id,sectionId:null},before:await storage.read()});
 }
 const moves=new ProjectMoves(registry),withBook=(id,use)=>use(books.find(book=>book.storage.labBookId===id).storage),revision=(await registry.read()).revision;
 // The refusal comes before any book is frozen, authorized or copied.
 for(const name of ['Outside','Unauthenticated']){
  const parent=path.join(directory,name);await mkdir(parent);const destination=path.join(parent,metadata.title);
  await assert.rejects(moves.run(projectId,vault,{id:randomUUID(),path:destination,...(name==='Outside'?{withBook}:{})}),error=>error.code==='STORAGE_OUTSIDE_WORKSPACE'&&error.operationNotStarted===true);
  await assert.rejects(stat(destination),{code:'ENOENT'});
 }
 assert.equal(await moves.status(projectId),null);assert.equal((await registry.read()).revision,revision);assert.equal((await registry.locate(projectId)).root,project.root);assert.equal(await moveSource(project.root),null);
 for(const book of books){
  assert.equal(await moveSource(book.storage.root),null);await book.storage.withLock(()=>{});
  const writing=new RecordWriting(book.storage),current=await writing.read(book.target);await writing.save({...book.target,expectedRevision:current.revision,value:{body:'Written after a refused move'}});
  assert.equal((await writing.read(book.target)).value.body,'Written after a refused move');assert.equal(await book.storage.readFile(path.join(book.storage.root,'.observanda/evidence.bin'),'utf8'),'Original evidence '+book.directory);
 }
});

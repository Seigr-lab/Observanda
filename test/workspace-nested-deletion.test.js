import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorkspaceDeletions} from '../src/workspace-deletion.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectStorage,initializeProjectLocation} from '../src/project-storage.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {ResearchRecords} from '../src/research.js';
import {MediaStore} from '../src/media.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {TestDeviceStore} from './device-fixture.js';
import {clearVault} from '../src/encryption.js';
import {sampleNotebook} from '../src/sample.js';
import {createNotebook} from '../src/model.js';
import {initializeLocation} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {workspaceDeletion} from '../src/workspace-delete-state.js';

test('workspace deletion stops nested project and book owners and preserves external owners across restart',{timeout:240000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-nested-delete-')),keys=[],device=new TestDeviceStore({file:path.join(directory,'device')}),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider);
 t.after(async()=>{await provider.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-nested-delete-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const grant=async()=>{const access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);keys.push(vault);return {access,vault};};
 const workspaceKey=await grant(),metadata=createNotebook('Research Workspace 1'),root=path.join(directory,metadata.title);await initializeLocation(root,metadata,workspaceKey.access,workspaceKey.vault);const workspace=new Workspace(root,workspaceKey.vault),registry=new ProjectRegistry(workspace,metadata.id),projects=new Map(),books=new Map();
 async function project(name,parent=null,{external=false}={}){
  const model=createNotebook(name),id=randomUUID(),{access,vault}=await grant();model.projects=[{id,title:name,parentId:null,description:'',share:false,logoId:null}];
  const storage=await initializeProjectLocation(path.join(external?directory:parent?.root??root,name),id,model,access,vault);await registry.attach(storage,{parentId:parent?.projectId??null,expected:(await registry.read()).revision});projects.set(id,storage);return storage;
 }
 async function book(parent,title){
  const result=await new LabBookCreation(parent,device).create({id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId:parent.projectId,title}}),entry=result.book,vault=await verifyAccess(await readAccess(entry.root),'','',{deviceStore:device});keys.push(vault);
  const storage=new LabBookStorage(entry.root,entry.labBookId,vault),outline=await storage.outline(),record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:entry.labBookId};await new ResearchRecords(storage,new MediaStore(storage)).save({workspaceId:outline.metadata.id,changes:[{id:record.id,expectedRevision:null,record}]});books.set(entry.labBookId,storage);return storage;
 }
 const selected=await project('Selected Project'),nested=await project('Nested Project',selected),outside=await project('External Project',null,{external:true}),selectedBook=await book(selected,'Observations'),nestedBook=await book(nested,'Nested observations'),outsideBook=await book(outside,'Retained observations'),externalBefore=await outsideBook.read(),receipts=path.join(directory,'deletions');
 const deletions=new WorkspaceDeletions(receipts),review=await deletions.review(workspace,{protectedPaths:[outside.root]}),withProject=async(id,use)=>use(projects.get(id)),withBook=async(parent,id,use)=>{assert.equal(path.dirname(books.get(id).root),parent.root);return use(books.get(id));};
 await assert.rejects(deletions.begin(workspace,review),{code:'ACCESS_LOCKED'});assert.equal(await workspaceDeletion(root),null);
 const foreign=path.join(selected.root,'.observanda/foreign-owner');await mkdir(path.join(foreign,'.observanda/postgresql'),{recursive:true});await writeFile(path.join(foreign,'.observanda/postgresql/keep'),'unregistered');
 await assert.rejects(deletions.begin(workspace,review,{withProject,withBook}),{code:'STORAGE_DELETE_CONTENTS'});assert.equal(await readFile(path.join(foreign,'.observanda/postgresql/keep'),'utf8'),'unregistered');assert.equal(await workspaceDeletion(root),null);assert.equal(path.dirname(foreign),path.join(selected.root,'.observanda'));await rm(foreign,{recursive:true});
 const id=randomUUID(),interrupt=phase=>async stage=>{if(stage===phase)throw Error('Interrupted '+phase);};
 await assert.rejects(deletions.begin(workspace,review,{id,withProject,withBook,checkpoint:interrupt('project-frozen')}),/Interrupted project-frozen/);
 await assert.rejects(selected.read(),{code:'STORAGE_DELETING'});await assert.rejects(nestedBook.read(),{code:'STORAGE_DELETING'});
 for(const phase of ['book-stopped','project-stopped','retired']){
  await assert.rejects(new WorkspaceDeletions(receipts).finish(id,{vault:workspaceKey.vault,checkpoint:interrupt(phase)}),new RegExp('Interrupted '+phase));assert.deepEqual(await outsideBook.read(),externalBefore);
 }
 await mkdir(root);await writeFile(path.join(root,'replacement.txt'),'unrelated new folder');assert.equal((await new WorkspaceDeletions(receipts).finish(id,{})).complete,true);
 assert.equal(await readFile(path.join(root,'replacement.txt'),'utf8'),'unrelated new folder');await assert.rejects(stat(path.join(directory,'.observanda-delete-'+id)),{code:'ENOENT'});assert.deepEqual(await outsideBook.read(),externalBefore);assert.equal((await outside.read()).book.title,'External Project');
});

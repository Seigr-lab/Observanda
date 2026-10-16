import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,access} from 'node:fs/promises';
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
import {initializeProjectLocation} from '../src/project-storage.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookRenames} from '../src/lab-book-rename.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {ResearchRecords} from '../src/research.js';
import {MediaStore} from '../src/media.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {workspaceRename} from '../src/workspace-rename-state.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-book-rename-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),vaults=[];
 t.after(async()=>{await provider.close();detach();vaults.forEach(clearVault);assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-book-rename-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const device=new TestDeviceStore({file:path.join(directory,'device.key')}),access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);vaults.push(vault);
 const model=createNotebook('Field Project 1'),projectId=randomUUID();model.projects=[{id:projectId,title:model.title,parentId:null,description:'',share:false,logoId:null}];
 const project=await initializeProjectLocation(path.join(directory,model.title),projectId,model,access,vault),registry=new LabBookRegistry(project),renames=new LabBookRenames(project);
 async function create(title){const {book}=await new LabBookCreation(project,device).create({id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId,title}}),key=await verifyAccess(await readAccess(book.root),'','',{deviceStore:device});vaults.push(key);return new LabBookStorage(book.root,book.labBookId,key);}
 return {project,registry,renames,create};
}

test('renaming a book preserves physical data and remains independent of parent and sibling writers',{timeout:180000},async t=>{
 const f=await fixture(t),book=await f.create('Observation Book 1'),sibling=await f.create('Observation Book 2'),before=await book.outline(),record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:book.labBookId};
 await new ResearchRecords(book,new MediaStore(book)).save({workspaceId:before.metadata.id,changes:[{id:record.id,expectedRevision:null,record}]});
 const materials=new ResearchMaterials(book),bytes=Buffer.from('Original observation bytes'),upload=await materials.startImport({recordId:record.id,name:'observation.txt',size:bytes.length});await materials.appendImport(upload.id,0,[bytes]);const ref=await materials.finishImport(upload.id),oldRoot=book.root,inode=await stat(oldRoot);
 await assert.rejects(f.renames.run(book,{id:randomUUID(),name:'Observation Book 2',expectedName:'Observation Book 1'}),{code:'EXISTS'});
 await assert.rejects(f.renames.run(book,{id:randomUUID(),name:'../outside',expectedName:'Observation Book 1'}),{code:'FOLDER_NAME'});
 let entered,release;const ready=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve),busy=f.project.withLock(()=>sibling.withLock(async()=>{entered();await held;}));await ready;
 const command={id:randomUUID(),name:'Observations 2026',expectedName:'Observation Book 1'};let moved;
 try{moved=await f.renames.run(book,command);}finally{release();await busy;}
 assert.equal(moved.book.root,path.join(f.project.root,command.name));assert.equal(String((await stat(moved.book.root)).ino),String(inode.ino));await assert.rejects(access(oldRoot),{code:'ENOENT'});
 const reopened=new LabBookStorage(moved.book.root,book.labBookId,book.vault),current=await reopened.read();assert.equal(current.book.title,command.name);assert.equal(current.book.notebooks[0].title,command.name);assert.equal(current.book.entries[0].title,record.title);assert.equal(current.book.id,before.metadata.id);assert.equal(await workspaceRename(reopened.root),null);
 const artifact=await new ResearchMaterials(reopened).artifact(ref),chunks=[];for await(const bytes of artifact.content.stream())chunks.push(bytes);assert.deepEqual(Buffer.concat(chunks),bytes);
 await f.renames.run(reopened,{id:randomUUID(),name:'Observations 2027',expectedName:command.name});const replay=await f.renames.run(book,command);assert.equal(replay.book.directory,'Observations 2027');
});

test('book rename recovers each durable boundary without replaying record contents',{timeout:300000},async t=>{
 const f=await fixture(t);let book=await f.create('Book 1');
 const first=await book.outline();
 for(const [index,boundary] of ['prepared','frozen','stopped','renamed','metadata','registered','complete'].entries()){
  const id=randomUUID(),expectedName=path.basename(book.root),name='Book '+(index+2);
  const configuration={profiles:[],sections:[{id:randomUUID(),profileId:null,key:'observation',label:'Observation '+index,description:'',enabled:true,fields:[]}]},settings={etag:(await book.outline()).etag,configuration};
  await assert.rejects(f.renames.run(book,{id,name,expectedName,settings,checkpoint:async stage=>{if(stage===boundary)throw new Error('Interrupted at '+stage);}}),new RegExp('Interrupted at '+boundary));
  const receipt=await f.renames.pending(book.labBookId);assert.equal(receipt.id,id);
  const recovered=await new LabBookRenames(f.project).resume(book.labBookId,book.vault);assert.equal(recovered.book.directory,name);book=new LabBookStorage(recovered.book.root,book.labBookId,book.vault);
  const outline=await book.outline();assert.equal(outline.metadata.id,first.metadata.id);assert.equal(outline.metadata.notebooks[0].title,name);assert.deepEqual(outline.metadata.notebooks[0].configuration,configuration);assert.equal(await workspaceRename(book.root),null);assert.equal(await f.renames.pending(book.labBookId),null);
  assert.equal((await f.registry.list()).total,1);
 }
});

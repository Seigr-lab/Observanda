import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,rename,stat} from 'node:fs/promises';
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
import {LabBookCopies} from '../src/lab-book-copy.js';
import {LabBookRenames} from '../src/lab-book-rename.js';
import {ProjectBookRename} from '../src/project-book-rename.js';
import {ResearchRecords} from '../src/research.js';
import {MediaStore} from '../src/media.js';
import {RecordWriting} from '../src/record-writing.js';
import {catalogueBinding} from '../src/postgres-activation.js';

test('selected book commands recover independently and serialize only intersecting owner lifecycles',{timeout:180000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-selected-book-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),keys=[];let release,parentTask,copyTask;
 t.after(async()=>{release?.();await Promise.allSettled([parentTask,copyTask]);await provider.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-selected-book-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const device=new TestDeviceStore({file:path.join(directory,'device.key')}),access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);keys.push(vault);
 const metadata=createNotebook('Field Project 1'),projectId=randomUUID();metadata.projects=[{id:projectId,title:metadata.title,parentId:null,description:'',share:false,logoId:null}];
 const project=await initializeProjectLocation(path.join(directory,metadata.title),projectId,metadata,access,vault),books=[];
 for(const title of ['Observations \u00c5 1','Independent Sibling']){
  const created=await new LabBookCreation(project,device).create({id:randomUUID(),username:'',password:'Independent transfer password',book:{id:randomUUID(),projectId,title}}),key=await verifyAccess(await readAccess(created.book.root),'','Independent transfer password',{deviceStore:device});keys.push(key);
  const storage=new LabBookStorage(created.book.root,created.book.labBookId,key),outline=await storage.outline(),record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:storage.labBookId};await new ResearchRecords(storage,new MediaStore(storage)).save({workspaceId:outline.metadata.id,changes:[{id:record.id,expectedRevision:null,record}]});books.push({storage,entry:created.book,target:{workspaceId:outline.metadata.id,recordId:record.id,sectionId:null}});
 }
 const [first,sibling]=books,command=new LabBookCopies(project,first.storage.labBookId),archive=new LabBookCopies(project,first.storage.labBookId,'export'),parent=path.join(directory,'Copies'),exports=path.join(directory,'Backups');await mkdir(parent);await mkdir(exports);
 await assert.rejects(command.run(first.storage,{id:randomUUID(),parent:project.root}),{code:'STORAGE_PATH'});assert.equal(await command.status(),null);
 const id=randomUUID(),destination=path.join(parent,first.entry.directory);
 await assert.rejects(command.run(first.storage,{id,parent,checkpoint:stage=>{if(stage==='files')throw Error('Interrupted transfer');}}),/Interrupted transfer/);
 assert.equal((await command.status()).running,false);assert.equal((await command.status()).canCancel,true);
 await assert.rejects(archive.run(first.storage,{id:randomUUID(),parent:exports}),{code:'LAB_BOOK_TRANSFER_PENDING'});
 await assert.rejects(new LabBookRenames(project).run(first.storage,{id:randomUUID(),name:'Renamed book',expectedName:first.entry.directory}),{code:'LAB_BOOK_TRANSFER_PENDING'});
 await assert.rejects(command.run(first.storage,{id:randomUUID(),resume:true}),{code:'NOT_FOUND'});
 assert.equal((await command.run(first.storage,{id,resume:true})).phase,'complete');
 const copied=new LabBookStorage(destination,first.storage.labBookId,first.storage.vault);assert.deepEqual(await copied.read(),await first.storage.read());assert.notEqual((await catalogueBinding(destination)).id,(await catalogueBinding(first.storage.root)).id);
 const writing=new RecordWriting(copied),before=await writing.read(first.target);await writing.save({...first.target,expectedRevision:before.revision,value:{body:'Written in the copy'}});await command.run(first.storage,{id,resume:true});assert.equal((await writing.read(first.target)).value.body,'Written in the copy');
 // The parent already passed preflight. Keep the command alive after its
 // source writer is released, before its completion receipt is published.
 const owner=new ProjectBookRename(project);await owner.prepare((bookId,use)=>use(books.find(book=>book.storage.labBookId===bookId).storage));
 const save=archive.state.save.bind(archive.state);let entered,parentEntered=false;const ready=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve);
 archive.state.save=async value=>{if(value.phase==='complete'){entered();await held;}return save(value);};
 copyTask=archive.run(first.storage,{id:randomUUID(),parent:exports});await ready;
 parentTask=owner.withStorageHandoff(async()=>{parentEntered=true;await owner.persist(randomUUID(),{});});
 const siblingWriting=new RecordWriting(sibling.storage),old=await siblingWriting.read(sibling.target);await siblingWriting.save({...sibling.target,expectedRevision:old.revision,value:{body:'Sibling stayed writable'}});
 assert.equal(parentEntered,false);assert.equal((await archive.status()).running,true);release();await copyTask;await parentTask;owner.close();assert.equal(parentEntered,true);
 const cancelledParent=path.join(directory,'Cancelled');await mkdir(cancelledParent);const cancelId=randomUUID();await assert.rejects(command.run(first.storage,{id:cancelId,parent:cancelledParent,checkpoint:stage=>{if(stage==='files')throw Error('Interrupted transfer');}}),/Interrupted transfer/);await assert.rejects(command.cancel(first.storage,{id:randomUUID()}),{code:'NOT_FOUND'});await command.cancel(first.storage,{id:cancelId});assert.equal((await command.status()).phase,'cancelled');assert.ok(await stat(path.join(cancelledParent,first.entry.directory)));
 for(const book of books)await provider.closeLabBook(book.storage.root);await provider.closeProject(project.root);await rename(project.root,project.root+' unavailable');
 const exported=new LabBookStorage(path.join(exports,first.entry.directory),first.storage.labBookId,first.storage.vault);assert.equal((await new RecordWriting(exported).read(first.target)).value.body,sampleNotebook().entries[0].body);
});

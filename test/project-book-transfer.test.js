import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,rename,stat,readdir} from 'node:fs/promises';
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
import {ProjectStorage,initializeProjectLocation} from '../src/project-storage.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {LabBookRouter} from '../src/lab-book-router.js';
import {copyProjectLocation,projectTransferReceipt} from '../src/project-transfer.js';
import {ResearchRecords} from '../src/research.js';
import {MediaStore} from '../src/media.js';
import {RecordWriting} from '../src/record-writing.js';
import {catalogueBinding,CATALOGUE_ARCHIVE} from '../src/postgres-activation.js';
import {withWriterLease} from '../src/writer-lease.js';
import {serialize} from '../src/storage-format.js';
import {workspaceCopyTransferId} from '../src/workspace-copy-directory.js';

test('nested project copies and portable exports publish every independently owned book and recover interruption',{timeout:240000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-books-transfer-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),vaults=[];
 t.after(async()=>{await provider.close();detach();vaults.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-books-transfer-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const device=new TestDeviceStore({file:path.join(directory,'device.key')}),accessDocument=await createWorkspaceAccess('','Project transfer password',device),vault=takeCreatedVault(accessDocument);vaults.push(vault);
 const metadata=createNotebook('Field Project Å 1'),projectId=randomUUID();metadata.projects=[{id:projectId,title:metadata.title,parentId:null,description:'',share:false,logoId:null}];
 const source=await initializeProjectLocation(path.join(directory,metadata.title),projectId,metadata,accessDocument,vault),books=[];
 async function addBook(title){
  const created=await new LabBookCreation(source,device).create({id:randomUUID(),username:'',password:'Book transfer password',book:{id:randomUUID(),projectId,title}}),key=await verifyAccess(await readAccess(created.book.root),'','Book transfer password',{deviceStore:device});vaults.push(key);
  const storage=new LabBookStorage(created.book.root,created.book.labBookId,key),outline=await storage.outline(),record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:storage.labBookId};
  await new ResearchRecords(storage,new MediaStore(storage)).save({workspaceId:outline.metadata.id,changes:[{id:record.id,expectedRevision:null,record}]});
  const target={workspaceId:outline.metadata.id,recordId:record.id,sectionId:null},writing=new RecordWriting(storage),first=await writing.read(target);await writing.save({...target,expectedRevision:first.revision,value:{body:'Retained '+title}});
  books.push({storage,key,entry:created.book,target,before:await storage.read()});
 }
 await mkdir(path.join(directory,'Empty project'));const empty=await copyProjectLocation(source,path.join(directory,'Empty project',metadata.title),{id:randomUUID(),onCopiedBook:()=>assert.fail('An empty project has no book callback')});assert.equal((await projectTransferReceipt(empty)).phase,'verified');await provider.closeProject(empty.root);
 for(const title of ['Observations \u00c5 1','Measurements 2'])await addBook(title);
 const withBook=(id,use)=>use(books.find(book=>book.storage.labBookId===id).storage),parent=path.join(directory,'Copies');await mkdir(parent);
 const destination=path.join(parent,metadata.title),id=randomUUID();
 await assert.rejects(copyProjectLocation(source,destination,{id}),{code:'ACCESS_LOCKED'});await assert.rejects(stat(destination),{code:'ENOENT'});
 await assert.rejects(copyProjectLocation(source,path.join(parent,'Different name'),{id,withBook}),{code:'STORAGE_NAME_MISMATCH'});await assert.rejects(stat(path.join(parent,'Different name')),{code:'ENOENT'});
 const ordered=books.toSorted((a,b)=>a.storage.labBookId.localeCompare(b.storage.labBookId)),trigger=Promise.withResolvers(),held=Promise.withResolvers();let refusalStarted;
 // Competing rename order is book -> directory. Copy must refuse this lease,
 // not wait while retaining the directory barrier needed by the rename.
 const competing=trigger.promise.then(()=>withWriterLease(path.join(source.root,'.observanda/lab-book-creation','book-'+ordered[1].storage.labBookId+'.lock'),async()=>{
  held.resolve();await withWriterLease(path.join(source.root,'.observanda/lab-books.lock'),async()=>{});
 }));
 try{await assert.rejects(copyProjectLocation(source,destination,{id,withBook,checkpoint:async stage=>{if(stage==='book'){trigger.resolve();await held.promise;refusalStarted=Date.now();}}}),{code:'LOCKED'});}
 finally{trigger.resolve();await competing;}
 assert.ok(Date.now()-refusalStarted<10000,'copy must release the directory barrier promptly');
 await assert.rejects(new ProjectStorage(destination,projectId,vault).outline(),{code:'STORAGE_INCOMPLETE'});
 const pendingTarget=new ProjectStorage(destination,projectId,vault),pending=await projectTransferReceipt(pendingTarget);assert.equal(pending.phase,'database');assert.equal(pending.bookTransfersVersion,2);assert.equal(pending.bookCount,2);assert.equal(pending.bookTransfers,undefined);assert.ok(Buffer.byteLength(serialize(pending))<4096);
 // An existing array receipt keeps its original IDs, including IDs which are
 // not derived by the new writer. Its already copied first book stays valid.
 pending.bookTransfers=ordered.map((book,index)=>({labBookId:book.storage.labBookId,id:index?randomUUID():workspaceCopyTransferId(id,book.storage.labBookId)}));delete pending.bookTransfersVersion;delete pending.bookCount;
 await pendingTarget.writeFile(path.join(destination,'.observanda/project-transfer.observanda'),serialize(pending));
 const received=[],borrowed=[],copied=await copyProjectLocation(source,destination,{id,withBook,onCopiedBook:storage=>{received.push(storage.labBookId);borrowed.push(storage.vault);}}),finished=await projectTransferReceipt(copied);
 assert.deepEqual(finished.bookTransfers,pending.bookTransfers);assert.equal(finished.phase,'verified');assert.equal(received.length,2);assert.ok(borrowed.every(key=>key.key===null),'copied-book callbacks must not retain usable borrowed keys');
 assert.deepEqual((await new LabBookRegistry(copied).read()).value,(await new LabBookRegistry(source).read()).value);
 for(const book of books){
  const copy=new LabBookStorage(path.join(copied.root,book.entry.directory),book.storage.labBookId,book.key);assert.deepEqual(await copy.read(),book.before);assert.notEqual((await catalogueBinding(copy.root)).id,(await catalogueBinding(book.storage.root)).id);await provider.closeLabBook(copy.root);
 }
 assert.ok(!(await readdir(path.join(copied.root,'.observanda'))).includes('lab-books.lock'));
 const first=books[0],changed=new LabBookStorage(path.join(copied.root,first.entry.directory),first.storage.labBookId,first.key),writing=new RecordWriting(changed),current=await writing.read(first.target);await writing.save({...first.target,expectedRevision:current.revision,value:{body:'Edited in copied book'}});
 await addBook('Added after the completed copy');
 received.length=0;await copyProjectLocation(source,destination,{id,withBook,onCopiedBook:storage=>received.push(storage.labBookId)});assert.equal(received.length,2);assert.equal((await writing.read(first.target)).value.body,'Edited in copied book');
 const backups=path.join(directory,'Backups');await mkdir(backups);const portable=await copyProjectLocation(source,path.join(backups,metadata.title),{id:randomUUID(),withBook,portable:true});assert.equal(await catalogueBinding(portable.root),null);
 for(const book of books){const root=path.join(portable.root,book.entry.directory);assert.equal(await catalogueBinding(root),null);assert.ok(await stat(path.join(root,CATALOGUE_ARCHIVE)));await provider.closeLabBook(book.storage.root);}
 await provider.closeProject(source.root);await rename(source.root,source.root+' unavailable');
 const restored=new ProjectStorage(portable.root,projectId,vault);await restored.outline();
 const router=new LabBookRouter(new LabBookRegistry(restored),{authorize:async()=>true,unlock:async entry=>books.find(book=>book.storage.labBookId===entry.labBookId).key});
 for(const book of books)await router.withLabBook(book.storage.labBookId,async storage=>{assert.deepEqual(await storage.read(),book.before);assert.equal(path.basename(storage.root),book.entry.directory);assert.equal((await catalogueBinding(storage.root)).placement,'lab-book');});
});

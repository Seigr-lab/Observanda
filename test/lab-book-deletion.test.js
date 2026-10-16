import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,access,mkdir,writeFile,readFile} from 'node:fs/promises';
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
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {LabBookDeletions,pendingLabBookDeletions} from '../src/lab-book-deletion.js';
import {ResearchRecords} from '../src/research.js';
import {MediaStore} from '../src/media.js';

 test('book deletion recovers frozen and retired states without touching siblings or a reused original path',{timeout:180000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-book-delete-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),vaults=[];
 t.after(async()=>{await provider.close();detach();vaults.forEach(clearVault);assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-book-delete-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const device=new TestDeviceStore({file:path.join(directory,'device.key')}),grant=await createWorkspaceAccess('','',device),vault=takeCreatedVault(grant);vaults.push(vault);
 const model=createNotebook('Field Project 1'),projectId=randomUUID();model.projects=[{id:projectId,title:model.title,parentId:null,description:'',share:false,logoId:null}];
 const project=await initializeProjectLocation(path.join(directory,model.title),projectId,model,grant,vault),registry=new LabBookRegistry(project);
 async function create(title){const {book}=await new LabBookCreation(project,device).create({id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId,title}}),key=await verifyAccess(await readAccess(book.root),'','',{deviceStore:device});vaults.push(key);return new LabBookStorage(book.root,book.labBookId,key);}
 const selected=await create('Selected Book'),sibling=await create('Sibling Book'),initial=await selected.outline(),record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:selected.labBookId};
 await new ResearchRecords(selected,new MediaStore(selected)).save({workspaceId:initial.metadata.id,changes:[{id:record.id,expectedRevision:null,record}]});
 const deletions=new LabBookDeletions(project,selected.labBookId),command={id:randomUUID(),expectedName:'Selected Book'};
 await assert.rejects(deletions.run(sibling.vault,command),{code:'DATABASE_LOCATION'});
 await assert.rejects(deletions.run(selected.vault,{...command,expectedName:'Sibling Book'}),{code:'CONFLICT'});
 let enter,release;const ready=new Promise(resolve=>enter=resolve),held=new Promise(resolve=>release=resolve),busy=project.withLock(()=>sibling.withLock(async()=>{enter();await held;}));await ready;
 try{await assert.rejects(deletions.run(selected.vault,{...command,checkpoint:async stage=>{if(stage==='frozen')throw Error('Interrupted after retirement');}}),/Interrupted after retirement/);}finally{release();await busy;}
 const pending=await pendingLabBookDeletions(project);assert.equal(pending.items.length,1);assert.equal(pending.items[0].labBookId,selected.labBookId);assert.equal(pending.items[0].name,'Selected Book');
 const receipt=await deletions.receipt();assert.equal(receipt.phase,'frozen');assert.equal((await registry.list()).total,1);assert.equal((await registry.read()).value.deleted[0].namespaceId,initial.metadata.id);
 await assert.rejects(selected.read(),{code:'STORAGE_DELETING'});assert.equal((await sibling.read()).book.title,'Sibling Book');
 await assert.rejects(new LabBookDeletions(project,selected.labBookId).run(selected.vault,{...command,checkpoint:async stage=>{if(stage==='retired')throw Error('Interrupted after folder rename');}}),/Interrupted after folder rename/);
 await assert.rejects(access(selected.root),{code:'ENOENT'});await mkdir(selected.root);await writeFile(path.join(selected.root,'keep.txt'),'New unrelated contents');
 const resumed=new LabBookDeletions(project,selected.labBookId);assert.equal(await resumed.authenticationRoot(await resumed.receipt()),null);
 const result=await resumed.run(null,command);assert.equal(result.complete,true);assert.equal((await resumed.receipt()).phase,'complete');
 assert.equal(await readFile(path.join(selected.root,'keep.txt'),'utf8'),'New unrelated contents');await assert.rejects(access(path.join(project.root,'.observanda-delete-'+command.id)),{code:'ENOENT'});
 assert.deepEqual((await pendingLabBookDeletions(project)).items,[]);
 assert.equal((await resumed.run(null,command)).complete,true);assert.equal((await sibling.read()).book.title,'Sibling Book');assert.equal((await project.read()).book.title,'Field Project 1');
});

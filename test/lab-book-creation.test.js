import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {TestDeviceStore} from './device-fixture.js';
import {clearVault} from '../src/encryption.js';
import {sampleNotebook} from '../src/sample.js';
import {catalogueBinding} from '../src/postgres-activation.js';

async function fixture(t){
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-book-creation-')),vaults=[],owner=new WorkspaceDatabases({directory:path.join(parent,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner);
 t.after(async()=>{await owner.close();detach();for(const vault of vaults)clearVault(vault);assert.equal(path.dirname(path.resolve(parent)),path.resolve(os.tmpdir()));assert.ok(path.basename(parent).startsWith('observanda-book-creation-'));await rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const device=new TestDeviceStore({file:path.join(parent,'device.key')}),access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);vaults.push(vault);
 const book=sampleNotebook();book.title='Field Project 1';book.projects[0].title=book.title;book.notebooks=[];book.entries=[];
 const root=path.join(parent,'Research Workspace 1',book.title);await mkdir(path.dirname(root),{recursive:true});const project=await initializeProjectLocation(root,book.projects[0].id,book,access,vault),creation=new LabBookCreation(project,device);
 const command=title=>({id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId:project.projectId,title}});
 async function open(entry){const key=await verifyAccess(await readAccess(entry.root),'','',{deviceStore:device});vaults.push(key);return new LabBookStorage(entry.root,entry.labBookId,key);}
 return {parent,project,creation,device,owner,command,open};
}

test('ordinary book creation derives exact nested names and acknowledges repeated requests once',async t=>{
 const f=await fixture(t),command=f.command('Field observations 1');
 let enter,release;const entered=new Promise(resolve=>enter=resolve),hold=new Promise(resolve=>release=resolve),busy=f.project.withLock(async()=>{enter();await hold;});await entered;
 let first;
 try{const replies=await Promise.all([f.creation.create(command),f.creation.create(command)]);assert.deepEqual(replies[0],replies[1]);first=replies[0].book;}finally{release();await busy;}
 assert.equal(first.root,path.join(f.project.root,command.book.title));assert.equal((await catalogueBinding(first.root)).placement,'lab-book');
 assert.deepEqual((await readdir(f.project.root)).sort(),['.observanda','Field observations 1','workspace.observanda']);
 const duplicate=f.command(command.book.title);await assert.rejects(f.creation.create(duplicate),{code:'EXISTS'});assert.equal(await f.creation.read(duplicate.id),null);
 for(const title of ['../escape','.observanda',' bad name '])await assert.rejects(f.creation.create(f.command(title)),{code:'FOLDER_NAME'});
 const another=await f.creation.create(f.command('Measurement notes 2'));assert.notEqual(another.book.vaultId,first.vaultId);assert.notEqual(another.book.namespaceId,first.namespaceId);
 const storage=await f.open(first);assert.equal((await storage.outline()).metadata.notebooks[0].title,command.book.title);
 assert.equal((await f.project.outline()).metadata.notebooks.length,0);assert.equal((await f.creation.registry.read()).value.books.length,2);
 await assert.rejects(f.creation.create({...command,book:{...command.book,title:'Changed request'}}),{code:'CONFLICT'});
});

test('book creation resumes after initialization and preserves edits after a lost registration reply',async t=>{
 const f=await fixture(t),command=f.command('Recovered Book'),attach=f.creation.registry.attach.bind(f.creation.registry);let interrupt=true;
 f.creation.registry.attach=async(...args)=>{if(interrupt){interrupt=false;throw Error('simulated interruption before registration');}return attach(...args);};
 await assert.rejects(f.creation.create(command),/simulated interruption/);
 const pending=await f.creation.read(command.id),root=path.join(f.project.root,pending.directory),binding=await catalogueBinding(root);assert.equal(pending.phase,'prepared');assert.equal((await f.creation.registry.read()).value.books.length,0);
 await f.owner.closeLabBook(root);const resumed=new LabBookCreation(f.project,f.device);assert.deepEqual((await resumed.pending()).items.map(item=>[item.id,item.running]),[[command.id,false]]);const result=await resumed.resume({id:command.id,username:'',password:''});assert.deepEqual(await catalogueBinding(root),binding);assert.equal(result.book.labBookId,command.book.id);assert.equal((await resumed.read(command.id)).phase,'attached');assert.equal((await resumed.pending()).items.length,0);await assert.rejects(readFile(resumed.file(command.id)),{code:'ENOENT'});
 const second=f.command('Lost Reply Book'),write=f.project.writeFile.bind(f.project);let fail=true;
 f.project.writeFile=async(file,content)=>{if(fail&&file===resumed.file(second.id,true)&&JSON.parse(content).phase==='attached'){fail=false;throw Error('simulated lost reply');}return write(file,content);};
 await assert.rejects(resumed.create(second),/simulated lost reply/);f.project.writeFile=write;
 const entry=await resumed.registry.locate(second.book.id),storage=await f.open(entry);await storage.update(book=>{book.description='Written after creation';return book;});const saved=await storage.read();
 assert.deepEqual((await new LabBookCreation(f.project,f.device).resume({id:second.id,username:'',password:''})).book,entry);assert.deepEqual(await storage.read(),saved);assert.equal((await resumed.registry.read()).value.books.length,2);
});

test('committed book initialization recovers before descriptor publication without changing identity',async t=>{
 const f=await fixture(t),command=f.command('Committed Book'),write=LabBookStorage.prototype.writeFile;let interrupted=false;
 LabBookStorage.prototype.writeFile=async function(file,content){if(!interrupted&&path.basename(file)==='workspace.observanda'){interrupted=true;throw Error('simulated descriptor interruption');}return write.call(this,file,content);};
 try{await assert.rejects(f.creation.create(command),/simulated descriptor interruption/);}finally{LabBookStorage.prototype.writeFile=write;}
 assert.equal(interrupted,true);const root=path.join(f.project.root,command.book.title),binding=await catalogueBinding(root),before=await readFile(path.join(root,'.observanda/access.json'));
 const result=await new LabBookCreation(f.project,f.device).create(command);assert.deepEqual(await catalogueBinding(root),binding);assert.deepEqual(await readFile(path.join(root,'.observanda/access.json')),before);
 assert.equal((await (await f.open(result.book)).outline()).metadata.notebooks[0].id,command.book.id);await assert.rejects(readFile(path.join(root,'.observanda/copy-in-progress')),{code:'ENOENT'});
});

test('creation recovery discovers bounded requests without opening books and preserves protected identity',async t=>{
 const f=await fixture(t),command={...f.command('Protected observations'),username:'  Researcher  ',password:'Temporary book password 456!'};let checks=0;
 await assert.rejects(f.creation.create(command,{check:async()=>{if(++checks===3)throw Error('Stop after retaining request');}}),/Stop after retaining request/);
 const second=f.command('Other observations');checks=0;
 await assert.rejects(f.creation.create(second,{check:async()=>{if(++checks===3)throw Error('Stop after retaining request');}}),/Stop after retaining request/);
 const original=f.project.outline;f.project.outline=()=>{throw Error('Discovery must not read project contents');};
 const firstPage=await f.creation.pending({limit:1}),nextPage=await f.creation.pending({after:firstPage.next,limit:1});
 assert.equal(firstPage.items.length,1);assert.equal(nextPage.items.length,1);assert.equal(nextPage.next,null);assert.notEqual(firstPage.items[0].id,nextPage.items[0].id);f.project.outline=original;
 const pending=[...firstPage.items,...nextPage.items].find(item=>item.id===command.id);assert.equal(pending.password,true);assert.equal(pending.running,false);assert.equal(pending.username,'Researcher');
 const intent=await f.creation.read(command.id),resume=new LabBookCreation(f.project,f.device);
 await assert.rejects(resume.resume({id:command.id,username:pending.username,password:'incorrect'}),{code:'ACCESS_DENIED'});assert.deepEqual(await resume.read(command.id),intent);
 let entered,release;const ready=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve),attach=resume.registry.attach.bind(resume.registry);
 resume.registry.attach=async(...args)=>{entered();await held;return attach(...args);};
 const running=resume.resume({id:command.id,username:pending.username,password:command.password});let result;
 try{await ready;assert.equal((await resume.pending()).items.find(item=>item.id===command.id).running,true);assert.equal((await resume.pending()).items.find(item=>item.id===second.id).running,false);}finally{release();result=await running;}
 assert.equal(result.book.namespaceId,intent.namespaceId);assert.equal(result.book.vaultId,intent.vaultId);assert.equal((await resume.pending()).items.length,1);
 assert.deepEqual(await resume.resume({id:command.id,username:pending.username,password:command.password}),result);
 await assert.rejects(resume.resume({id:randomUUID(),username:'',password:''}),{code:'NOT_FOUND'});
 await assert.rejects(resume.pending({limit:51}),{code:'INVALID'});
});

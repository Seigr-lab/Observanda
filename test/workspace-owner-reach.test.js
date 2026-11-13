import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {workDirectory} from '../scripts/work-directory.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectApplication,projectRequest} from '../src/project-application.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';

async function project(f,host,title,password,keys){
 const book=sampleNotebook();book.title=book.projects[0].title=title;
 book.entries[0].title=title+' shared observation';book.entries[2].title=title+' private note';
 const access=await createWorkspaceAccess('',password,f.deviceStore),key=takeCreatedVault(access);keys.push(key);
 const registry=new ProjectRegistry(f.workspace,host.id),storage=await initializeProjectLocation(path.join(f.workspace.root,title),book.projects[0].id,book,access,key);
 await registry.attach(storage,{expected:(await registry.read()).revision});
 return {book,storage,registry};
}

// One workspace is one body of work: every project and lab book in it can be
// reached through its own grant, a locked one is listed and never read, private
// records never leave their owner, and another workspace is never reachable.
test('workspace owners are reachable through their own grants and projection, never across workspaces',async()=>{
 const work=await workDirectory('test-work'),directory=await mkdtemp(path.join(work,'workspace-reach-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),keys=[];let application;
 try{
  const host=sampleNotebook(),f=await encryptedFixture(path.join(directory,'first'),host);keys.push(f.vault);
  const open=await project(f,host,'Apiary records','',keys),locked=await project(f,host,'Sealed archive','Archive password',keys);
  const book=await new LabBookCreation(open.storage,f.deviceStore,{publish:value=>new LabBookDirectory(open.registry).register(open.storage.projectId,value)}).create({id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId:open.storage.projectId,title:'Hive measurements',configuration:{profiles:[],sections:[]}}});
  const secondHost=sampleNotebook(),g=await encryptedFixture(path.join(directory,'second'),secondHost);keys.push(g.vault);
  const foreign=await project(g,secondHost,'Other workspace project','',keys);

  application=new ProjectApplication(f.workspace,{deviceStore:f.deviceStore});const client={};
  const owners=projectRequest('/api/projects/workspace-owners','POST'),records=projectRequest('/api/projects/workspace-owner-records','POST');
  const listing=await application.run(client,owners,{workspaceId:host.id,projectId:null,search:'',offset:0,limit:25,revision:null});
  const row=id=>listing.items.find(item=>item.projectId===id);
  assert.equal(listing.items.find(item=>item.kind==='workspace').current,true);
  assert.equal(row(open.storage.projectId).access,'open');assert.equal(row(open.storage.projectId).workspaceId,open.book.id);
  assert.equal(row(locked.storage.projectId).access,'locked');
  assert.equal(listing.items.some(item=>item.projectId===foreign.storage.projectId||item.workspaceId===foreign.book.id||item.workspaceId===secondHost.id),false);

  const books=await application.run(client,owners,{workspaceId:host.id,projectId:open.storage.projectId,search:'',offset:0,limit:25,revision:null});
  const labBook=books.items.find(item=>item.kind==='lab-book');assert.equal(labBook.label,'Hive measurements');assert.equal(labBook.workspaceId,book.book.namespaceId);assert.equal(labBook.access,'open');

  const shared=await application.run(client,records,{workspaceId:host.id,sourceId:open.book.id,search:'',offset:0,limit:25});
  assert.deepEqual(shared.owner,{workspaceId:open.book.id,projectId:open.storage.projectId,labBookId:null});
  assert.ok(shared.items.some(item=>item.title==='Apiary records shared observation'&&item.projectId===open.book.projects[0].id&&/^[a-f0-9]{64}$/.test(item.revision)));
  assert.equal(shared.items.some(item=>item.title==='Apiary records private note'),false);
  assert.equal(shared.total,open.book.entries.filter(entry=>entry.share===true).length);
  const searched=await application.run(client,records,{workspaceId:host.id,sourceId:open.book.id,search:'private',offset:0,limit:25});assert.equal(searched.total,0);

  await assert.rejects(application.run(client,records,{workspaceId:host.id,sourceId:locked.book.id,search:'',offset:0,limit:25}),error=>{assert.equal(error.code,'DEVICE_UNKNOWN');return error.projectId===locked.storage.projectId;});
  await assert.rejects(application.run(client,records,{workspaceId:host.id,sourceId:foreign.book.id,search:'',offset:0,limit:25}),error=>error.code==='NOT_FOUND');
  await assert.rejects(application.run(client,records,{workspaceId:secondHost.id,sourceId:foreign.book.id,search:'',offset:0,limit:25}),error=>['WORKSPACE_CHANGED','INVALID'].includes(error.code));

  // Saved links: an unlocked owner resolves, a locked one asks for its grant,
  // and a record of another workspace is not registered here.
  const location=projectRequest('/api/projects/reference-location','POST'),target=entry=>({workspaceId:entry.book.id,kind:'record',id:entry.book.entries[0].id});
  assert.equal((await application.run(client,location,target(open))).projectId,open.storage.projectId);
  await assert.rejects(application.run(client,location,target(locked)),error=>{assert.equal(error.code,'DEVICE_UNKNOWN');return error.projectId===locked.storage.projectId;});
  assert.equal((await application.run(client,location,target(foreign))).registered,false);

  await application.unlock(client,locked.storage.projectId,{password:'Archive password'});
  const unlocked=await application.run(client,records,{workspaceId:host.id,sourceId:locked.book.id,search:'',offset:0,limit:25});
  assert.ok(unlocked.items.some(item=>item.title==='Sealed archive shared observation'));assert.equal(unlocked.items.some(item=>item.title==='Sealed archive private note'),false);
  assert.equal((await application.run(client,owners,{workspaceId:host.id,projectId:null,search:'',offset:0,limit:25,revision:null})).items.find(item=>item.projectId===locked.storage.projectId).access,'open');

  // From inside a project the workspace and its other owners stay reachable.
  const scoped=projectRequest('/api/projects/'+open.storage.projectId+'/workspace-owners','POST'),inside=await application.run(client,scoped,{workspaceId:open.book.id,projectId:null,search:'',offset:0,limit:25,revision:null});
  assert.equal(inside.items.find(item=>item.kind==='workspace').workspaceId,host.id);assert.equal(inside.items.find(item=>item.projectId===open.storage.projectId).current,true);
  const fromProject=await application.run(client,projectRequest('/api/projects/'+open.storage.projectId+'/workspace-owner-records','POST'),{workspaceId:open.book.id,sourceId:locked.book.id,search:'',offset:0,limit:25});
  assert.ok(fromProject.items.some(item=>item.title==='Sealed archive shared observation'));

  await application.lock(client,locked.storage.projectId);
  await assert.rejects(application.run(client,records,{workspaceId:host.id,sourceId:locked.book.id,search:'',offset:0,limit:25}),error=>error.code==='ACCESS_LOCKED'&&error.projectId===locked.storage.projectId);
  assert.equal((await application.run(client,owners,{workspaceId:host.id,projectId:null,search:'',offset:0,limit:25,revision:null})).items.find(item=>item.projectId===locked.storage.projectId).access,'locked');
 }finally{
  await application?.close();await runtime.close();detach();await Promise.all(keys.map(clearVault));
  if(path.dirname(directory)!==work||!path.basename(directory).startsWith('workspace-reach-'))throw Error('Invalid test directory');
  await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});

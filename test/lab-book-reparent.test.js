import {test} from 'node:test';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rmdir,rm,stat} from 'node:fs/promises';
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
import {initializeProjectLocation} from '../src/project-storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookReparents} from '../src/lab-book-reparent.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {ProjectBookOwners} from '../src/project-book-owners.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {MediaStore} from '../src/media.js';
import {RecordWriting} from '../src/record-writing.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {resolveResearchReference} from '../src/research-owner-reference.js';
import {withWriterLease} from '../src/writer-lease.js';

test('moving a book between project folders preserves identities and recovers every publication boundary',{timeout:480000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-book-placement-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),keys=[];let release,busy;
 t.after(async()=>{release?.();await busy?.catch(()=>{});await provider.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-book-placement-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const device=new TestDeviceStore({file:path.join(directory,'device.key')});
 async function credentials(){const access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);keys.push(vault);return {access,vault};}
 const initial=createNotebook('Research Workspace 1'),credentials0=await credentials(),root=path.join(directory,initial.title);await initializeLocation(root,initial,credentials0.access,credentials0.vault);const workspace=new Workspace(root,credentials0.vault),registry=new ProjectRegistry(workspace,initial.id),addresses=new LabBookDirectory(registry);
 async function project(title){const metadata=createNotebook(title),id=randomUUID(),key=await credentials();metadata.projects=[{id,title,parentId:null,description:'',share:false,logoId:null}];const storage=await initializeProjectLocation(path.join(root,title),id,metadata,key.access,key.vault);await registry.attach(storage,{expected:(await registry.read()).revision});return storage;}
 let source=await project('Field Project 1'),target=await project('Field Project 2');
 async function create(parent,title){const entry=(await new LabBookCreation(parent,device,{publish:book=>addresses.register(parent.projectId,book)}).create({id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId:parent.projectId,title}})).book,key=await verifyAccess(await readAccess(entry.root),'','',{deviceStore:device});keys.push(key);return {entry,storage:new LabBookStorage(entry.root,entry.labBookId,key)};}
 const first=await create(source,'\u00c5ngstr\u00f6m Notes 1'),sibling=await create(target,'Independent Notes');let storage=first.storage;
 const record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:storage.labBookId};await new ResearchRecords(storage,new MediaStore(storage)).save({workspaceId:first.entry.namespaceId,changes:[{id:record.id,expectedRevision:null,record}]});
 const original=await storage.read(),oldRecord=original.book.entries[0],reference={workspaceId:first.entry.namespaceId,kind:'record',id:oldRecord.id,revision:recordRevision(oldRecord)},originalIdentity=await stat(storage.root),materials=new ResearchMaterials(storage),bytes=Buffer.from('Retained observation bytes'),upload=await materials.startImport({recordId:oldRecord.id,name:'observations.txt',size:bytes.length});await materials.appendImport(upload.id,0,[bytes]);const artifact=await materials.finishImport(upload.id);
 const originalFile=await materials.artifactPath(await materials.read(artifact)),fileIdentity=await stat(originalFile),command=new LabBookReparents(registry,storage.labBookId);
 // A colliding folder is rejected before reserving either project.
 const collision=path.join(target.root,first.entry.directory);await mkdir(collision);await assert.rejects(command.run(source,target,storage.vault,{id:randomUUID()}),{code:'EXISTS'});await rmdir(collision);assert.equal(await command.read(),null);
 // A conflicting book lease must fail without waiting while holding another lease.
 const lock=path.join(target.root,'.observanda/lab-book-creation','book-'+storage.labBookId+'.lock');let entered;let gate=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve);busy=withWriterLease(lock,async()=>{entered();await hold;});await gate;
 try{await assert.rejects(command.run(source,target,storage.vault,{id:randomUUID()}),{code:'LOCKED'});}finally{release();await busy;busy=null;}
 const stages=['prepared','frozen','stopped','renamed','metadata','attached','addressed','registered','complete'];
 for(const stage of stages){
  const id=randomUUID(),sourceRoot=storage.root;
  await assert.rejects(command.run(source,target,storage.vault,{id,checkpoint:point=>{if(point===stage)throw Error('Interrupted at '+stage);}}),new RegExp('Interrupted at '+stage));
  if(stage!=='complete'){
   await assert.rejects(new ProjectBookOwners(source).ready(),{code:'LAB_BOOK_MOVE_PENDING'});await assert.rejects(new ProjectBookOwners(target).ready(),{code:'LAB_BOOK_MOVE_PENDING'});
   await assert.rejects(new LabBookCreation(target,device).create({id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId:target.projectId,title:first.entry.directory}}),{code:'LAB_BOOK_MOVE_PENDING'});
  }
  if(stage==='prepared'){
   const writing=new RecordWriting(storage),address={workspaceId:first.entry.namespaceId,recordId:oldRecord.id,sectionId:null},before=await writing.read(address);await writing.save({...address,expectedRevision:before.revision,value:{body:'Edited before the move froze'}});
  }
  const siblingRecord={...record,id:randomUUID(),notebookId:sibling.storage.labBookId};await new ResearchRecords(sibling.storage,new MediaStore(sibling.storage)).save({workspaceId:sibling.entry.namespaceId,changes:[{id:siblingRecord.id,expectedRevision:null,record:siblingRecord}]});
  const moved=await new LabBookReparents(registry,storage.labBookId).run(source,target,storage.vault,{id});assert.equal(moved.complete,true);assert.equal(moved.book.root,path.join(target.root,first.entry.directory));await assert.rejects(stat(sourceRoot),{code:'ENOENT'});
  assert.equal((await stat(moved.book.root)).ino,originalIdentity.ino);await assert.rejects(new LabBookRegistry(source).locate(storage.labBookId),{code:'LAB_BOOK_MOVED'});
  const located=await registry.reference(reference);assert.equal(located.projectId,target.projectId);assert.equal(located.labBookId,storage.labBookId);
  storage=new LabBookStorage(moved.book.root,storage.labBookId,storage.vault);const latest=await storage.read();assert.equal(latest.book.projects[0].id,target.projectId);assert.equal(latest.book.notebooks[0].projectId,target.projectId);assert.equal(latest.book.entries[0].body,'Edited before the move froze');assert.equal((await resolveResearchReference(storage,reference,{namespaceId:first.entry.namespaceId})).value.body,oldRecord.body);
  const evidence=new ResearchMaterials(storage),doc=await evidence.read(artifact);assert.equal((await stat(await evidence.artifactPath(doc))).ino,fileIdentity.ino);await evidence.artifact(artifact);
  assert.equal((await command.run(source,target,storage.vault,{id})).complete,true);await new ProjectBookOwners(source).ready();await new ProjectBookOwners(target).ready();
  t.diagnostic('Recovered '+stage+' without copying record or evidence files');[source,target]=[target,source];
 }
 const latest=await storage.read();await storage.restore(original.etag,latest.etag);const restored=await storage.read();assert.equal(restored.book.projects[0].id,source.projectId);assert.equal(restored.book.notebooks[0].projectId,source.projectId);assert.equal(restored.book.notebooks[0].title,first.entry.directory);assert.equal(restored.book.entries[0].body,oldRecord.body);
 for(const stage of ['cancelling','cancel-unfrozen','cancelled','cancel-target-released']){
  const id=randomUUID(),rename=fs.rename;
  fs.rename=async(from,to)=>{if(from===storage.root)throw Object.assign(Error('Another filesystem'),{code:'EXDEV'});return rename(from,to);};syncBuiltinESMExports();
  try{await assert.rejects(command.run(source,target,storage.vault,{id,checkpoint:point=>{if(point===stage)throw Error('Interrupted '+stage);}}),new RegExp('Interrupted '+stage));}finally{fs.rename=rename;syncBuiltinESMExports();}
  await assert.rejects(command.run(source,target,storage.vault,{id}),{code:'STORAGE_RENAME_VOLUME'});
  assert.equal((await command.read()).phase,'cancelled');await new ProjectBookOwners(source).ready();await new ProjectBookOwners(target).ready();
  assert.equal((await new LabBookRegistry(source).locate(storage.labBookId)).root,storage.root);assert.equal((await storage.read()).book.entries[0].body,oldRecord.body);
  t.diagnostic('Recovered cancellation at '+stage);
 }
});

test('a killed book move resumes from its existing destination folder',{timeout:480000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-book-killed-')),options={directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}};let provider=new WorkspaceDatabases(options),detach=installDatabaseProvider(provider);const keys=[];let release,busy;
 t.after(async()=>{release?.();await busy?.catch(()=>{});await provider.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-book-killed-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const device=new TestDeviceStore({file:path.join(directory,'device.key')});
 async function credentials(){const access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);keys.push(vault);return {access,vault};}
 const initial=createNotebook('Research Workspace 1'),credentials0=await credentials(),root=path.join(directory,initial.title);await initializeLocation(root,initial,credentials0.access,credentials0.vault);const workspace=new Workspace(root,credentials0.vault),registry=new ProjectRegistry(workspace,initial.id),addresses=new LabBookDirectory(registry);
 async function project(title){const metadata=createNotebook(title),id=randomUUID(),key=await credentials();metadata.projects=[{id,title,parentId:null,description:'',share:false,logoId:null}];const storage=await initializeProjectLocation(path.join(root,title),id,metadata,key.access,key.vault);await registry.attach(storage,{expected:(await registry.read()).revision});return storage;}
 let source=await project('Field Project 1'),target=await project('Field Project 2');
 async function create(parent,title){const entry=(await new LabBookCreation(parent,device,{publish:book=>addresses.register(parent.projectId,book)}).create({id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId:parent.projectId,title}})).book,key=await verifyAccess(await readAccess(entry.root),'','',{deviceStore:device});keys.push(key);return {entry,storage:new LabBookStorage(entry.root,entry.labBookId,key)};}
 const first=await create(source,'\u00c5ngstr\u00f6m Notes 1'),sibling=await create(target,'Independent Notes');let storage=first.storage;
 const record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:storage.labBookId};await new ResearchRecords(storage,new MediaStore(storage)).save({workspaceId:first.entry.namespaceId,changes:[{id:record.id,expectedRevision:null,record}]});
 const before=await storage.read(),id=randomUUID(),sourceRoot=storage.root,destinationRoot=path.join(target.root,first.entry.directory);
 await provider.close();detach();const {spawn}=await import('node:child_process');let child,ended;
 const script=`import {WorkspaceDatabases} from './src/workspace-databases.js';import {installDatabaseProvider} from './src/workspace-database-context.js';import {Workspace} from './src/storage.js';import {ProjectStorage} from './src/project-storage.js';import {ProjectRegistry} from './src/project-registry.js';import {LabBookReparents} from './src/lab-book-reparent.js';let raw='';for await(const chunk of process.stdin)raw+=chunk;const input=JSON.parse(raw),key=value=>({id:value.id,key:Buffer.from(value.key,'base64')}),provider=new WorkspaceDatabases({...input.options,env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}});installDatabaseProvider(provider);const registry=new ProjectRegistry(new Workspace(input.workspace.root,key(input.workspace.vault)),input.workspace.id),project=value=>new ProjectStorage(value.root,value.id,key(value.vault));await new LabBookReparents(registry,input.labBookId).run(project(input.source),project(input.target),key(input.vault),{id:input.id,checkpoint:async stage=>{if(stage==='renamed'){process.stdout.write('renamed');await new Promise(()=>{});}}});`;
 try{
  child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),windowsHide:true,stdio:['pipe','pipe','pipe']});ended=new Promise(resolve=>child.once('exit',resolve));let errors='';child.stderr.on('data',bytes=>errors+=bytes);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Move checkpoint timeout: '+errors)),90000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Move exited early: '+errors));});child.stdout.once('data',()=>{clearTimeout(timer);resolve();});const key=vault=>({id:vault.id,key:vault.key.toString('base64')}),parent=storage=>({id:storage.projectId,root:storage.root,vault:key(storage.vault)});child.stdin.end(JSON.stringify({options:{directory:options.directory,ownerId:options.ownerId},workspace:{root,id:initial.id,vault:key(workspace.vault)},source:parent(source),target:parent(target),labBookId:storage.labBookId,vault:key(storage.vault),id}));});
 }finally{if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await ended;}provider=new WorkspaceDatabases({...options,env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}});detach=installDatabaseProvider(provider);}
 await assert.rejects(stat(sourceRoot),{code:'ENOENT'});const located=await stat(destinationRoot);
 const result=await new LabBookReparents(registry,storage.labBookId).run(source,target,storage.vault,{id});assert.equal(result.book.root,destinationRoot);assert.equal((await stat(destinationRoot)).ino,located.ino);
 const reopened=new LabBookStorage(destinationRoot,storage.labBookId,storage.vault),after=await reopened.read();assert.equal(after.book.id,before.book.id);assert.deepEqual(after.book.entries,before.book.entries);assert.equal(after.book.notebooks[0].projectId,target.projectId);
 // Reopen both parent owners after the killed process, then drain their adopted runtimes.
 assert.equal((await source.outline()).metadata.projects[0].id,source.projectId);assert.equal((await target.outline()).metadata.projects[0].id,target.projectId);
});

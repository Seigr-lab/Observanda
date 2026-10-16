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

test('nested book moves recover every handoff boundary and retain later writes without recopying frozen sources',{timeout:360000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-book-move-')),options={directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}},vaults=[];let provider=new WorkspaceDatabases(options),detach=installDatabaseProvider(provider);
 t.after(async()=>{await provider.close();detach();vaults.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-book-move-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const device=new TestDeviceStore({file:path.join(directory,'device.key')}),access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);vaults.push(vault);
 const metadata=createNotebook('Field Project Å 1'),projectId=randomUUID();metadata.projects=[{id:projectId,title:metadata.title,parentId:null,description:'',share:false,logoId:null}];
 let project=await initializeProjectLocation(path.join(directory,metadata.title),projectId,metadata,access,vault);
 const root=path.join(directory,'Workspace 1'),workspaceMetadata=createNotebook('Workspace 1');await initializeLocation(root,workspaceMetadata,access,vault);const workspace=new Workspace(root,vault),registry=new ProjectRegistry(workspace,workspaceMetadata.id);await registry.attach(project,{expected:'new'});
 const books=[];
 for(const title of ['Observations Å 1','Measurements 2']){
  const created=await new LabBookCreation(project,device).create({id:randomUUID(),username:'',password:'Book move password',book:{id:randomUUID(),projectId,title}}),key=await verifyAccess(await readAccess(created.book.root),'','Book move password',{deviceStore:device});vaults.push(key);
  const storage=new LabBookStorage(created.book.root,created.book.labBookId,key),outline=await storage.outline(),record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:storage.labBookId};
  await new ResearchRecords(storage,new MediaStore(storage)).save({workspaceId:outline.metadata.id,changes:[{id:record.id,expectedRevision:null,record}]});await storage.writeFile(path.join(storage.root,'.observanda/evidence.bin'),'Original evidence '+title);
  books.push({storage,key,directory:title,target:{workspaceId:outline.metadata.id,recordId:record.id,sectionId:null},before:await storage.read()});
 }
 const moves=new ProjectMoves(registry),withBook=(id,use)=>use(books.find(book=>book.storage.labBookId===id).storage);
 const destinationFor=async name=>{const parent=path.join(directory,name);await mkdir(parent);return path.join(parent,metadata.title);};
 const unauthenticated=await destinationFor('Unauthenticated');await assert.rejects(moves.run(projectId,vault,{id:randomUUID(),path:unauthenticated}),{code:'ACCESS_LOCKED'});assert.equal(await moves.status(projectId),null);await assert.rejects(stat(unauthenticated),{code:'ENOENT'});
 for(const stage of ['verified','frozen','book-stopped','renamed','removed','terminated']){
  const id=randomUUID(),source=project.root,destination=await destinationFor(stage);let reached=false;
  if(stage==='terminated'){
   await provider.close();detach();const {spawn}=await import('node:child_process');let child,exited;
   const script=`import {WorkspaceDatabases} from './src/workspace-databases.js';import {installDatabaseProvider} from './src/workspace-database-context.js';import {Workspace} from './src/storage.js';import {ProjectRegistry} from './src/project-registry.js';import {ProjectMoves} from './src/project-move.js';import {LabBookStorage} from './src/lab-book-storage.js';let raw='';for await(const chunk of process.stdin)raw+=chunk;const input=JSON.parse(raw),key=value=>({id:value.id,key:Buffer.from(value.key,'base64')}),vault=key(input.vault),provider=new WorkspaceDatabases({...input.options,env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}});installDatabaseProvider(provider);const registry=new ProjectRegistry(new Workspace(input.registry,vault),input.workspaceId),books=input.books.map(book=>new LabBookStorage(book.root,book.id,key(book.vault)));await new ProjectMoves(registry).run(input.projectId,vault,{id:input.id,path:input.destination,withBook:(id,use)=>use(books.find(book=>book.labBookId===id)),checkpoint:async stage=>{if(stage==='frozen'){process.stdout.write('frozen');await new Promise(()=>{});}}});`;
   try{
    child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),windowsHide:true,stdio:['pipe','pipe','pipe']});exited=new Promise(resolve=>child.once('exit',resolve));let errorText='';child.stderr.on('data',bytes=>errorText+=bytes);
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Move termination checkpoint timeout: '+errorText)),90000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Move exited early: '+errorText));});child.stdout.once('data',()=>{clearTimeout(timer);resolve();});const key=value=>({id:value.id,key:value.key.toString('base64')});child.stdin.end(JSON.stringify({options:{directory:options.directory,ownerId:options.ownerId},registry:workspace.root,workspaceId:workspaceMetadata.id,projectId,id,destination,vault:key(vault),books:books.map(book=>({id:book.storage.labBookId,root:book.storage.root,vault:key(book.key)}))}));});
   }finally{if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}provider=new WorkspaceDatabases(options);detach=installDatabaseProvider(provider);}
  }else{
   await assert.rejects(moves.run(projectId,vault,{id,path:destination,withBook,checkpoint:async point=>{if(point===stage&&!reached){reached=true;throw Error('Stopped '+stage);}}}),new RegExp('Stopped '+stage));assert.ok(reached);
  }
  if(stage==='verified'){
   const book=books[0],writing=new RecordWriting(book.storage),current=await writing.read(book.target);await writing.save({...book.target,expectedRevision:current.revision,value:{body:'Written before source freeze'}});book.before=await book.storage.read();
  }
  if(stage==='frozen'){
   assert.equal((await moveSource(source)).books.length,2);
   for(const book of books)await assert.rejects(book.storage.withLock(()=>{}),{code:'STORAGE_MOVED'});
   // Restart recovery must not need fresh child credentials to stop the old
   // databases; new destination edits still belong to their independent owner.
   await provider.close();detach();provider=new WorkspaceDatabases(options);detach=installDatabaseProvider(provider);
   const book=books[1],target=new LabBookStorage(path.join(destination,book.directory),book.storage.labBookId,book.key),writing=new RecordWriting(target),current=await writing.read(book.target);await writing.save({...book.target,expectedRevision:current.revision,value:{body:'Written at verified destination'}});book.before=await target.read();
  }
  if(['renamed','removed'].includes(stage)){await mkdir(source);await writeFile(path.join(source,'unrelated.txt'),'Keep reused source');}
  // The containing workspace remains writable throughout a project handoff.
  await workspace.withLock(()=>workspace.catalogue(store=>store.putObject('metadata:independent-command',{stage})));
  const result=await moves.run(projectId,vault,{id,resume:true,...(stage==='verified'?{withBook}:{}),checkpoint:point=>{if(stage!=='verified'&&point.startsWith('copy:'))assert.fail('Frozen source was recopied');}});assert.equal(result.phase,'complete');assert.equal((await registry.locate(projectId)).root,destination);
  project=new ProjectStorage(destination,projectId,vault);for(const book of books){book.storage=new LabBookStorage(path.join(destination,book.directory),book.storage.labBookId,book.key);assert.deepEqual(await book.storage.read(),book.before);assert.equal(await book.storage.readFile(path.join(book.storage.root,'.observanda/evidence.bin'),'utf8'),'Original evidence '+book.directory);assert.equal((await catalogueBinding(book.storage.root)).placement,'lab-book');}
  await assert.rejects(stat(path.join(destination,MOVE_BOOK_KEYS_FILE)),{code:'ENOENT'});await assert.rejects(stat(path.join(path.dirname(source),'.observanda-project-move-'+id)),{code:'ENOENT'});
  if(['renamed','removed'].includes(stage))assert.equal(await readFile(path.join(source,'unrelated.txt'),'utf8'),'Keep reused source');else await assert.rejects(stat(source),{code:'ENOENT'});
  assert.deepEqual(await moves.run(projectId,vault,{id,resume:true}),result);
 }
});

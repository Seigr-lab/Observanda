import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,rmdir,rename,access,stat,writeFile,readFile,unlink} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {initializeLocation} from '../src/locations.js';
import {createNotebook} from '../src/model.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectImports} from '../src/project-import.js';
import {ProjectBookOwners} from '../src/project-book-owners.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookImports} from '../src/lab-book-import.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {copyLabBookLocation} from '../src/lab-book-transfer.js';
import {ImportDiscard} from '../src/import-discard.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault,verifyAccess,readAccess} from '../src/access.js';
import {TestDeviceStore} from './device-fixture.js';
import {clearVault} from '../src/encryption.js';
import {assertProjectImportsSettled} from '../src/project-import-state.js';

test('cancelling unpublished imports preserves sources and recovers only the pinned destination',{timeout:480000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-import-cancel-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),keys=[];
 t.after(async()=>{await provider.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-import-cancel-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const device=new TestDeviceStore({file:path.join(directory,'device')}),password='Independent import password';
 async function grant(){const access=await createWorkspaceAccess('',password,device),vault=takeCreatedVault(access);keys.push(vault);return {access,vault};}
 async function workspace(title){const g=await grant(),data=createNotebook(title),root=path.join(directory,title);await initializeLocation(root,data,g.access,g.vault);const storage=new Workspace(root,g.vault);return {storage,registry:new ProjectRegistry(storage,data.id)};}
 async function project(owner,title,parent=null){const g=await grant(),data=createNotebook(title),id=randomUUID();data.projects=[{id,title,parentId:null,description:'Independent project',share:false,logoId:null}];const storage=await initializeProjectLocation(path.join(parent?.root??owner.storage.root,title),id,data,g.access,g.vault);await owner.registry.attach(storage,{parentId:parent?.projectId??null,expected:(await owner.registry.read()).revision});return storage;}
 async function book(parent,title){const result=await new LabBookCreation(parent,device).create({id:randomUUID(),username:'',password,book:{id:randomUUID(),projectId:parent.projectId,title}}),vault=await verifyAccess(await readAccess(result.book.root),'',password,{deviceStore:device});keys.push(vault);return new LabBookStorage(result.book.root,result.book.labBookId,vault);}
 const source=await workspace('Original Workspace'),target=await workspace('Receiver Workspace'),root=await project(source,'Research Project'),child=await project(source,'Child Project',root),notes=await book(child,'Independent Notes'),parent=await project(target,'Containing Project');
 await notes.writeFile(path.join(notes.root,'.observanda/evidence.bin'),'Retained evidence');
 const original=await notes.read(),imports=new ProjectImports(target.registry,device),id=randomUUID(),base={id,username:'',password,recovery:'',owners:[child,notes].map(owner=>({relative:path.relative(root.root,owner.root).split(path.sep).join('/'),username:'',password,recovery:''}))},request={...base,path:root.root,parentId:parent.projectId};
 const stop=stage=>({checkpoint:point=>{if(point===stage)throw Error('Interrupted '+stage);}});
 await assert.rejects(imports.run(request,stop('copied')),/Interrupted copied/);
 const value=await imports.read(id),destination=value.destination;assert.equal(value.phase,'copied');await assert.rejects(new LabBookStorage(path.join(destination,'Child Project','Independent Notes'),notes.labBookId,notes.vault).outline(),{code:'STORAGE_INCOMPLETE'});await assert.rejects(assertProjectImportsSettled(target.registry,[parent.projectId]),{code:'STORAGE_PROJECT_BUSY'});
 await assert.rejects(imports.cancel({...base,password:'Wrong password'}),{code:'PROJECT_IMPORT_ACCESS'});assert.equal((await imports.read(id)).phase,'copied');
 const unrelated=path.join(destination,'unrelated.txt');await writeFile(unrelated,'User file');await assert.rejects(imports.cancel(base),{code:'STORAGE_DELETE_CONTENTS'});assert.equal(await readFile(unrelated,'utf8'),'User file');await unlink(unrelated);
 await assert.rejects(imports.run(base,{resume:true}),{code:'STORAGE_INCOMPLETE'});
 const replaced=path.join(parent.root,'Held destination');await rename(destination,replaced);await mkdir(destination);await writeFile(unrelated,'Replacement');await assert.rejects(imports.cancel(base),{code:'STORAGE_DELETE_STATE'});assert.equal(await readFile(unrelated,'utf8'),'Replacement');await unlink(unrelated);await rmdir(destination);await rename(replaced,destination);
 const missing=path.join(source.storage.root,'Unavailable source');await provider.closeLabBook(notes.root);await provider.closeProject(child.root);await provider.closeProject(root.root);await rename(root.root,missing);
 await assert.rejects(imports.cancel(base),{code:'ENOENT'});await access(destination);await rename(missing,root.root);
 let recovery=base;
 for(const stage of ['cancel-prepared','cancel-frozen','cancel-database','cancel-retired','cancel-file','cancel-files','cancel-removed','cancelled']){
  await assert.rejects(imports.cancel(recovery,stop(stage)),new RegExp('Interrupted '+stage));
  if(stage==='cancel-frozen'){await rename(root.root,missing);recovery={...base,password:'',owners:[]};}
  if(stage==='cancel-retired'){await mkdir(destination);await writeFile(unrelated,'Reused after retirement');}
  t.diagnostic('Cancellation recovered through '+stage);
 }
 assert.equal((await imports.cancel(recovery)).cancelled,true);assert.equal((await imports.run(recovery,{resume:true})).cancelled,true);assert.deepEqual((await imports.pending()).items,[]);await assertProjectImportsSettled(target.registry,[parent.projectId]);assert.equal(await readFile(unrelated,'utf8'),'Reused after retirement');
 const receipt=await new ImportDiscard(target.storage,id).pending();assert.equal(receipt.phase,'complete');assert.ok(receipt.owners.every(entry=>!Object.hasOwn(entry,'key')));await rename(missing,root.root);assert.deepEqual(await notes.read(),original);assert.equal(await notes.readFile(path.join(notes.root,'.observanda/evidence.bin'),'utf8'),'Retained evidence');
 // Cancelling a book import shares the same guarded cleanup and frees its slot.
 const books=new LabBookImports(parent,target.registry,device),bookRequest={id:randomUUID(),path:notes.root,username:'',password,recovery:''},bookCancel={id:bookRequest.id,username:'',password,recovery:''};
 await assert.rejects(books.run(bookRequest,stop('copied')),/Interrupted copied/);await assert.rejects(books.cancel({...bookCancel,password:'Wrong'}),{code:'LAB_BOOK_IMPORT_ACCESS'});
 await assert.rejects(books.cancel(bookCancel,stop('cancel-frozen')),/Interrupted cancel-frozen/);assert.equal((await books.cancel({...bookCancel,password:''})).cancelled,true);await new ProjectBookOwners(parent).ready();assert.deepEqual((await books.pending()).items,[]);await assert.rejects(access(path.join(parent.root,'Independent Notes')),{code:'ENOENT'});assert.deepEqual(await notes.read(),original);
 // An owner already in its correct containing folder must never be removed.
 const nested=path.join(parent.root,'Independent Notes');await copyLabBookLocation(notes,nested,{id:randomUUID(),portable:true});const before=await stat(nested),inPlace={...bookRequest,id:randomUUID(),path:nested};await assert.rejects(books.run(inPlace,stop('prepared')),/Interrupted prepared/);assert.equal((await books.cancel({...bookCancel,id:inPlace.id,password:''})).cancelled,true);assert.equal((await stat(nested)).ino,before.ino);await new ProjectBookOwners(parent).ready();await assert.rejects(new LabBookRegistry(parent).locate(notes.labBookId),{code:'NOT_FOUND'});
 // Empty destinations reserved before copying can also be discarded.
 const emptyTarget=await workspace('Empty Receiver'),emptyImports=new ProjectImports(emptyTarget.registry,device),empty={...request,id:randomUUID(),parentId:null};await assert.rejects(emptyImports.run(empty,stop('prepared')),/Interrupted prepared/);assert.equal((await emptyImports.cancel({...base,id:empty.id})).cancelled,true);await assert.rejects(access(path.join(emptyTarget.storage.root,'Research Project')),{code:'ENOENT'});
 // A killed cleanup process releases its lease; a new command completes the
 // retired tree without touching a subsequently reused destination.
 const killed={...empty,id:randomUUID()};await assert.rejects(emptyImports.run(killed,stop('prepared')),/Interrupted prepared/);await assert.rejects(emptyImports.cancel({...base,id:killed.id},stop('cancel-frozen')),/Interrupted cancel-frozen/);
 const {spawn}=await import('node:child_process'),script=`import {Workspace} from './src/storage.js';import {ImportDiscard} from './src/import-discard.js';import {WorkspaceDatabases} from './src/workspace-databases.js';import {installDatabaseProvider} from './src/workspace-database-context.js';let raw='';for await(const chunk of process.stdin)raw+=chunk;const data=JSON.parse(raw),vault={id:data.vault.id,key:Buffer.from(data.vault.key,'base64')},provider=new WorkspaceDatabases({directory:data.runtime,ownerId:data.ownerId,env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}});installDatabaseProvider(provider);await new ImportDiscard(new Workspace(data.root,vault),data.value.id).run(data.value,new Map(),{checkpoint:async point=>{if(point==='cancel-retired'){process.stdout.write('retired');await new Promise(()=>{});}}});`;
 const awaitedValue=await emptyImports.read(killed.id);let processChild,exited;try{
  processChild=spawn(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),windowsHide:true,stdio:['pipe','pipe','pipe']});exited=new Promise(resolve=>processChild.once('exit',resolve));let errors='';processChild.stderr.on('data',bytes=>errors+=bytes);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Cleanup checkpoint timeout: '+errors)),30000);processChild.once('error',error=>{clearTimeout(timer);reject(error);});processChild.once('exit',()=>{clearTimeout(timer);reject(Error('Cleanup exited early: '+errors));});processChild.stdout.once('data',()=>{clearTimeout(timer);resolve();});processChild.stdin.end(JSON.stringify({root:emptyTarget.storage.root,vault:{id:emptyTarget.storage.vault.id,key:emptyTarget.storage.vault.key.toString('base64')},value:awaitedValue,runtime:path.join(directory,'child-runtime'),ownerId:randomUUID()}));});
 }finally{if(processChild&&processChild.exitCode===null&&processChild.signalCode===null){processChild.kill('SIGKILL');await exited;}}
 assert.equal((await emptyImports.cancel({...base,id:killed.id,password:'',owners:[]})).cancelled,true);await assertProjectImportsSettled(emptyTarget.registry,[null]);

 // In-place project adoption also cancels without renaming or deleting data.
 for(const owner of [notes])await provider.closeLabBook(owner.root);for(const owner of [child,root])await provider.closeProject(owner.root);
 const inPlaceProject=path.join(emptyTarget.storage.root,path.basename(root.root));await rename(root.root,inPlaceProject);const inode=await stat(inPlaceProject),inPlaceProjectRequest={...empty,id:randomUUID(),path:inPlaceProject};await assert.rejects(emptyImports.run(inPlaceProjectRequest,stop('prepared')),/Interrupted prepared/);
 assert.equal((await emptyImports.cancel({...base,id:inPlaceProjectRequest.id,password:'',owners:[]})).cancelled,true);assert.equal((await stat(inPlaceProject)).ino,inode.ino);await access(path.join(inPlaceProject,'Child Project','Independent Notes','.observanda/evidence.bin'));await assertProjectImportsSettled(emptyTarget.registry,[null]);

});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectCreation} from '../src/project-creation.js';
import {ProjectStorage} from '../src/project-storage.js';
import {ProjectRenames} from '../src/project-rename.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {LabBookRenames} from '../src/lab-book-rename.js';
import {ConfigurationCommands} from '../src/configuration-commands.js';
import {readAccess,verifyAccess} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {startServer} from '../src/server.js';
const schema=id=>({profiles:[],sections:[{id,profileId:null,key:'conditions',label:'Conditions',description:'Retained schema',enabled:true,fields:[{key:'condition',label:'Condition',type:'select',unit:'',required:false,choices:['First','Last']}]}]});
async function client(app){
 const opened=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});assert.equal(opened.status,200);
 const cookie=opened.headers.get('set-cookie').split(';')[0];let context;
 const call=async(route,data)=>{const response=await fetch(app.origin+route,{signal:AbortSignal.timeout(120000),method:data===undefined?'GET':'POST',headers:{Origin:app.origin,Cookie:cookie,'Content-Type':'application/json','X-Observanda-Wait':'1',...(context?{'X-Observanda-Workspace':context}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:response.status,value:await response.json()};};
 context=(await call('/api/storage')).value.contextId;return call;
}
async function checkpoint(storage,owner,sectionId,label){
 const commands=new ConfigurationCommands(storage),opened=await commands.open(owner),changed=await commands.change({...owner,configurationPin:opened.configurationPin,draftId:null,expectedRevision:null,commandId:randomUUID(),operations:[{type:'replace',collection:'choices',sectionId,fieldKey:'condition',key:'Last',value:label}]});
 return {pin:opened.configurationPin,draft:{id:changed.draft.id,revision:changed.draft.revision}};
}
async function choice(storage,owner,pin,sectionId){return (await new ConfigurationCommands(storage).window({...owner,configurationPin:pin,collection:'choices',sectionId,fieldKey:'condition',offset:1,limit:1})).rows[0].value;}

test('combined configuration Save and physical owner rename recover a lost reply with exact request replay',{timeout:180000},async t=>{
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-configuration-rename-')),databases=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(databases),f=await encryptedFixture(directory,sampleNotebook()),vaults=[f.vault];let app;
 const bookRun=LabBookRenames.prototype.run,projectRun=ProjectRenames.prototype.run;
 t.after(async()=>{LabBookRenames.prototype.run=bookRun;ProjectRenames.prototype.run=projectRun;await app?.close();await databases.close();detach();vaults.forEach(clearVault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-configuration-rename-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const registry=new ProjectRegistry(f.workspace,(await f.workspace.outline()).metadata.id),projectId=randomUUID(),projectSection=randomUUID(),bookSection=randomUUID();
 const created=await new ProjectCreation(registry,f.deviceStore).create({id:randomUUID(),username:'',password:'',project:{id:projectId,title:'Schema Project',parentId:null,description:'',share:false,logoId:null,labBookTemplate:{name:'Project schema',configuration:schema(projectSection)}}});
 const projectKey=await verifyAccess(await readAccess(created.project.root),'','',{deviceStore:f.deviceStore});vaults.push(projectKey);let project=new ProjectStorage(created.project.root,projectId,projectKey);
 const bookCreated=await new LabBookCreation(project,f.deviceStore).create({id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId,title:'Schema Book',configuration:schema(bookSection)}}),bookKey=await verifyAccess(await readAccess(bookCreated.book.root),'','',{deviceStore:f.deviceStore});vaults.push(bookKey);let book=new LabBookStorage(bookCreated.book.root,bookCreated.book.labBookId,bookKey);
 const beforeBook=await book.outline(),bookOwner={workspaceId:beforeBook.metadata.id,projectId,notebookId:book.labBookId,slot:'configuration'},bookDraft=await checkpoint(book,bookOwner,bookSection,'Saved book choice');
 const bookRequest={id:randomUUID(),etag:beforeBook.etag,book:{...beforeBook.metadata.notebooks[0],title:'Renamed Schema Book'},configurationPin:bookDraft.pin,configurationDraft:bookDraft.draft},oldBookRoot=book.root,bookInode=(await stat(path.join(book.root,'.observanda/postgresql/data/PG_VERSION'))).ino;
 app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});let call=await client(app);
 const bookRoute='/api/projects/'+projectId+'/lab-books/'+book.labBookId+'/settings/save';let bookReplyLost=false;
 LabBookRenames.prototype.run=function(storage,options){return bookRun.call(this,storage,{...options,checkpoint:async stage=>{if(stage==='complete'&&!bookReplyLost){bookReplyLost=true;throw Error('Lost completed book reply');}}});};
 const lostBook=await call(bookRoute,bookRequest);assert.notEqual(lostBook.status,200,JSON.stringify(lostBook));assert.equal(bookReplyLost,true);LabBookRenames.prototype.run=bookRun;
 const movedBook=await new LabBookRegistry(project).locate(book.labBookId);book=new LabBookStorage(movedBook.root,book.labBookId,bookKey);assert.equal(path.basename(book.root),bookRequest.book.title);await assert.rejects(access(oldBookRoot),{code:'ENOENT'});assert.equal((await stat(path.join(book.root,'.observanda/postgresql/data/PG_VERSION'))).ino,bookInode);
 await assert.rejects(book.outline(),{code:'STORAGE_RENAMING'});const bookReplay=await call(bookRoute,bookRequest);assert.equal(bookReplay.status,200,JSON.stringify(bookReplay));
 const admittedBook=await book.outline();assert.equal(admittedBook.metadata.notebooks[0].configuration.format,'observanda-configuration');assert.equal(await choice(book,bookOwner,null,bookSection),'Saved book choice');assert.equal(await choice(book,bookOwner,bookDraft.pin,bookSection),'Last');assert.equal((await new ConfigurationCommands(book).open(bookOwner)).draft,null);
 assert.equal((await call(bookRoute,bookRequest)).status,200);assert.equal((await book.outline()).etag,admittedBook.etag);
 const changedBook=await call(bookRoute,{...bookRequest,etag:'0'.repeat(64)});assert.equal(changedBook.value.code,'CONFLICT',JSON.stringify(changedBook));assert.equal((await book.outline()).etag,admittedBook.etag);
 const beforeProject=await project.outline(),projectOwner={workspaceId:beforeProject.metadata.id,projectId,notebookId:null,slot:'labBookTemplate'},projectDraft=await checkpoint(project,projectOwner,projectSection,'Saved project choice'),projectRequest={id:randomUUID(),etag:beforeProject.etag,project:{...beforeProject.metadata.projects[0],title:'Renamed Schema Project'},configurationPin:projectDraft.pin,configurationDraft:projectDraft.draft},oldProjectRoot=project.root,projectInode=(await stat(path.join(project.root,'.observanda/postgresql/data/PG_VERSION'))).ino;
 const projectRoute='/api/projects/'+projectId+'/settings/save';let projectReplyLost=false;
 ProjectRenames.prototype.run=function(storage,options){return projectRun.call(this,storage,{...options,checkpoint:async stage=>{if(stage==='complete'&&!projectReplyLost){projectReplyLost=true;throw Error('Lost completed project reply');}}});};
 const lostProject=await call(projectRoute,projectRequest);assert.notEqual(lostProject.status,200,JSON.stringify(lostProject));assert.equal(projectReplyLost,true);ProjectRenames.prototype.run=projectRun;
 const movedProject=await registry.locate(projectId);project=new ProjectStorage(movedProject.root,projectId,projectKey);assert.equal(path.basename(project.root),projectRequest.project.title);await assert.rejects(access(oldProjectRoot),{code:'ENOENT'});assert.equal((await stat(path.join(project.root,'.observanda/postgresql/data/PG_VERSION'))).ino,projectInode);
 // Recover the durable completion through a fresh service/session before reading the fenced owner.
 await assert.rejects(project.outline(),{code:'STORAGE_RENAMING'});await app.close();app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});call=await client(app);
 const projectReplay=await call(projectRoute,projectRequest);assert.equal(projectReplay.status,200,JSON.stringify(projectReplay));
 const admittedProject=await project.outline();assert.equal(admittedProject.metadata.projects[0].labBookTemplate.configuration.format,'observanda-configuration');assert.equal(await choice(project,projectOwner,null,projectSection),'Saved project choice');assert.equal(await choice(project,projectOwner,projectDraft.pin,projectSection),'Last');assert.equal((await new ConfigurationCommands(project).open(projectOwner)).draft,null);
 assert.equal((await call(projectRoute,projectRequest)).status,200);assert.equal((await project.outline()).etag,admittedProject.etag);
 const changedProject=await call(projectRoute,{...projectRequest,project:{...projectRequest.project,description:'Different retry'}});assert.equal(changedProject.value.code,'CONFLICT',JSON.stringify(changedProject));assert.equal((await project.outline()).etag,admittedProject.etag);
 const child=await new LabBookRegistry(project).locate(book.labBookId);assert.equal(path.dirname(child.root),project.root);book=new LabBookStorage(child.root,book.labBookId,bookKey);assert.equal((await stat(path.join(book.root,'.observanda/postgresql/data/PG_VERSION'))).ino,bookInode);assert.equal(await choice(book,bookOwner,null,bookSection),'Saved book choice');assert.equal((await book.outline()).etag,admittedBook.etag);
});

test('pin-only settings preserve saved schemas and pending drafts through header Save and physical rename',{timeout:180000},async t=>{
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-configuration-pin-settings-')),databases=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(databases),f=await encryptedFixture(directory,sampleNotebook()),vaults=[f.vault];let app;
 t.after(async()=>{await app?.close();await databases.close();detach();vaults.forEach(clearVault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-configuration-pin-settings-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const registry=new ProjectRegistry(f.workspace,(await f.workspace.outline()).metadata.id),projectId=randomUUID(),projectSection=randomUUID(),bookSection=randomUUID();
 const created=await new ProjectCreation(registry,f.deviceStore).create({id:randomUUID(),username:'',password:'',project:{id:projectId,title:'Pinned Project',parentId:null,description:'',share:false,logoId:null,labBookTemplate:{name:'Original template',configuration:schema(projectSection)}}}),projectKey=await verifyAccess(await readAccess(created.project.root),'','',{deviceStore:f.deviceStore});vaults.push(projectKey);let project=new ProjectStorage(created.project.root,projectId,projectKey);
 const createdBook=await new LabBookCreation(project,f.deviceStore).create({id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId,title:'Pinned Book'}}),bookKey=await verifyAccess(await readAccess(createdBook.book.root),'','',{deviceStore:f.deviceStore});vaults.push(bookKey);let book=new LabBookStorage(createdBook.book.root,createdBook.book.labBookId,bookKey);
 const projectOwner={workspaceId:(await project.outline()).metadata.id,projectId,notebookId:null,slot:'labBookTemplate'},bookOwner={workspaceId:(await book.outline()).metadata.id,projectId,notebookId:book.labBookId,slot:'configuration'},projectRoute='/api/projects/'+projectId+'/settings/save',bookRoute='/api/projects/'+projectId+'/lab-books/'+book.labBookId+'/settings/save';
 app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});const call=await client(app);let previousPins=null;
 for(const phase of [0,1]){
  const beforeProject=await project.outline(),beforeBook=await book.outline(),projectSaved=structuredClone(beforeProject.metadata.projects[0].labBookTemplate),bookSaved=beforeBook.metadata.notebooks[0].configuration,projectCommands=new ConfigurationCommands(project),bookCommands=new ConfigurationCommands(book),projectPin=(await projectCommands.open({...projectOwner,saved:true})).configurationPin,bookPin=(await bookCommands.open({...bookOwner,saved:true})).configurationPin;
  if(phase===0){assert.equal(Object.hasOwn(beforeBook.metadata.notebooks[0],'configuration'),false);assert.equal(projectSaved.configuration.format,undefined);}else{assert.equal(bookSaved.format,'observanda-configuration');assert.equal(projectSaved.configuration.format,'observanda-configuration');}
  const projectDraft=await projectCommands.change({...projectOwner,configurationPin:projectPin,draftId:null,expectedRevision:null,commandId:randomUUID(),operations:[{type:'replace',collection:'choices',sectionId:projectSection,fieldKey:'condition',key:phase?'Project draft 0':'Last',value:'Project draft '+phase}]}),bookDraft=await bookCommands.change({...bookOwner,configurationPin:bookPin,draftId:null,expectedRevision:null,commandId:randomUUID(),operations:phase?[{type:'replace',collection:'choices',sectionId:bookSection,fieldKey:'condition',key:'Last',value:'Book draft 1'}]:[{type:'append',collection:'sections',value:schema(bookSection).sections[0]}]});
  const projectHeader={...beforeProject.metadata.projects[0],description:'Header only '+phase};delete projectHeader.labBookTemplate;
  const bookHeader={id:book.labBookId,projectId,title:beforeBook.metadata.notebooks[0].title};
  const projectCommand={id:randomUUID(),etag:beforeProject.etag,project:projectHeader,configurationDraft:null,configurationPin:projectPin},bookCommand={id:randomUUID(),etag:beforeBook.etag,book:bookHeader,configurationDraft:null,configurationPin:bookPin};
  for(const [route,command,foreign] of [[projectRoute,projectCommand,{...projectPin,workspaceId:bookOwner.workspaceId}],[bookRoute,bookCommand,{...bookPin,workspaceId:projectOwner.workspaceId}]]){
   const missing=await call(route,{...command,id:randomUUID(),configurationPin:null});assert.equal(missing.value.code,'INVALID',JSON.stringify(missing));
   const wrong=await call(route,{...command,id:randomUUID(),configurationPin:foreign});assert.ok(['INVALID','WORKSPACE_CHANGED'].includes(wrong.value.code),JSON.stringify(wrong));
  }
  if(previousPins){
   const staleProject=await call(projectRoute,{...projectCommand,id:randomUUID(),configurationPin:previousPins.project});assert.equal(staleProject.value.code,'CONFLICT',JSON.stringify(staleProject));
   const staleBook=await call(bookRoute,{...bookCommand,id:randomUUID(),configurationPin:previousPins.book});assert.equal(staleBook.value.code,'CONFLICT',JSON.stringify(staleBook));
  }
  const savedProject=await call(projectRoute,projectCommand),savedBook=await call(bookRoute,bookCommand);assert.equal(savedProject.status,200,JSON.stringify(savedProject));assert.equal(savedBook.status,200,JSON.stringify(savedBook));
  assert.equal((await call(projectRoute,projectCommand)).value.etag,savedProject.value.etag);assert.equal((await call(bookRoute,bookCommand)).value.etag,savedBook.value.etag);
  assert.equal((await call(projectRoute,{...projectCommand,project:{...projectHeader,description:'Changed replay'}})).value.code,'CONFLICT');assert.equal((await call(bookRoute,{...bookCommand,etag:'0'.repeat(64)})).value.code,'CONFLICT');
  assert.deepEqual((await project.outline()).metadata.projects[0].labBookTemplate,projectSaved);assert.deepEqual((await book.outline()).metadata.notebooks[0].configuration,bookSaved);assert.equal((await projectCommands.open(projectOwner)).draft.revision,projectDraft.draft.revision);assert.equal((await bookCommands.open(bookOwner)).draft.revision,bookDraft.draft.revision);
  const oldBookRoot=book.root,renameBook={...bookCommand,id:randomUUID(),etag:(await book.outline()).etag,book:{...bookHeader,title:'Pinned Book '+phase}},renamedBook=await call(bookRoute,renameBook);assert.equal(renamedBook.status,200,JSON.stringify(renamedBook));
  const bookEntry=await new LabBookRegistry(project).locate(book.labBookId);book=new LabBookStorage(bookEntry.root,book.labBookId,bookKey);await assert.rejects(access(oldBookRoot),{code:'ENOENT'});assert.equal((await call(bookRoute,renameBook)).value.etag,renamedBook.value.etag);assert.equal((await call(bookRoute,{...renameBook,configurationPin:{...bookPin,revision:'0'.repeat(64)}})).value.code,'CONFLICT');
  const bookReceipt=await new LabBookRenames(project).read(renameBook.id);assert.equal(Object.hasOwn(bookReceipt.settings,'checkpoint'),false);assert.equal(Object.hasOwn(bookReceipt.settings,'configuration'),phase===1);
  const oldProjectRoot=project.root,renameProject={...projectCommand,id:randomUUID(),etag:(await project.outline()).etag,project:{...projectHeader,title:'Pinned Project '+phase}},renamedProject=await call(projectRoute,renameProject);assert.equal(renamedProject.status,200,JSON.stringify(renamedProject));
  const projectEntry=await registry.locate(projectId);project=new ProjectStorage(projectEntry.root,projectId,projectKey);await assert.rejects(access(oldProjectRoot),{code:'ENOENT'});assert.equal((await call(projectRoute,renameProject)).value.etag,renamedProject.value.etag);assert.equal((await call(projectRoute,{...renameProject,project:{...renameProject.project,description:'Changed rename replay'}})).value.code,'CONFLICT');
  const projectReceipt=await new ProjectRenames(registry,projectId).read();assert.equal(Object.hasOwn(projectReceipt.settings,'checkpoint'),false);
  const child=await new LabBookRegistry(project).locate(book.labBookId);book=new LabBookStorage(child.root,book.labBookId,bookKey);assert.deepEqual((await project.outline()).metadata.projects[0].labBookTemplate,projectSaved);assert.deepEqual((await book.outline()).metadata.notebooks[0].configuration,bookSaved);if(!phase)assert.equal(Object.hasOwn((await book.outline()).metadata.notebooks[0],'configuration'),false);
  const reopenedProject=new ConfigurationCommands(project),reopenedBook=new ConfigurationCommands(book);assert.equal((await reopenedProject.open(projectOwner)).draft.revision,projectDraft.draft.revision);assert.equal((await reopenedBook.open(bookOwner)).draft.revision,bookDraft.draft.revision);
  if(!phase){
   await reopenedProject.save({...projectOwner,configurationPin:projectPin,draftId:projectDraft.draft.id,expectedRevision:projectDraft.draft.revision,commandId:randomUUID()});
   await reopenedBook.save({...bookOwner,configurationPin:bookPin,draftId:bookDraft.draft.id,expectedRevision:bookDraft.draft.revision,commandId:randomUUID()});
   previousPins={project:projectPin,book:bookPin};
  }
 }
});

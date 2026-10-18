import {LabBookLocationAccess} from '../src/lab-book-location-access.js';
import {ProjectSessionOwner} from '../src/project-session-owner.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {Workspace} from '../src/storage.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {createNotebook} from '../src/model.js';
import {sampleNotebook} from '../src/sample.js';
import {initializeProjectLocation,ProjectStorage} from '../src/project-storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectApplication,projectRequest} from '../src/project-application.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {ResearchRecords} from '../src/research.js';
import {MediaStore} from '../src/media.js';
import {withWorkspaceMoveSession} from '../src/workspace-move-session.js';

test('workspace move carries an external project tree and protected book through activation and retires the source',{timeout:180000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-workspace-book-move-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),vaults=[],applications=[];
 t.after(async()=>{for(const app of applications)await app.close();await provider.close();detach();vaults.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-workspace-book-move-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const f=await encryptedFixture(path.join(directory,'workspace'),createNotebook('Workspace 1'));vaults.push(f.vault);
 const parentMetadata=createNotebook('External Parent 1'),parentId=randomUUID();parentMetadata.projects=[{id:parentId,title:parentMetadata.title,parentId:null,description:'',share:false,logoId:null}];
 const parentAccess=await createWorkspaceAccess('','',f.deviceStore),parentVault=takeCreatedVault(parentAccess);vaults.push(parentVault);const parent=await initializeProjectLocation(path.join(directory,parentMetadata.title),parentId,parentMetadata,parentAccess,parentVault);
 const metadata=createNotebook('Field Project 1'),projectId=randomUUID();metadata.projects=[{id:projectId,title:metadata.title,parentId:null,description:'',share:false,logoId:null}];
 const access=await createWorkspaceAccess('','Project password',f.deviceStore),vault=takeCreatedVault(access);vaults.push(vault);
 const project=await initializeProjectLocation(path.join(parent.root,metadata.title),projectId,metadata,access,vault),registry=new ProjectRegistry(f.workspace,(await f.workspace.outline()).metadata.id);await registry.attach(parent,{expected:'new'});await registry.attach(project,{parentId,expected:(await registry.read()).revision});
 const siblingMetadata=sampleNotebook();siblingMetadata.title=siblingMetadata.projects[0].title='Unrelated Project';const siblingAccess=await createWorkspaceAccess('','',f.deviceStore),siblingVault=takeCreatedVault(siblingAccess);vaults.push(siblingVault);const sibling=await initializeProjectLocation(path.join(f.workspace.root,siblingMetadata.title),siblingMetadata.projects[0].id,siblingMetadata,siblingAccess,siblingVault);await registry.attach(sibling,{expected:(await registry.read()).revision});const siblingBefore=await sibling.read();
 const created=await new LabBookCreation(project,f.deviceStore).create({id:randomUUID(),username:'',password:'Book password',book:{id:randomUUID(),projectId,title:'Field book 1'}}),key=await verifyAccess(await readAccess(created.book.root),'','Book password',{deviceStore:f.deviceStore});vaults.push(key);
 const book=new LabBookStorage(created.book.root,created.book.labBookId,key),outline=await book.outline(),record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:book.labBookId};await new ResearchRecords(book,new MediaStore(book)).save({workspaceId:outline.metadata.id,changes:[{id:record.id,expectedRevision:null,record}]});
 const app=new ProjectApplication(f.workspace,{deviceStore:f.deviceStore}),client={},other={},destination=path.join(directory,'Moved Workspace');applications.push(app);await app.unlock(client,projectId,{password:'Project password'});
 const request=operation=>projectRequest('/api/projects/'+projectId+'/lab-books/'+book.labBookId+'/'+operation),target={workspaceId:outline.metadata.id,recordId:record.id,sectionId:null};
 await assert.rejects(withWorkspaceMoveSession(app,client,session=>session.move(destination,{activate:async()=>{assert.fail('Unauthorized workspace must not activate');}})),error=>['ACCESS_LOCKED','DEVICE_UNKNOWN'].includes(error.code)&&error.labBookId===book.labBookId);
 await app.run(client,request('access/unlock'),{username:'',password:'Book password',recovery:''});
 let interrupted=false;await assert.rejects(withWorkspaceMoveSession(app,client,session=>session.move(destination,{activate:async()=>{assert.fail('Interrupted move must not activate');}}),{checkpoint:async(phase,owner)=>{if(phase==='project:adopted'&&owner.projectId===projectId&&!interrupted){interrupted=true;throw Error('Interrupted after selected owner publication');}}}),/Interrupted after selected owner publication/);assert.equal(interrupted,true);
 const siblingEntry=await registry.locate(sibling.projectId);assert.deepEqual(await new ProjectStorage(siblingEntry.root,sibling.projectId,siblingVault).read(),siblingBefore);
 let cleaned=false;await assert.rejects(withWorkspaceMoveSession(app,client,session=>session.move(destination,{activate:async()=>{assert.fail('Interrupted cleanup must not activate');}}),{checkpoint:async phase=>{if(phase==='project-container'&&!cleaned){cleaned=true;throw Error('Interrupted after empty original retirement');}}}),/Interrupted after empty original retirement/);assert.equal(cleaned,true);await assert.rejects(stat(parent.root),{code:'ENOENT'});
 let copied;
 await withWorkspaceMoveSession(app,client,async session=>{const result=await session.move(destination,{activate:async()=>{copied=new ProjectApplication(new Workspace(destination,f.vault),{deviceStore:f.deviceStore});applications.push(copied);}});assert.equal(result.phase,'complete');await session.install(copied);});
 const writing=await copied.run(client,request('research/records/writing/read'),target);assert.equal(writing.value.body,record.body);
 await assert.rejects(copied.run(other,request('research/records/writing/read'),target),error=>['ACCESS_LOCKED','DEVICE_UNKNOWN'].includes(error.code));
 const saved=copied.session(client).get('book:'+projectId+':'+book.labBookId);const locations=await (await copied.registry()).read(),copiedParent=locations.value.projects.find(entry=>entry.projectId===parentId),copiedProject=locations.value.projects.find(entry=>entry.projectId===projectId);assert.equal(copiedParent.root,path.join(destination,parentMetadata.title));assert.equal(path.dirname(copiedProject.root),copiedParent.root);assert.equal(path.basename(copiedProject.root),metadata.title);assert.equal(saved.root,path.join(copiedProject.root,created.book.directory));assert.notEqual(saved.vault,key);assert.ok(saved.vault.key);
 await copied.run(client,request('research/records/writing/save'),{...target,expectedRevision:writing.revision,value:{body:'Only copied book changes'}});
 assert.equal((await copied.run(client,request('research/records/writing/read'),target)).value.body,'Only copied book changes');const movedSibling=locations.value.projects.find(entry=>entry.projectId===sibling.projectId);assert.equal(movedSibling.root,path.join(destination,siblingMetadata.title));assert.deepEqual(await new ProjectStorage(movedSibling.root,sibling.projectId,siblingVault).read(),siblingBefore);await assert.rejects(stat(f.workspace.root),{code:'ENOENT'});await assert.rejects(stat(created.book.root),{code:'ENOENT'});await assert.rejects(stat(parent.root),{code:'ENOENT'});
 const session=copied.session(client),grantId='book:'+projectId+':'+book.labBookId,originalGrant=session.get(grantId),selectedParent=new ProjectSessionOwner(copied,client,projectId),recovered=new LabBookLocationAccess(copied,client);
 try{
  await selectedParent.use(storage=>recovered.moved(storage,project.root,selectedParent));assert.equal(recovered.grants.get(grantId).root,saved.root);assert.equal(recovered.grants.get(grantId).expires,originalGrant.expires);
  for(const replacement of [null,{locked:true},{...originalGrant,expires:0},{...originalGrant,root:path.join(directory,'Unrelated book')}]){
   const omitted=new LabBookLocationAccess(copied,client);if(replacement===null)session.delete(grantId);else session.set(grantId,replacement);
   try{await selectedParent.use(storage=>omitted.moved(storage,project.root,selectedParent));assert.equal(omitted.grants.size,0);}finally{session.set(grantId,originalGrant);omitted.close();}
  }
 }finally{recovered.close();await selectedParent.close();}

});

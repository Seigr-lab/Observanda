import {workspaceDestinationFixture} from './workspace-destination-fixture.js';
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
import {ProjectMoves} from '../src/project-move.js';
import {workspaceCopyTransferId} from '../src/workspace-copy-directory.js';
import {ProjectBookOwners} from '../src/project-book-owners.js';
import {ProjectApplication,projectRequest} from '../src/project-application.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {ResearchRecords} from '../src/research.js';
import {MediaStore} from '../src/media.js';
import {readMoveReceipt} from '../src/workspace-move.js';
import {WORKSPACE_BUNDLE_MOVE} from '../src/workspace-project-move.js';
import {withWorkspaceMoveSession} from '../src/workspace-move-session.js';

test('workspace move carries an external project tree and protected book through activation and retires the source',{timeout:process.env.OBSERVANDA_TEST_SECOND_VOLUME?600000:420000},async t=>{
 const begun=performance.now();let lastPhase=begun;const phase=name=>{const now=performance.now();if(process.env.OBSERVANDA_TEST_SECOND_VOLUME)process.stdout.write(JSON.stringify({phase:name,elapsedMs:Math.round(now-begun),phaseMs:Math.round(now-lastPhase)})+'\n');lastPhase=now;};
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-workspace-book-move-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),vaults=[],applications=[];let placement;
 t.after(async()=>{for(const app of applications)await app.close();await provider.close();detach();vaults.forEach(clearVault);await placement?.cleanup();assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-workspace-book-move-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 placement=await workspaceDestinationFixture(directory);
 const f=await encryptedFixture(path.join(directory,'workspace'),createNotebook('Workspace 1'));vaults.push(f.vault);
 const parentMetadata=createNotebook('External Parent 1'),parentId=randomUUID();parentMetadata.projects=[{id:parentId,title:parentMetadata.title,parentId:null,description:'',share:false,logoId:null}];
 const parentAccess=await createWorkspaceAccess('','',f.deviceStore),parentVault=takeCreatedVault(parentAccess);vaults.push(parentVault);const parent=await initializeProjectLocation(path.join(directory,parentMetadata.title),parentId,parentMetadata,parentAccess,parentVault);
 const metadata=createNotebook('Field Project 1'),projectId=randomUUID();metadata.projects=[{id:projectId,title:metadata.title,parentId:null,description:'',share:false,logoId:null}];
 const access=await createWorkspaceAccess('','Project password',f.deviceStore),vault=takeCreatedVault(access);vaults.push(vault);
 const project=await initializeProjectLocation(path.join(parent.root,metadata.title),projectId,metadata,access,vault),registry=new ProjectRegistry(f.workspace,(await f.workspace.outline()).metadata.id);await registry.attach(parent,{expected:'new'});await registry.attach(project,{parentId,expected:(await registry.read()).revision});
 const siblingMetadata=sampleNotebook();siblingMetadata.title=siblingMetadata.projects[0].title='Unrelated Project';const siblingAccess=await createWorkspaceAccess('','',f.deviceStore),siblingVault=takeCreatedVault(siblingAccess);vaults.push(siblingVault);const sibling=await initializeProjectLocation(path.join(f.workspace.root,siblingMetadata.title),siblingMetadata.projects[0].id,siblingMetadata,siblingAccess,siblingVault);await registry.attach(sibling,{expected:(await registry.read()).revision});const siblingBefore=await sibling.read();
 const created=await new LabBookCreation(project,f.deviceStore).create({id:randomUUID(),username:'',password:'Book password',book:{id:randomUUID(),projectId,title:'Field book 1'}}),key=await verifyAccess(await readAccess(created.book.root),'','Book password',{deviceStore:f.deviceStore});vaults.push(key);
 const book=new LabBookStorage(created.book.root,created.book.labBookId,key),outline=await book.outline(),record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:book.labBookId};await new ResearchRecords(book,new MediaStore(book)).save({workspaceId:outline.metadata.id,changes:[{id:record.id,expectedRevision:null,record}]});
 phase('source owners ready');
 const oldPrepare=ProjectBookOwners.prototype.prepare;ProjectBookOwners.prototype.prepare=()=>{throw Error('New workspace moves must not collect book owners or keys');};t.after(()=>{ProjectBookOwners.prototype.prepare=oldPrepare;});
 const oldRead=ProjectRegistry.prototype.read,oldChange=ProjectRegistry.prototype.change;ProjectRegistry.prototype.read=ProjectRegistry.prototype.change=()=>{throw Error('Workspace move must use indexed directory reads');};t.after(()=>{ProjectRegistry.prototype.read=oldRead;ProjectRegistry.prototype.change=oldChange;});
 const app=new ProjectApplication(f.workspace,{deviceStore:f.deviceStore}),client={},other={},destination=path.join(placement.root,'Moved Workspace');applications.push(app);await app.unlock(client,projectId,{password:'Project password'});
 const request=operation=>projectRequest('/api/projects/'+projectId+'/lab-books/'+book.labBookId+'/'+operation),target={workspaceId:outline.metadata.id,recordId:record.id,sectionId:null};
 await assert.rejects(withWorkspaceMoveSession(app,client,session=>session.move(destination,{activate:async()=>{assert.fail('Unauthorized workspace must not activate');}})),error=>['ACCESS_LOCKED','DEVICE_UNKNOWN'].includes(error.code)&&error.labBookId===book.labBookId);
 phase('unauthorized refusal');
 await app.run(client,request('access/unlock'),{username:'',password:'Book password',recovery:''});
 // Resume an actual old per-project receipt inside the new bounded bundle.
 await assert.rejects(withWorkspaceMoveSession(app,client,session=>session.move(destination,{activate:async()=>assert.fail('Preparation must not activate')}),{checkpoint:stage=>{if(stage==='prepared')throw Error('Prepared workspace bundle');}}),/Prepared workspace bundle/);
 const initial=JSON.parse(await new Workspace(destination,f.vault).readFile(path.join(destination,WORKSPACE_BUNDLE_MOVE),'utf8')),moves=new ProjectMoves(registry);
 ProjectBookOwners.prototype.prepare=oldPrepare;
 try{await assert.rejects(moves.run(sibling.projectId,siblingVault,{id:workspaceCopyTransferId(initial.id,sibling.projectId),workspaceMoveId:initial.id,path:path.join(destination,siblingMetadata.title),checkpoint:stage=>{if(stage==='adopted')throw Error('Retained legacy owner');}}),/Retained legacy owner/);}finally{ProjectBookOwners.prototype.prepare=()=>{throw Error('New workspace moves must not collect book owners or keys');};}
 assert.equal((await moves.read(sibling.projectId)).version,2);
 await assert.rejects(withWorkspaceMoveSession(app,client,session=>session.move(destination,{activate:async()=>assert.fail('Prepared owner must not activate')}),{checkpoint:(stage,owner)=>{if(stage==='project:prepared'&&owner.projectId===parentId)throw Error('Prepared native owner');}}),/Prepared native owner/);
 assert.equal((await moves.status(parentId)).canCancel,false);await assert.rejects(moves.cancel(parent,{id:workspaceCopyTransferId(initial.id,parentId)}),{code:'STORAGE_PROJECT_BUSY'});

 let parentCompleted=false,lostRegistration=false;
 const relocate=ProjectRegistry.prototype.relocate;ProjectRegistry.prototype.relocate=async function(storage,options){const result=await relocate.call(this,storage,options);if(storage.projectId===projectId&&!lostRegistration){lostRegistration=true;throw Error('Lost registry publication acknowledgement');}return result;};
 try{await assert.rejects(withWorkspaceMoveSession(app,client,session=>session.move(destination,{activate:async()=>assert.fail('Registry interruption must not activate')}),{checkpoint:async(stage,owner)=>{if(stage==='project:complete'&&owner.projectId===parentId){parentCompleted=true;assert.ok((await stat(project.root)).isDirectory(),'Parent retirement retains its independent child until the child transfer');assert.equal((await registry.locate(projectId)).root,project.root);}}}),/Lost registry publication acknowledgement/);}finally{ProjectRegistry.prototype.relocate=relocate;}
 assert.equal(lostRegistration,true);assert.equal(parentCompleted,true);assert.equal(app.session(client).get(projectId).root,project.root,'The committed registry change precedes the grant callback');
 const retainedGrant=app.session(client).get(projectId),retainedExpiry=retainedGrant.expires,details=projectRequest('/api/projects/'+projectId+'/storage/details');await assert.rejects(app.run(other,details,{}),error=>['ACCESS_LOCKED','DEVICE_UNKNOWN'].includes(error.code));
 const retainedBookGrant=app.session(client).get('book:'+projectId+':'+book.labBookId);
 for(const replacement of [{locked:true},{...retainedGrant,vault:{id:retainedGrant.vault.id,key:Buffer.from(retainedGrant.vault.key)},expires:0}]){const deniedClient={};app.session(deniedClient).set(projectId,replacement);if(replacement.vault)app.credentials.add(replacement);try{await assert.rejects(app.run(deniedClient,details,{}),error=>['ACCESS_LOCKED','DEVICE_UNKNOWN'].includes(error.code));assert.equal(retainedGrant.root,project.root);}finally{app.session(deniedClient).delete(projectId);app.credentials.delete(replacement);clearVault(replacement.vault);}}
 assert.equal(app.session(client).get('book:'+projectId+':'+book.labBookId),retainedBookGrant);assert.ok(retainedBookGrant.vault.key);

 const reopened=await app.run(client,details,{});assert.equal(reopened.path,path.join(destination,parentMetadata.title,metadata.title));assert.equal(app.session(client).get(projectId),retainedGrant);assert.equal(retainedGrant.expires,retainedExpiry);
 let interrupted=false;await assert.rejects(withWorkspaceMoveSession(app,client,session=>session.move(destination,{activate:async()=>{assert.fail('Interrupted move must not activate');}}),{checkpoint:async(phase,owner)=>{if(phase==='project:complete'&&owner.projectId===parentId){parentCompleted=true;assert.ok((await stat(project.root)).isDirectory(),'Parent retirement retains its independent child until the child transfer');assert.equal((await registry.locate(projectId)).root,project.root);}if(phase==='project:adopted'&&owner.projectId===projectId&&!interrupted){interrupted=true;throw Error('Interrupted after selected owner publication');}}}),/Interrupted after selected owner publication/);assert.equal(interrupted,true);assert.equal(parentCompleted,true);phase('first interrupted adoption');
 const pendingOwner=await moves.read(projectId);assert.equal(pendingOwner.version,3);assert.equal(pendingOwner.workspaceMoveId,initial.id);assert.equal(pendingOwner.workspaceMoveRevision,initial.directory.revision);assert.equal(pendingOwner.books,undefined);assert.equal(pendingOwner.bookOwners.count,1);assert.equal(pendingOwner.bookKeys.count,1);assert.ok(Buffer.byteLength(JSON.stringify(pendingOwner))<32768);
 const bundled=new Workspace(destination,f.vault),pending=JSON.parse(await bundled.readFile(path.join(destination,WORKSPACE_BUNDLE_MOVE),'utf8'));assert.equal(pending.version,2);assert.equal(pending.projects,undefined);assert.equal(pending.directory.head.roots.active.count,3);assert.ok(Buffer.byteLength(JSON.stringify(pending))<16384);
 const siblingEntry=await registry.locate(sibling.projectId);assert.deepEqual(await new ProjectStorage(siblingEntry.root,sibling.projectId,siblingVault).read(),siblingBefore);
 let erased=false;await assert.rejects(withWorkspaceMoveSession(app,client,session=>session.move(destination,{activate:async()=>assert.fail('Erasure interruption must not activate')}),{checkpoint:async(stage,owner)=>{if(stage==='project:keys-erased'&&owner.projectId===projectId&&!erased){erased=true;throw Error('Lost key-erasure acknowledgement');}}}),/Lost key-erasure acknowledgement/);assert.equal(erased,true);assert.equal((await moves.read(projectId)).phase,'releasing');
 const movedOwner=new ProjectStorage(path.join(destination,parentMetadata.title,metadata.title),projectId,vault);assert.equal(Number((await movedOwner.catalogue(store=>store.db.get('SELECT count(*) AS count FROM state WHERE slot LIKE $1','portability:'+pendingOwner.bookKeys.id+':%'))).count),0);
 let cleaned=false;await assert.rejects(withWorkspaceMoveSession(app,client,session=>session.move(destination,{activate:async()=>{assert.fail('Interrupted cleanup must not activate');}}),{checkpoint:async phase=>{if(phase==='project-container'&&!cleaned){cleaned=true;throw Error('Interrupted after empty original retirement');}}}),/Interrupted after empty original retirement/);assert.equal(cleaned,true);await assert.rejects(stat(parent.root),{code:'ENOENT'});phase('container retirement');
 await assert.rejects(withWorkspaceMoveSession(app,client,session=>session.move(destination,{activate:async()=>{throw Error('Interrupted before workspace activation');}})),/Interrupted before workspace activation/);
 const frozen=await readMoveReceipt(destination);assert.equal(frozen.version,2);assert.equal(frozen.projectRoots,undefined);assert.deepEqual(frozen.directory,pending.directory);assert.equal(frozen.phase,'verified');
 let copied;
 await withWorkspaceMoveSession(app,client,async session=>{const result=await session.move(destination,{activate:async()=>{copied=new ProjectApplication(new Workspace(destination,f.vault),{deviceStore:f.deviceStore});applications.push(copied);}});assert.equal(result.phase,'complete');await session.install(copied);});phase('completed activation');
 ProjectRegistry.prototype.read=oldRead;ProjectRegistry.prototype.change=oldChange;
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
 phase('final authoring and grants');

});

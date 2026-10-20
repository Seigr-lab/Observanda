import {workspaceDestinationFixture} from './workspace-destination-fixture.js';
import {selectProjectTree} from '../src/project-tree-manifest.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {LabBookRouter} from '../src/lab-book-router.js';
import {ProjectApplication,projectRequest} from '../src/project-application.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,access,rename,readFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {ProjectStorage,initializeProjectLocation} from '../src/project-storage.js';
import {Workspace,atomicWrite,serialize} from '../src/storage.js';
import {inspectArchivedOwnerDirectory} from '../src/owner-directory-archive.js';
import {hashWorkspaceFile} from '../src/workspace-inventory.js';
import {WorkspaceCopyRecovery} from '../src/workspace-copy-recovery.js';
import {WorkspaceProjectCopy} from '../src/workspace-project-copy.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault,verifyAccess,readAccess} from '../src/access.js';
import {changeKeyringPassword,recoveryKey} from '../src/security/keyring.js';
import {TestDeviceStore} from './device-fixture.js';
import {clearVault} from '../src/encryption.js';
import {sampleNotebook} from '../src/sample.js';
import {catalogueBinding,CATALOGUE_ARCHIVE} from '../src/postgres-activation.js';

test('portable workspace archives include external and nested projects with independent access and resumable export',{timeout:process.env.OBSERVANDA_TEST_SECOND_VOLUME?600000:240000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-portable-owners-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),f=await encryptedFixture(directory,sampleNotebook()),vaults=[f.vault],owners=new Map(),before=new Map(),password='Each exported project password';let placement,app;
 t.after(async()=>{await app?.close();await provider.close();detach();for(const key of vaults)clearVault(key);await placement?.cleanup();assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-portable-owners-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 placement=await workspaceDestinationFixture(directory);
 const registry=new ProjectRegistry(f.workspace,(await f.workspace.outline()).metadata.id);
 const make=async(root,parentId=null)=>{await mkdir(path.dirname(root),{recursive:true});const book=sampleNotebook(),grant=await createWorkspaceAccess('','',f.deviceStore),vault=takeCreatedVault(grant);vaults.push(vault);book.title=book.projects[0].title=path.basename(root);const owner=await initializeProjectLocation(root,book.projects[0].id,book,grant,vault);await registry.attach(owner,{parentId,expected:(await registry.read()).revision});owners.set(owner.projectId,owner);before.set(owner.projectId,await owner.read());return owner;};
 const external=await make(path.join(directory,'External Project')),externalChild=await make(path.join(external.root,'Child observations 2'),external.projectId),parent=await make(path.join(f.workspace.root,'Parent Project')),child=await make(path.join(parent.root,'Child Project'),parent.projectId),destination=path.join(placement.root,'Portable Workspace');let failAt='project';
 const createdBook=await new LabBookCreation(externalChild,f.deviceStore).create({id:randomUUID(),username:'',password:'Independent book password',book:{id:randomUUID(),projectId:externalChild.projectId,title:'Field observations 1'}}),bookKey=await verifyAccess(await readAccess(createdBook.book.root),'','Independent book password',{deviceStore:f.deviceStore});vaults.push(bookKey);const bookOwner=new LabBookStorage(createdBook.book.root,createdBook.book.labBookId,bookKey),bookBefore=await bookOwner.read();
 const bundle=()=>new WorkspaceProjectCopy(f.workspace,{withProject:(id,use)=>use(owners.get(id)),withBook:(project,id,use)=>{assert.equal(project.projectId,externalChild.projectId);assert.equal(id,bookOwner.labBookId);return use(bookOwner);},checkpoint:async phase=>{if(phase===failAt){failAt=null;throw Error('Portable export interrupted');}}});
 await assert.rejects(bundle().plan(destination,{portable:true,inspect:false}),{code:'STORAGE_PORTABLE_PROJECT_ACCESS'});await assert.rejects(access(destination),{code:'ENOENT'});
 for(const owner of owners.values()){const grant=await changeKeyringPassword((await readAccess(owner.root)).value,owner.vault,{password,deviceStore:f.deviceStore});await atomicWrite(path.join(owner.root,'.observanda/access.json'),serialize(grant));}
 const kit=recoveryKey((await readAccess(f.workspace.root)).value,f.vault);await atomicWrite(path.join(f.workspace.root,'.observanda/access.json'),serialize(kit.value));const sourceBefore=await f.workspace.read();
 const plan=await bundle().plan(destination,{portable:true,inspect:false});assert.equal(plan.portable,true);assert.equal(plan.projectPlacement,2);
 await assert.rejects(bundle().copy(plan),/Portable export interrupted/);await assert.rejects(bundle().plan(destination,{inspect:false}),{code:'CONFLICT'});
 await bundle().copy(await bundle().plan(destination,{portable:true,inspect:false}));
 const exported=new Workspace(destination,f.vault),saved=new ProjectRegistry(exported,registry.workspaceId),locations=await inspectArchivedOwnerDirectory(saved,await hashWorkspaceFile(path.join(destination,CATALOGUE_ARCHIVE),{reportProgress:false}),async view=>(await Array.fromAsync(view.entries())).map(row=>row.entry));
 const receipt=await new WorkspaceCopyRecovery(f.workspace,destination).read();assert.equal(receipt.version,4);assert.equal(receipt.directory.revision,receipt.plan.projectRegistryRevision);assert.equal(receipt.transfers,undefined);assert.equal(receipt.adoptions,undefined);assert.equal(receipt.plan.projectRoots,undefined);assert.ok(Buffer.byteLength(serialize(receipt))<16384);
 for(const root of [destination,...locations.map(entry=>entry.root)]){assert.equal(await catalogueBinding(root),null);await access(path.join(root,CATALOGUE_ARCHIVE));await assert.rejects(access(path.join(root,'.observanda/postgresql')),{code:'ENOENT'});}
 const registryBytes=JSON.parse(await exported.readFile(saved.file,'utf8'));assert.equal(registryBytes.version,8);assert.equal(registryBytes.projects,undefined);assert.equal(serialize(registryBytes).includes(f.workspace.root),false);assert.deepEqual(await f.workspace.read(),sourceBefore);
 await provider.closeLabBook(bookOwner.root);await provider.closeProject(child.root);await provider.closeProject(parent.root);await provider.closeProject(externalChild.root);await provider.closeProject(external.root);await provider.closeWorkspace(f.workspace.root);await rename(f.workspace.root,path.join(directory,'source unavailable'));await rename(external.root,path.join(directory,'external unavailable'));
 assert.equal(await bundle().exportPortable(destination),destination);assert.equal(await catalogueBinding(destination),null);
 const moved=path.join(placement.root,'Another Computer Workspace');await rename(destination,moved);const stranger=new TestDeviceStore({file:path.join(directory,'another-device')});await stranger.identity();
 const key=await verifyAccess(await readAccess(moved),'','',{deviceStore:stranger,recovery:kit.recovery});vaults.push(key);const restored=new Workspace(moved,key);assert.deepEqual(await restored.read(),sourceBefore);
 app=new ProjectApplication(restored,{deviceStore:stranger});const client={};const restoredRegistry=new ProjectRegistry(restored,registry.workspaceId);for(const entry of (await restoredRegistry.read()).value.projects){await assert.rejects(verifyAccess(await readAccess(entry.root),'','',{deviceStore:stranger}),{code:'DEVICE_UNKNOWN'});await app.unlock(client,entry.projectId,{password});const expected=before.get(entry.projectId).book;const writing=await app.run(client,projectRequest('/api/projects/'+entry.projectId+'/research/records/writing/read'),{workspaceId:expected.id,recordId:expected.entries[0].id,sectionId:null});assert.equal(writing.value.body,expected.entries[0].body);const projectKey=await verifyAccess(await readAccess(entry.root),'',password,{deviceStore:stranger});vaults.push(projectKey);assert.deepEqual(await new ProjectStorage(entry.root,entry.projectId,projectKey).read(),before.get(entry.projectId));assert.equal((await catalogueBinding(entry.root)).placement,'project');}
 const restoredParent=await restoredRegistry.locate(externalChild.projectId),parentKey=await verifyAccess(await readAccess(restoredParent.root),'',password,{deviceStore:stranger});vaults.push(parentKey);const parentStorage=new ProjectStorage(restoredParent.root,externalChild.projectId,parentKey),books=new LabBookRegistry(parentStorage);await new LabBookRouter(books,{authorize:async()=>true,unlock:async(entry,access)=>{const key=await verifyAccess(access,'','Independent book password',{deviceStore:stranger});vaults.push(key);return key;}}).withLabBook(bookOwner.labBookId,async storage=>{assert.deepEqual(await storage.read(),bookBefore);assert.equal(path.dirname(storage.root),restoredParent.root);});
 const internalParent=await restoredRegistry.locate(parent.projectId),externalParent=await restoredRegistry.locate(external.projectId);
 assert.equal(externalParent.root,path.join(moved,'External Project'));assert.equal(path.dirname(restoredParent.root),externalParent.root);assert.equal(path.basename(restoredParent.root),'Child observations 2');
 const tree=selectProjectTree({root:externalParent.root,projectId:external.projectId,vault:external.vault},(await restoredRegistry.read()).value.projects);assert.deepEqual(tree.entries.map(entry=>entry.projectId),[externalChild.projectId]);
 assert.equal(path.dirname((await restoredRegistry.locate(child.projectId)).root),internalParent.root);assert.equal((await restoredRegistry.locate(child.projectId)).parentId,parent.projectId);
});

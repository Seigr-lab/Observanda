import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,rm,stat,readFile,writeFile,unlink} from 'node:fs/promises';
import {fixture} from './project-domain-fixture.js';
import {createNotebook} from '../src/model.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {TestDeviceStore} from './device-fixture.js';
import {clearVault} from '../src/encryption.js';
import {Workspace,serialize} from '../src/storage.js';
import {initializeLocation} from '../src/locations.js';
import {ProjectStorage,initializeProjectLocation} from '../src/project-storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectMoves} from '../src/project-move.js';
import {ProjectDomains} from '../src/project-domains.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {InventoryOperationStore} from '../src/inventory-operation-store.js';
import {assertInventoryObligationsSettled} from '../src/inventory-obligation-lifecycle.js';
import {MOVE_SOURCE,moveSource,ownedMoveScope,assertNotMoving} from '../src/workspace-move-state.js';
import {portabilityCollection,createPortabilityCollection} from '../src/portability-collection.js';
import {captureProjectMoveBoundaries,projectMoveBoundaryState} from '../src/native-project-move.js';
import {validateNativeMoveBook} from '../src/native-project-book-move.js';
import {beginCatalogueActivation,catalogueBinding,CATALOGUE_FILE} from '../src/postgres-activation.js';
import {databaseCapacity} from '../src/postgres.js';
import {ProjectApplication,projectRequest} from '../src/project-application.js';
import {withProjectLifecycle} from '../src/project-lifecycle.js';

test('a selected project with books and independent children is never moved out of its workspace',{timeout:180000},async t=>{
 const f=await fixture(t),device=new TestDeviceStore({file:path.join(f.root,'device')}),metadata=createNotebook('Workspace'),root=path.join(f.root,metadata.title),grant=await createWorkspaceAccess('','',device),workspaceKey=takeCreatedVault(grant);t.after(()=>clearVault(workspaceKey));
 await initializeLocation(root,metadata,grant,workspaceKey);const workspace=new Workspace(root,workspaceKey),registry=new ProjectRegistry(workspace,metadata.id);await workspace.outline();
 // A folder outside the workspace is never registered as one of its projects.
 await assert.rejects(registry.attach(f.storage,{expected:'new'}),{code:'PROJECT_OUTSIDE_WORKSPACE'});assert.equal((await registry.read()).value.projects.length,0);
 const owner=async(parent,title,parentId=null)=>{const data=createNotebook(title),id=randomUUID();data.projects=[{id,title,parentId:null,description:'',share:false,logoId:null}];const access=await createWorkspaceAccess('','',device),key=takeCreatedVault(access);t.after(()=>clearVault(key));const storage=await initializeProjectLocation(path.join(parent,title),id,data,access,key);await registry.attach(storage,{parentId,expected:await registry.version()});return storage;};
 const project=await owner(root,'Selected Project'),child=await owner(project.root,'Independent Child',project.projectId),childBefore=await child.read();
 const created=await new LabBookCreation(project,device).create({id:randomUUID(),username:'',password:'Independent book',book:{id:randomUUID(),projectId:project.projectId,title:'Field Notes'}}),key=await verifyAccess(await readAccess(created.book.root),'','Independent book',{deviceStore:device});t.after(()=>clearVault(key));
 const book=new LabBookStorage(created.book.root,created.book.labBookId,key),before=await book.read(),revision=(await registry.read()).revision;
 const moves=new ProjectMoves(registry),withBook=(id,use)=>{assert.equal(id,book.labBookId);return use(book);},outside=path.join(f.root,'Moved');await mkdir(outside);const destination=path.join(outside,path.basename(project.root));
 await assert.rejects(moves.run(project.projectId,project.vault,{id:randomUUID(),path:destination,withBook}),error=>error.code==='STORAGE_OUTSIDE_WORKSPACE'&&error.operationNotStarted===true);
 await assert.rejects(moves.run(project.projectId,project.vault,{id:randomUUID(),resume:true}),{code:'NOT_FOUND'});
 assert.equal(await moves.status(project.projectId),null);await assert.rejects(stat(destination),{code:'ENOENT'});assert.equal((await registry.read()).revision,revision);
 for(const storage of [project,child,book]){assert.equal(await moveSource(storage.root),null);await storage.withLock(()=>{});}
 assert.deepEqual(await book.read(),before);assert.deepEqual(await child.read(),childBefore);assert.equal((await registry.locate(child.projectId)).parentId,project.projectId);
});

test('move admission rereads exact owner markers and rejects foreign or stale scopes',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-move-admission-'));t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-move-admission-'));await rm(root,{recursive:true,force:true});});
 const source=path.join(root,'Source'),book=path.join(source,'Book'),child=path.join(source,'Independent'),destination=path.join(root,'Destination'),id=randomUUID();for(const directory of [source,book,child])await mkdir(path.join(directory,'.observanda'),{recursive:true});
 const marker=async(directory,value)=>writeFile(path.join(directory,MOVE_SOURCE),JSON.stringify(value));await marker(source,{id,destination});await marker(book,{id,destination:path.join(destination,'Book')});await assert.rejects(assertNotMoving(source),{code:'STORAGE_MOVED'});await assertNotMoving(child);
 await ownedMoveScope({id,source,destination},async()=>{await assertNotMoving(source);await assertNotMoving(book);await marker(book,{id:randomUUID(),destination:path.join(destination,'Book')});await assert.rejects(assertNotMoving(book),{code:'STORAGE_MOVED'});});
 await assert.rejects(ownedMoveScope({id:randomUUID(),source,destination},()=>assertNotMoving(source)),{code:'STORAGE_MOVED'});await assert.rejects(ownedMoveScope({id,source,destination:path.join(root,'Other')},()=>assertNotMoving(source)),{code:'STORAGE_MOVED'});await assert.rejects(ownedMoveScope({id,source:book,destination},()=>assertNotMoving(source)),{code:'STORAGE_MOVED'});await assert.rejects(assertNotMoving(source),{code:'STORAGE_MOVED'});
});

const uuid=(kind,index)=>kind+'0000000-0000-4000-8000-'+String(index).padStart(12,'0');
test('external move boundaries and book descriptors remain paged beyond 8192 owners',{timeout:240000},async t=>{
 const f=await fixture(t),count=8193,source=path.join(f.root,'Selected'),registry={workspace:f.storage,inspect:async use=>use({async *entries(){for(let i=0;i<count;i++)yield {entry:{root:path.join(source,'Container','Child '+String(i).padStart(5,'0')),projectId:uuid('1',i),namespaceId:uuid('2',i),vaultId:uuid('3',i)}};}})};
 // Grow metadata only: the generator stands in for the native registry cursor.
 // No thousands of directories, databases, credentials or runtimes are opened.
 const start=Date.now(),captured=await captureProjectMoveBoundaries(registry,source),state=projectMoveBoundaryState(f.storage,{retained:captured.ref,retainedCount:captured.count});assert.equal(state.count,count);assert.equal(captured.ref.count,count+1);assert.equal(await state.protects('Container'),true);assert.equal(await state.contains('Container'),false);assert.equal(await state.contains('Container/Child 08192'),true);assert.equal(await state.contains('Container/Missing'),false);
 const projectId=f.projectId,rows=async function*(){for(let i=0;i<count;i++)yield {kind:'lab-book',relative:'Book '+i,directory:'Book '+i,projectId,labBookId:uuid('4',i),namespaceId:uuid('5',i),vaultId:uuid('6',i),sourceId:uuid('7',i),identity:{dev:'1',ino:String(i+1)},accessHash:'0'.repeat(64)};},ref=await createPortabilityCollection(f.storage,rows()),books=portabilityCollection(f.storage,ref);let maximum=0,seen=0,offset=0;do{const page=await books.page({offset,limit:32});maximum=Math.max(maximum,page.items.length);for(const item of page.items){validateNativeMoveBook(item,projectId);seen++;}offset=page.next;}while(offset!==null);assert.equal(seen,count);assert.equal(maximum,32);const receipt={retained:captured.ref,retainedCount:count,bookOwners:ref};assert.ok(Buffer.byteLength(serialize(receipt))<32768);assert.equal((await books.get('Book 8192')).labBookId,uuid('4',8192));assert.throws(()=>validateNativeMoveBook({...awaitableBook(),key:'forbidden'},projectId),{code:'STORAGE_MOVE_STATE'});
 function awaitableBook(){return {kind:'lab-book',relative:'Book',directory:'Book',projectId,labBookId:uuid('4',0),namespaceId:uuid('5',0),vaultId:uuid('6',0),sourceId:uuid('7',0),identity:{dev:'1',ino:'1'},accessHash:'0'.repeat(64)};}
 t.diagnostic(JSON.stringify({syntheticBoundaryDescriptors:count,syntheticBookDescriptors:count,maximumPageRows:maximum,receiptBytes:Buffer.byteLength(serialize(receipt)),elapsedMs:Date.now()-start,independentDatabasesForDescriptors:0}));
});

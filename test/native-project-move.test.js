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

test('selected native project move retains independent descendants and stock obligations through cancellation and interrupted retirement',{timeout:300000},async t=>{
 const f=await fixture(t),metadata=createNotebook('Workspace'),root=path.join(f.root,metadata.title);await initializeLocation(root,metadata,f.access??await readAccess(f.storage.root).then(v=>v.value),f.vault);const workspace=new Workspace(root,f.vault),registry=new ProjectRegistry(workspace,metadata.id);await registry.attach(f.storage,{expected:'new'});
 const device=new TestDeviceStore({file:path.join(f.root,'book-device')}),created=await new LabBookCreation(f.storage,device).create({id:randomUUID(),username:'',password:'Independent book',book:{id:randomUUID(),projectId:f.projectId,title:'Field Notes'}}),key=await verifyAccess(await readAccess(created.book.root),'','Independent book',{deviceStore:device});t.after(()=>clearVault(key));
 const book=new LabBookStorage(created.book.root,created.book.labBookId,key),before=await book.read(),original=path.join(book.root,'.observanda/evidence.bin');await book.writeFile(original,Buffer.alloc(128*1024,37));
 const childMetadata=createNotebook('Independent Child'),childId=randomUUID();childMetadata.projects=[{id:childId,title:childMetadata.title,parentId:null,description:'',share:false,logoId:null}];const childAccess=await createWorkspaceAccess('','',device),childKey=takeCreatedVault(childAccess);t.after(()=>clearVault(childKey));
 const childRoot=path.join(f.storage.root,childMetadata.title),child=await initializeProjectLocation(childRoot,childId,childMetadata,childAccess,childKey);await registry.attach(child,{parentId:f.projectId,expected:await registry.version()});const childBefore=await child.read();
 const obligation=randomUUID();await f.domains.initialize(['inventory']);await f.domains.run(['inventory'],get=>new InventoryOperationStore(get('inventory')).write('live',obligation,{version:1,id:obligation,quantity:3}),{write:['inventory']});await assert.rejects(assertInventoryObligationsSettled(f.storage),{code:'INVENTORY_OBLIGATIONS'});
 const app=new ProjectApplication(workspace,{deviceStore:new TestDeviceStore({file:path.join(f.root,'device')})}),client={};t.after(()=>app.close());const request=(suffix,data)=>app.run(client,projectRequest('/api/projects/'+f.projectId+'/'+suffix,'POST'),data);await request('lab-books/'+book.labBookId+'/access/unlock',{username:'',password:'Independent book',recovery:''});
 const moves=new ProjectMoves(registry),withBook=(id,use)=>{assert.equal(id,book.labBookId);return use(book);},targetFor=async name=>{const parent=path.join(f.root,name);await mkdir(parent);return path.join(parent,path.basename(f.storage.root));};
 const cancelledId=randomUUID(),cancelledRoot=await targetFor('Cancelled');await assert.rejects(moves.run(f.projectId,f.vault,{id:cancelledId,path:cancelledRoot,withBook,checkpoint:stage=>{if(stage==='copy:database-committed')throw Error('Pause imported destination');}}),/Pause imported destination/);assert.equal((await moves.status(f.projectId)).canCancel,true);assert.equal((await moves.read(f.projectId)).version,3);
 const committed=(await catalogueBinding(cancelledRoot)).id;await f.runtime.closeProject(cancelledRoot);await beginCatalogueActivation(cancelledRoot,committed);await unlink(path.join(cancelledRoot,CATALOGUE_FILE));
 for(const owner of [f.storage,book])await assert.rejects(owner.withLock(()=>{}),{code:'STORAGE_MOVED'});await child.withLock(()=>{});
 await assert.rejects(moves.cancel(f.storage,{id:cancelledId,checkpoint:stage=>{if(stage==='cancel-keys-erased')throw Error('Pause cancellation');}}),/Pause cancellation/);assert.equal((await moves.status(f.projectId)).phase,'cancel-releasing');assert.equal((await request('storage/move/cancel',{id:cancelledId})).phase,'cancelled');assert.equal(await moveSource(f.storage.root),null);assert.equal(await moveSource(book.root),null);await f.storage.withLock(()=>{});await book.withLock(()=>{});
 const cancelled=await moves.read(f.projectId),prefix='portability:'+cancelled.bookKeys.id+':%';for(const owner of [f.storage,new ProjectStorage(cancelledRoot,f.projectId,f.vault)])assert.equal(Number((await owner.catalogue(store=>store.db.get('SELECT count(*) AS count FROM state WHERE slot LIKE $1',prefix))).count),0);
 const id=randomUUID(),destination=await targetFor('Moved');await assert.rejects(moves.run(f.projectId,f.vault,{id,path:destination,withBook,checkpoint:stage=>{if(stage==='prepared')throw Error('Pause prepared');}}),/Pause prepared/);let refreshed=0;await assert.rejects(moves.run(f.projectId,f.vault,{id,resume:true,withBook:async(bookId,use)=>{refreshed++;return withBook(bookId,use);},checkpoint:stage=>{if(stage==='root-frozen')throw Error('Pause partial freeze');}}),/Pause partial freeze/);assert.equal(refreshed,1);assert.equal(await moveSource(book.root),null);await child.withLock(()=>{});
 const perform=ProjectMoves.prototype.perform,interrupted=t.mock.method(ProjectMoves.prototype,'perform',function(projectId,vault,options){return perform.call(this,projectId,vault,{...options,checkpoint:async(stage,...args)=>{await options.checkpoint?.(stage,...args);if(stage==='registry')throw Error('Pause adopted registry');}});});await assert.rejects(request('storage/move/resume',{id}),/Pause adopted registry/);interrupted.mock.restore();assert.equal((await registry.locate(f.projectId)).root,destination);assert.equal((await registry.locate(childId)).root,childRoot);await child.withLock(()=>{});
 await assert.rejects(moves.run(f.projectId,f.vault,{id,resume:true,checkpoint:stage=>{assert.ok(!stage.startsWith('copy:'),'verified owners must not recopy');if(stage==='keys-erased')throw Error('Pause erased capabilities');}}),/Pause erased capabilities/);assert.equal((await moves.status(f.projectId)).phase,'releasing');
 const result=await request('storage/move/resume',{id});assert.equal(result.phase,'complete');assert.deepEqual(await moves.run(f.projectId,f.vault,{id,resume:true}),result);assert.equal((await registry.locate(childId)).root,childRoot);assert.deepEqual(await child.read(),childBefore);await child.withLock(()=>{});await assert.rejects(stat(path.join(f.storage.root,'.observanda')),{code:'ENOENT'});await assert.rejects(stat(book.root),{code:'ENOENT'});
 const target=new ProjectStorage(destination,f.projectId,f.vault),targetBook=new LabBookStorage(path.join(destination,created.book.directory),book.labBookId,key);assert.deepEqual(await targetBook.read(),before);assert.deepEqual(await targetBook.readFile(path.join(targetBook.root,'.observanda/evidence.bin')),Buffer.alloc(128*1024,37));assert.equal((await new LabBookDirectory(registry).locate((await targetBook.outline()).metadata.id)).root,destination);
 const domains=new ProjectDomains(target,f.book.id);assert.deepEqual(await domains.run(['inventory'],get=>new InventoryOperationStore(get('inventory')).read('live',obligation)),{version:1,id:obligation,quantity:3});await assert.rejects(assertInventoryObligationsSettled(target),{code:'INVENTORY_OBLIGATIONS'});
 const finished=await moves.read(f.projectId),receiptBytes=Buffer.byteLength(serialize(finished));t.diagnostic(JSON.stringify({receiptBytes}));assert.ok(receiptBytes<32768);assert.equal(Number((await target.catalogue(store=>store.db.get('SELECT count(*) AS count FROM state WHERE slot LIKE $1','portability:'+finished.bookKeys.id+':%'))).count),0);assert.equal((await portabilityCollection(workspace,finished.bookOwners).page({limit:1})).items[0].key,undefined);
 await withProjectLifecycle(registry,f.projectId,'copy',async()=>{});assert.equal(app.session(client).get('book:'+f.projectId+':'+book.labBookId).root,targetBook.root);await app.close();assert.equal(databaseCapacity().active,0);
 t.diagnostic(JSON.stringify({activeConnections:databaseCapacity().active,independentBooks:1,retainedProjects:1,originalBytes:128*1024,cancellationPhase:'committed-activation-before-binding',resumeStages:['root-frozen','registry','keys-erased'],receiptBytes:Buffer.byteLength(serialize(finished))}));
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

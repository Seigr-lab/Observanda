import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {TestDeviceStore} from './device-fixture.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {createNotebook} from '../src/model.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {copyProjectLocation,copyProjectOwnerLocation,projectTransferReceipt} from '../src/project-transfer.js';
import {captureProjectBookCopyDirectory,withProjectBookCopyDirectory,validateProjectBookCopyTransfers,projectBookCopyTransferId,projectBookCopyMatchesLegacy} from '../src/native-project-book-copy.js';
import {serialize,digest} from '../src/storage-format.js';
import {ProjectBookCopy} from '../src/project-book-copy.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
const uuid=(kind,index)=>kind+'0000000-0000-4000-8000-'+String(index).padStart(12,'0');
test('project book copy pins more than 8192 native owners without aggregate transfer receipts',{timeout:240000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-book-directory-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider);let vault;
 t.after(async()=>{await provider.close();detach();clearVault(vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-book-directory-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const device=new TestDeviceStore({file:path.join(directory,'device.key')}),access=await createWorkspaceAccess('','',device);vault=takeCreatedVault(access);
 const metadata=createNotebook('Directory project'),projectId=randomUUID();metadata.projects=[{id:projectId,title:metadata.title,parentId:null,description:'',share:false,logoId:null}];
 const source=await initializeProjectLocation(path.join(directory,metadata.title),projectId,metadata,access,vault),registry=new LabBookRegistry(source);
 const empty=await captureProjectBookCopyDirectory(registry);assert.equal(await withProjectBookCopyDirectory(registry,empty,view=>view.count),0);
 await mkdir(path.join(directory,'Empty copy'));const copied=await copyProjectLocation(source,path.join(directory,'Empty copy',metadata.title),{id:randomUUID()});assert.equal((await projectTransferReceipt(copied)).phase,'verified');await provider.closeProject(copied.root);
 const before=await source.outline(),count=8193,entry=index=>({labBookId:uuid('1',index),directory:'Lab book '+String(index).padStart(5,'0'),namespaceId:uuid('2',index),vaultId:uuid('3',index)});
 // Only catalogue directory descriptors grow. No thousands of owner folders,
 // independent databases, keys or transfer processes are created by this test.
 const rows=async function*(){for(let index=0;index<count;index++)yield {state:'active',entry:entry(index)};};
 const started=Date.now();await registry.applyBatch(await registry.version(),rows());const pin=await captureProjectBookCopyDirectory(registry),elapsedMs=Date.now()-started;
 assert.equal(pin.head.roots.active.count,count);assert.ok(Buffer.byteLength(serialize(pin))<4096);assert.equal((await source.outline()).etag,before.etag);
 const receipt={id:randomUUID(),bookRegistryRevision:pin.revision,bookTransfersVersion:2,bookCount:count};assert.ok(Buffer.byteLength(serialize(receipt))<256);assert.equal(receipt.bookTransfers,undefined);
 await withProjectBookCopyDirectory(registry,pin,async view=>{
  await validateProjectBookCopyTransfers(receipt,{count:view.count,entries:()=>{throw Error('Compact receipts must not materialize owner membership');}},pin.revision);
  const page=await view.page({offset:count-3,limit:3});assert.equal(page.total,count);assert.deepEqual(page.items.map(row=>row.entry),[entry(count-3),entry(count-2),entry(count-1)]);
  assert.equal((await view.get(uuid('1',count-1))).entry.directory,entry(count-1).directory);
  const transferIds=new Set();let read=0;for await(const {entry:book} of view.entries()){const id=projectBookCopyTransferId(receipt,book.labBookId);assert.ok(!transferIds.has(id));transferIds.add(id);read++;}assert.equal(read,count);
 });
 assert.deepEqual(await captureProjectBookCopyDirectory(registry),pin,'repeated capture must not change the source snapshot');
 const old={id:randomUUID(),bookRegistryRevision:pin.revision,bookTransfers:[{labBookId:uuid('1',0),id:randomUUID()},{labBookId:uuid('1',1),id:randomUUID()}]},oldView={count:2,async *entries(){yield {entry:entry(0)};yield {entry:entry(1)};}};
 await validateProjectBookCopyTransfers(old,oldView,pin.revision);assert.equal(projectBookCopyTransferId(old,uuid('1',1)),old.bookTransfers[1].id);
 old.bookTransfers[1].id=old.bookTransfers[0].id;await assert.rejects(validateProjectBookCopyTransfers(old,oldView,pin.revision),{code:'STORAGE_COPY'});
 const next=await registry.apply(pin.revision,[{state:'active',entry:entry(count)}]);assert.notEqual(next.revision,pin.revision);assert.equal(await withProjectBookCopyDirectory(registry,pin,view=>view.count),count);assert.equal(await withProjectBookCopyDirectory(registry,pin,view=>view.get(uuid('1',count))),null);
 t.diagnostic(JSON.stringify({owners:count,nativeDirectoryBuildMs:elapsedMs,pinBytes:Buffer.byteLength(serialize(pin)),receiptBytes:Buffer.byteLength(serialize(receipt)),independentBookDatabasesCreated:0}));
});


test('pending project copies retain original book transfer IDs across verified native directory adoption',{timeout:180000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-book-legacy-copy-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),vaults=[];
 t.after(async()=>{await provider.close();detach();vaults.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-book-legacy-copy-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const device=new TestDeviceStore({file:path.join(directory,'device.key')}),access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);vaults.push(vault);
 const metadata=createNotebook('Earlier directory'),projectId=randomUUID();metadata.projects=[{id:projectId,title:metadata.title,parentId:null,description:'',share:false,logoId:null}];
 const source=await initializeProjectLocation(path.join(directory,metadata.title),projectId,metadata,access,vault),registry=new LabBookRegistry(source);
 const created=await new LabBookCreation(source,device).create({id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId,title:'Retained book'}}),key=await verifyAccess(await readAccess(created.book.root),'','',{deviceStore:device});vaults.push(key);
 const storage=new LabBookStorage(created.book.root,created.book.labBookId,key),before=await storage.read(),withBook=(id,use)=>{assert.equal(id,storage.labBookId);return use(storage);};
 const legacy=serialize((await registry.read()).value),oldRevision=digest(legacy);await source.writeFile(registry.file,legacy);
 // Exercise the retained older writer directly so this fixture genuinely has
 // an envelope revision and random transfer IDs before native adoption.
 const older=new ProjectBookCopy(source);await older.prepare(withBook,{relocation:true});assert.equal(older.revision,oldRevision);
 await mkdir(path.join(directory,'Copies'));const destination=path.join(directory,'Copies',metadata.title),id=randomUUID();let pending;
 try{
  await assert.rejects(older.using(()=>copyProjectOwnerLocation(source,destination,{id,beforeVerified:async(target,receipt,save)=>{
   await older.copy(target,receipt,save,{checkpoint:stage=>{if(stage==='book'){pending=structuredClone(receipt);throw Error('Interrupted older copy');}}});
  }})),/Interrupted older copy/);
 }finally{older.close();}
 assert.equal(pending.bookRegistryRevision,oldRevision);assert.equal(pending.bookTransfers.length,1);assert.equal(pending.bookTransfersVersion,undefined);
 const copy=await copyProjectLocation(source,destination,{id,withBook}),finished=await projectTransferReceipt(copy),pin=await captureProjectBookCopyDirectory(registry);
 assert.equal(finished.phase,'verified');assert.notEqual(pin.revision,oldRevision);assert.equal(finished.bookRegistryRevision,pin.revision);assert.deepEqual(finished.bookTransfers,pending.bookTransfers);
 assert.equal(await projectBookCopyMatchesLegacy(registry,pin,oldRevision),true);assert.equal(await projectBookCopyMatchesLegacy(registry,pin,'0'.repeat(64)),false);
 const copiedBook=new LabBookStorage(path.join(destination,created.book.directory),storage.labBookId,key);assert.deepEqual(await copiedBook.read(),before);await provider.closeLabBook(copiedBook.root);
 const state=await registry.state(storage.labBookId);await registry.apply(state.revision,[{state:'active',entry:{...state.entry,directory:'Changed location'}}]);
 const changed=await captureProjectBookCopyDirectory(registry);assert.equal(await projectBookCopyMatchesLegacy(registry,changed,oldRevision),false,'retaining an old digest cannot authorize a different current placement');
});

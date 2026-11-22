import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {TestDeviceStore} from './device-fixture.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {createNotebook} from '../src/model.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {copyProjectLocation,projectTransferReceipt} from '../src/project-transfer.js';
import {captureProjectBookCopyDirectory,withProjectBookCopyDirectory,validateProjectBookCopyTransfers,projectBookCopyTransferId} from '../src/native-project-book-copy.js';
import {serialize} from '../src/storage-format.js';
import {ownerWorkspace} from './owner-workspace-fixture.js';
const uuid=(kind,index)=>kind+'0000000-0000-4000-8000-'+String(index).padStart(12,'0');
test('project book copy pins more than 8192 native owners without aggregate transfer receipts',{timeout:240000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-book-directory-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider);let vault;
 t.after(async()=>{await provider.close();detach();await clearVault(vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-book-directory-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const device=new TestDeviceStore({file:path.join(directory,'device.key')}),access=await createWorkspaceAccess('','',device);vault=takeCreatedVault(access);
 // Owners live in an open workspace and use its single cluster.
 const ownerHome=await ownerWorkspace(directory);t.after(()=>clearVault(ownerHome.vault));
 const metadata=createNotebook('Directory project'),projectId=randomUUID();metadata.projects=[{id:projectId,title:metadata.title,parentId:null,description:'',share:false,logoId:null}];
 const source=await initializeProjectLocation(path.join(ownerHome.root,metadata.title),projectId,metadata,access,vault),registry=new LabBookRegistry(source);
 const empty=await captureProjectBookCopyDirectory(registry);assert.equal(await withProjectBookCopyDirectory(registry,empty,view=>view.count),0);
 await mkdir(path.join(ownerHome.root,'Empty copy'));const copied=await copyProjectLocation(source,path.join(ownerHome.root,'Empty copy',metadata.title),{id:randomUUID()});assert.equal((await projectTransferReceipt(copied)).phase,'verified');await provider.closeProject(copied.root);
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
 // A copy receipt listing transfer ids per book comes only from releases before alpha.29 and is refused.
 const old={id:randomUUID(),bookRegistryRevision:pin.revision,bookTransfers:[{labBookId:uuid('1',0),id:randomUUID()},{labBookId:uuid('1',1),id:randomUUID()}]},oldView={count:2,async *entries(){yield {entry:entry(0)};yield {entry:entry(1)};}};
 await assert.rejects(validateProjectBookCopyTransfers(old,oldView,pin.revision),{code:'STORAGE_COPY'});assert.throws(()=>projectBookCopyTransferId(old,uuid('1',1)),{code:'STORAGE_COPY'});
 const next=await registry.apply(pin.revision,[{state:'active',entry:entry(count)}]);assert.notEqual(next.revision,pin.revision);assert.equal(await withProjectBookCopyDirectory(registry,pin,view=>view.count),count);assert.equal(await withProjectBookCopyDirectory(registry,pin,view=>view.get(uuid('1',count))),null);
 t.diagnostic(JSON.stringify({owners:count,nativeDirectoryBuildMs:elapsedMs,pinBytes:Buffer.byteLength(serialize(pin)),receiptBytes:Buffer.byteLength(serialize(receipt)),independentBookDatabasesCreated:0}));
});

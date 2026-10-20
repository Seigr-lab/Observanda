import '../src/storage.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,copyFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {Workspace,atomicWrite,workspaceFile} from '../src/storage.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {OwnerDirectoryBlocks} from '../src/owner-directory-blocks.js';
import {OWNER_DIRECTORY_HEAD} from '../src/owner-directory-model.js';
import {verifyOwnerDirectories} from '../src/owner-directory.js';
import {projectDirectoryChoices,projectDirectoryPage} from '../src/project-directory-query.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {digest,serialize} from '../src/storage-format.js';
import {catalogueFormat,catalogueRequiresOwnerDirectories} from '../src/catalogue-format.js';
import {transferCatalogue,backupCatalogue} from '../src/postgres.js';
import {rekeyCatalogue} from '../src/research-catalogue.js';
const uuid=(kind,n)=>kind+'0000000-0000-4000-8000-'+String(n).padStart(12,'0');
const empty=()=>{const book=sampleNotebook();book.projects=[];book.notebooks=[];book.entries=[];return book;};
test('native owner directory grows beyond the former envelope with bounded point windows, durable upgrade and exact copy/rekey', {timeout:300000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-native-owner-directory-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),vaults=[];
 t.after(async()=>{await runtime.close();detach();for(const vault of vaults)clearVault(vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-native-owner-directory-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const f=await encryptedFixture(path.join(directory,'source'),empty());vaults.push(f.vault);const workspaceId=(await f.workspace.outline()).metadata.id,registry=new ProjectRegistry(f.workspace,workspaceId),before=await f.workspace.outline();
 const entry=n=>({projectId:uuid('1',n),namespaceId:uuid('2',n),vaultId:uuid('3',n),parentId:null,root:path.join(f.workspace.root,'Project '+String(n).padStart(5,'0')),summary:{title:'Project '+n,description:'Measured directory description. '.padEnd(1500,'x'),kind:'Project',templateName:n%10===0?'Template '+n:null}});
 let legacy={version:7,workspaceId,projects:[entry(0)],deleted:[],relocated:[],aliases:null};const original=serialize(legacy);await f.workspace.writeFile(registry.file,original);
 const failed=new Error('Simulated interruption');await assert.rejects(registry.apply(digest(original),[],{checkpoint:async stage=>{if(stage==='candidate')throw failed;}}),error=>error===failed);
 assert.equal(await f.workspace.readFile(registry.file,'utf8'),original);assert.equal((await registry.state(uuid('1',0))).state,'active');
 await f.workspace.catalogue(async store=>{assert.equal(catalogueRequiresOwnerDirectories(await catalogueFormat(store.db)),true);await verifyOwnerDirectories(store);});
 legacy.projects.push(entry(1));const amended=serialize(legacy);await f.workspace.writeFile(registry.file,amended);
 await assert.rejects(registry.apply(digest(amended),[],{checkpoint:async stage=>{if(stage==='marker')throw failed;}}),error=>error===failed);
 const marker=await f.workspace.readFile(registry.file,'utf8');assert.equal(JSON.parse(marker).version,8);assert.ok(Buffer.byteLength(marker)<4096);assert.equal((await registry.state(uuid('1',1))).state,'active');
 let revision=await registry.version();await assert.rejects(registry.apply(digest(amended),[]),{code:'CONFLICT'});assert.equal((await registry.apply(revision,[])).revision,revision);
 let bytes=legacy.projects.reduce((sum,item)=>sum+Buffer.byteLength(serialize(item)),0);const metrics=[];
 const measure=async count=>{
  let reads=0,puts=0;const read=OwnerDirectoryBlocks.prototype.read,put=OwnerDirectoryBlocks.prototype.put;OwnerDirectoryBlocks.prototype.read=async function(...args){reads++;return read.apply(this,args);};OwnerDirectoryBlocks.prototype.put=async function(...args){puts++;return put.apply(this,args);};
  try{
   const last=entry(count-1);assert.equal((await registry.state(last.projectId)).entry.namespaceId,last.namespaceId);assert.equal((await registry.state(last.namespaceId,{index:'namespace'})).entry.projectId,last.projectId);
   const page=await registry.inspect(view=>view.page({index:'label',offset:count-5,limit:5}));assert.equal(page.total,count);assert.deepEqual(page.items.map(row=>row.entry.projectId),Array.from({length:5},(_,i)=>uuid('1',count-5+i)));
   const selectedReads=reads;reads=0;const changed={...last,summary:{...last.summary,description:'One selected summary amendment'}};revision=(await registry.apply(revision,[{state:'active',entry:changed}])).revision;
   metrics.push({count,selectedReads,mutationReads:reads,puts});assert.ok(selectedReads<100,JSON.stringify(metrics.at(-1)));assert.ok(reads<120,JSON.stringify(metrics.at(-1)));assert.ok(puts<120,JSON.stringify(metrics.at(-1)));
  }finally{OwnerDirectoryBlocks.prototype.read=read;OwnerDirectoryBlocks.prototype.put=put;}
 };
 for(let begin=2;begin<9700;){const end=Math.min(begin<100?100:9700,begin+128),changes=[];for(let n=begin;n<end;n++){const item=entry(n);bytes+=Buffer.byteLength(serialize(item));changes.push({state:'active',entry:item});}revision=(await registry.apply(revision,changes)).revision;begin=end;if(begin===100)await measure(begin);if(begin%1024<128)t.diagnostic('Directory growth: '+begin+' owners');}
 assert.ok(bytes>16*1024*1024);await measure(9700);assert.ok(metrics[1].selectedReads<=metrics[0].selectedReads+30);assert.ok(metrics[1].mutationReads<=metrics[0].mutationReads+30);t.diagnostic(JSON.stringify({registeredBytes:bytes,metrics}));
 const after=await f.workspace.outline();assert.equal(after.etag,before.etag);assert.equal(serialize(after.metadata),serialize(before.metadata));assert.equal(await f.workspace.readFile(registry.file,'utf8'),marker);
 const choices=await projectDirectoryChoices(registry,{exclude:null,kind:'book-parents',limit:5,offset:9695,query:'',revision:null});assert.equal(choices.total,9700);assert.equal(choices.projects[0].projectId,uuid('1',9695));
 const page=await projectDirectoryPage(registry,{limit:5,offset:9695,parentId:null,revision:null});assert.equal(page.total,9700);assert.equal(page.projects[0].projectId,uuid('1',9695));
 const treeChanges=async function*(cyclic=false){for(let n=0;n<260;n++)yield {state:'active',entry:{...entry(n),parentId:n?uuid('1',n-1):cyclic?uuid('1',259):null}};};
 const beforeTree=await registry.version();await assert.rejects(registry.applyBatch(beforeTree,treeChanges(true)),{code:'FORMAT'});assert.equal(await registry.version(),beforeTree);
 revision=(await registry.applyBatch(beforeTree,treeChanges())).revision;assert.equal((await registry.inspect(view=>view.ancestors(uuid('1',259)))).length,260);await f.workspace.catalogue(store=>verifyOwnerDirectories(store,{signal:t.signal}));
 const resetTree=async function*(){for(let n=0;n<260;n++)yield {state:'active',entry:entry(n)};};revision=(await registry.applyBatch(revision,resetTree())).revision;t.diagnostic('Atomic 260-row tree, cycle rollback and deep hierarchy verification passed.');
 const base=await registry.version(),last=(await registry.state(uuid('1',9699))).entry;await assert.rejects(registry.apply(base,[{state:'active',entry:{...last,namespaceId:uuid('2',0)}}]),{code:'EXISTS'});assert.equal(await registry.version(),base);
 await assert.rejects(registry.apply(base,[{state:'active',entry:{...last,parentId:last.projectId}}]),{code:'FORMAT'});assert.equal(await registry.version(),base);
 const descriptorText=await f.workspace.readFile(await workspaceFile(f.workspace.root),'utf8'),descriptor=JSON.parse(descriptorText);
 const check=async target=>{
  const reopened=new ProjectRegistry(target,workspaceId);assert.equal(await reopened.version(),base);assert.equal((await reopened.state(last.projectId)).entry.root,path.join(target.root,path.basename(last.root)));
  assert.equal((await reopened.inspect(view=>view.page({index:'label',limit:3,offset:9697}))).total,9700);assert.equal((await projectDirectoryChoices(reopened,{exclude:null,kind:'book-parents',limit:3,offset:9697,query:'',revision:null})).projects[0].projectId,uuid('1',9697));
  await target.catalogue(store=>verifyOwnerDirectories(store,{signal:t.signal}));assert.equal((await target.outline()).etag,before.etag);
 };
 const clone=new Workspace(path.join(directory,'copied'),f.vault);await mkdir(path.join(clone.root,'.observanda'),{recursive:true});await copyFile(path.join(f.workspace.root,'.observanda/access.json'),path.join(clone.root,'.observanda/access.json'));await clone.writeFile(await workspaceFile(clone.root,{secure:true}),descriptorText);
 const sourceDb=await f.workspace.openCatalogue(),targetDb=await clone.openCatalogue({create:true,detached:true});try{await targetDb.run('BEGIN');await transferCatalogue(sourceDb,targetDb);await targetDb.scope(()=>clone.catalogueStore(targetDb).verify(descriptor));await targetDb.run('COMMIT');await backupCatalogue(clone.root,clone.root,{connection:targetDb});}finally{await sourceDb.close();await targetDb.close();}
 await clone.writeFile(new ProjectRegistry(clone,workspaceId).file,marker);await check(clone);t.diagnostic('Ordinary native archive copy verified.');
 const access=await createWorkspaceAccess('','',f.deviceStore),vault=takeCreatedVault(access);vaults.push(vault);const fresh=new Workspace(path.join(directory,'fresh-key'),vault);await mkdir(path.join(fresh.root,'.observanda'),{recursive:true});await atomicWrite(path.join(fresh.root,'.observanda/access.json'),serialize(access));await fresh.writeFile(await workspaceFile(fresh.root,{secure:true}),descriptorText);
 await rekeyCatalogue(f.workspace,fresh,descriptor);await fresh.writeFile(new ProjectRegistry(fresh,workspaceId).file,marker);await check(fresh);t.diagnostic('Fresh-key native recovery verified before and after marker placement.');
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{await store.db.run('SAVEPOINT directory_corruption');try{await store.db.run('DELETE FROM state WHERE slot=$1',OWNER_DIRECTORY_HEAD);await assert.rejects(verifyOwnerDirectories(store),{code:'CATALOGUE_DAMAGED'});}finally{await store.db.run('ROLLBACK TO SAVEPOINT directory_corruption');}}));
 assert.equal(await registry.version(),base);
});

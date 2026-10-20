import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {TestDeviceStore} from './device-fixture.js';
import {createNotebook} from '../src/model.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {ProjectImportAccess} from '../src/project-import-access.js';
import {readProjectImport,saveProjectImport,projectImportFile} from '../src/project-import-state.js';
import {portabilityCollection} from '../src/portability-collection.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess} from '../src/access.js';
import {ProjectAccessSettings} from '../src/project-access-settings.js';
import {clearVault} from '../src/encryption.js';

test('import authorization pages independent owners and rejects stale, revoked and foreign-client grants',{timeout:360000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-import-access-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),vaults=[];
 let manager;t.after(async()=>{await manager?.close();await provider.close();detach();vaults.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-import-access-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const f=await encryptedFixture(path.join(directory,'Receiver'),createNotebook('Receiver'));vaults.push(f.vault);const registry=new ProjectRegistry(f.workspace,(await f.workspace.outline()).metadata.id),foreign=new TestDeviceStore({file:path.join(directory,'foreign-device')});
 const password='Independent owner password';
 async function project(root,title){const metadata=createNotebook(title),projectId=randomUUID(),access=await createWorkspaceAccess('',password,foreign),vault=takeCreatedVault(access);vaults.push(vault);metadata.projects=[{id:projectId,title,parentId:null,description:'',share:false,logoId:null}];return initializeProjectLocation(path.join(root,title),projectId,metadata,access,vault);}
 const source=await project(directory,'Selected Project'),child=await project(source.root,'Nested Project'),book=await new LabBookCreation(source,foreign).create({id:randomUUID(),username:'',password,book:{id:randomUUID(),projectId:source.projectId,title:'Independent Notes'}}),pinned=await stat(source.root);
 const app={deviceStore:f.deviceStore,registry:async()=>registry};let now=Date.now();manager=new ProjectImportAccess(app,{now:()=>now});const client={},other={},base={username:'',password,recovery:''};
 const begin=(id=randomUUID(),secret=password)=>manager.start(client,{id,path:source.root,parentId:null,intent:'import',...base,password:secret});
 const rows=ref=>f.workspace.catalogue(async store=>Number((await store.db.get('SELECT count(*) AS n FROM state WHERE slot LIKE $1','portability:'+ref.id+':%')).n));
 const first=await begin(),firstValue=await readProjectImport(registry,first.id),firstKeys=structuredClone(firstValue.access.grants);
 assert.equal(first.items.length,1);assert.equal(first.authorized,1);await assert.rejects(manager.page(other,{id:first.id,session:first.session}),{code:'ACCESS_LOCKED'});
 await assert.rejects(manager.submit(client,{id:first.id,session:first.session,revision:randomUUID(),relative:first.items[0].relative,...base}),{code:'CONFLICT'});
 await assert.rejects(manager.submit(client,{id:first.id,session:first.session,revision:first.revision,relative:first.items[0].relative,...base,password:'Incorrect password'}),{code:'PROJECT_IMPORT_ACCESS'});
 // The browser can reach owners beyond the former aggregate request ceiling
 // without retaining or sending preceding owners or credentials.
 await portabilityCollection(f.workspace,firstValue.access.candidates).appendAll((async function*(){for(let n=0;n<8297;n++)yield {relative:'Synthetic '+n,kind:'project',parentId:source.projectId,expected:null,authorized:false};})());await saveProjectImport(registry,firstValue);
 const page=await manager.page(client,{id:first.id,session:first.session,offset:8192,limit:32});assert.equal(page.items.length,32);assert.ok(page.total>8192);assert.ok(Buffer.byteLength(JSON.stringify(page))<16384);assert.ok((await stat(projectImportFile(registry,first.id))).size<16384);
 const probe=structuredClone(firstValue),acceptCredential=manager.acceptCredential;let automaticCount=0;
 manager.acceptCredential=async(_session,_registry,value)=>{automaticCount++;value.access.cursor++;};
 try{const automatic=await manager.advance(manager.sessions.get(first.id),registry,probe,{});assert.equal(automaticCount,32);assert.equal(automatic.automatic,true);assert.equal(automatic.items.length,1);}finally{manager.acceptCredential=acceptCredential;}
 for await(const row of portabilityCollection(f.workspace,firstValue.access.grants).entries()){assert.equal(Object.hasOwn(row,'password'),false);assert.equal(JSON.stringify(row).includes(source.vault.key.toString('base64')),false);}
 const open=f.workspace.openCatalogue;let cleanupFailed=false;
 f.workspace.openCatalogue=async function(...args){const db=await open.apply(this,args),run=db.run.bind(db);db.run=async(sql,...params)=>{if(sql==='DELETE FROM state WHERE slot LIKE $1'&&params[0]==='portability:'+firstKeys.id+':%'&&!cleanupFailed){cleanupFailed=true;throw Error('Interrupted grant cleanup');}return run(sql,...params);};return db;};
 try{await assert.rejects(manager.release(client,{id:first.id,session:first.session}),/Interrupted grant cleanup/);}finally{f.workspace.openCatalogue=open;}
 assert.equal((await readProjectImport(registry,first.id)).phase,'cancelled');assert.ok(await rows(firstKeys)>0);await manager.expire();assert.equal(manager.cleanupQueue.size,0);assert.equal(await rows(firstKeys),0);assert.equal((await stat(source.root)).ino,pinned.ino);assert.equal((await readProjectImport(registry,first.id)).phase,'cancelled');await assert.rejects(manager.page(client,{id:first.id,session:first.session}),{code:'ACCESS_LOCKED'});
 async function authorize(response){while(!response.ready){const owner=response.items[0];response=await manager.submit(client,{id:response.id,session:response.session,revision:response.revision,relative:owner.relative,...base});}return response;}
 // The last receipt write is durable but its acknowledgement is lost.
 const accepted=await begin(),submit={id:accepted.id,session:accepted.session,revision:accepted.revision,relative:accepted.items[0].relative,...base},write=f.workspace.writeFile;let lost=false;
 f.workspace.writeFile=async function(file,body,...args){const result=await write.call(this,file,body,...args);if(!lost&&file===projectImportFile(registry,accepted.id)&&JSON.parse(body).access?.cursor===2){lost=true;throw Error('Lost durable acknowledgement');}return result;};
 try{await assert.rejects(manager.submit(client,submit),/Lost durable acknowledgement/);}finally{f.workspace.writeFile=write;}
 await assert.rejects(manager.submit(client,submit),{code:'CONFLICT'});const resumed=await manager.page(client,{id:accepted.id,session:accepted.session});assert.equal(resumed.authorized,2);assert.equal(resumed.total,3);
 const second=await authorize(resumed),credentials=await manager.credentials(client,second.id,second.session),access=await readAccess(source.root),unlocked=await credentials.unlock(source.root,'',access);clearVault(unlocked);
 await assert.rejects(credentials.unlock(source.root,'',access,{namespaceId:randomUUID()}),{code:'DATABASE_LOCATION'});
 const renewed='Changed owner password';await new ProjectAccessSettings(source).password({etag:access.etag,username:'',password:renewed},{deviceStore:foreign});await assert.rejects(credentials.unlock(source.root,'',await readAccess(source.root)),{code:'PROJECT_IMPORT_ACCESS'});
 now+=61*60*1000;await manager.expire();assert.equal((await readProjectImport(registry,second.id)).phase,'cancelled');await assert.rejects(manager.page(client,{id:second.id,session:second.session}),{code:'ACCESS_LOCKED'});await manager.close();manager=new ProjectImportAccess(app,{now:()=>now});await assert.rejects(manager.page(client,{id:second.id,session:second.session}),{code:'ACCESS_LOCKED'});
 // A preparation can be cancelled only through its explicitly chosen intent.
 const planned=await authorize(await begin(randomUUID(),renewed));
 await assert.rejects(manager.finish(client,{id:planned.id,session:planned.session,revision:planned.revision},{checkpoint:stage=>{if(stage==='prepared')throw Error('Interrupted before owner copy');}}),/Interrupted before owner copy/);
 assert.equal((await readProjectImport(registry,planned.id)).phase,'prepared');await manager.release(client,{id:planned.id,session:planned.session});assert.equal((await readProjectImport(registry,planned.id)).phase,'prepared');
 const cancelling=await authorize(await manager.start(client,{id:planned.id,intent:'cancel',...base,password:renewed}));
 const cancelled=await manager.finish(client,{id:cancelling.id,session:cancelling.session,revision:cancelling.revision});assert.equal(cancelled.cancelled,true);assert.equal((await readProjectImport(registry,planned.id)).phase,'cancelled');assert.equal((await stat(source.root)).ino,pinned.ino);
 // A crash after the first authorization receipt cannot orphan a reservation.
 const abandoned=randomUUID();let receiptLost=false;f.workspace.writeFile=async function(file,body,...args){const result=await write.call(this,file,body,...args);if(!receiptLost&&file===projectImportFile(registry,abandoned)&&JSON.parse(body).access?.initializing){receiptLost=true;throw Error('Interrupted authorization receipt');}return result;};
 try{await assert.rejects(begin(abandoned,renewed),/Interrupted authorization receipt/);}finally{f.workspace.writeFile=write;}
 const abandonedValue=await readProjectImport(registry,abandoned);await manager.close();assert.equal((await readProjectImport(registry,abandoned)).phase,'cancelled');assert.equal(await rows(abandonedValue.access.grants),0);manager=new ProjectImportAccess(app,{now:()=>now});
 // The key-bearing native commit can succeed while its control root still
 // points at an older generation. Restart cleanup owns the whole namespace.
 const orphan=randomUUID();let orphanRef=null,grantCommits=0;
 f.workspace.writeFile=async function(file,body,...args){if(file===projectImportFile(registry,orphan))orphanRef=structuredClone(JSON.parse(body).access.grants);return write.call(this,file,body,...args);};
 f.workspace.openCatalogue=async function(...args){const db=await open.apply(this,args),run=db.run.bind(db);let touchesGrant=false;db.run=async(sql,...params)=>{if(sql.startsWith('INSERT INTO state')&&typeof params[0]==='string'&&params[0].startsWith('portability:'+orphanRef?.id+':'))touchesGrant=true;const result=await run(sql,...params);if(sql==='COMMIT'&&touchesGrant){touchesGrant=false;if(++grantCommits===2)throw Error('Lost grant commit acknowledgement');}return result;};return db;};
 try{await assert.rejects(begin(orphan,renewed),/Lost grant commit acknowledgement/);}finally{f.workspace.writeFile=write;f.workspace.openCatalogue=open;}
 assert.ok(await rows(orphanRef)>0);for(const session of manager.sessions.values())session.key.fill(0);manager.sessions.clear();manager=new ProjectImportAccess(app,{now:()=>now});await manager.recover(registry);assert.equal(await rows(orphanRef),0);assert.equal((await readProjectImport(registry,orphan)).phase,'cancelled');
 // Restart authorization is explicit. Already discovered owner credentials are
 // checked independently, and completion removes every retained grant root.
 const restarted=await manager.start(client,{id:randomUUID(),path:source.root,parentId:null,intent:'import',...base,password:renewed}),ready=await authorize(restarted),before=await readProjectImport(registry,ready.id),grantRef=structuredClone(before.access.grants),opened=[];
 const result=await manager.finish(client,{id:ready.id,session:ready.session,revision:ready.revision},{checkpoint:async stage=>{if(stage==='prepared'){now+=61*60*1000;await manager.expire();assert.ok(manager.sessions.has(ready.id));}},opened:entry=>opened.push(entry)});assert.equal(result.complete,true);assert.equal(opened.length,3);assert.equal(await rows(grantRef),0);assert.equal((await readProjectImport(registry,ready.id)).access,undefined);assert.equal((await registry.locate(child.projectId)).parentId,source.projectId);assert.equal((await stat(source.root)).ino,pinned.ino);assert.ok(book.book.labBookId);
 await assert.rejects(manager.finish(client,{id:ready.id,session:ready.session,revision:ready.revision}),{code:'ACCESS_LOCKED'});
});

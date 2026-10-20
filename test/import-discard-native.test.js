import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,randomBytes} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {createNotebook} from '../src/model.js';
import {ImportDiscard} from '../src/import-discard.js';
import {portabilityCollection,createPortabilityCollection} from '../src/portability-collection.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {clearVault} from '../src/encryption.js';
import {serialize} from '../src/storage-format.js';

test('native import cancellation retains bounded receipts and erases keys across interrupted cleanup',{timeout:180000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-discard-native-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),vaults=[];
 t.after(async()=>{await runtime.close();detach();for(const vault of vaults)clearVault(vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-discard-native-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const f=await encryptedFixture(path.join(directory,'Receiver'),createNotebook('Receiver'));vaults.push(f.vault);
 const destination=path.join(directory,'Unpublished Project');await mkdir(path.join(destination,'.observanda'),{recursive:true});await writeFile(path.join(destination,'workspace.observanda'),'Disposable unpublished descriptor');
 const pinned=await stat(destination),owners=[],keys=new Map();
 for(let index=0;index<97;index++){const vault={id:randomUUID(),key:randomBytes(32)},entry={kind:'project',relative:index?'Child '+index:'',projectId:randomUUID(),vaultId:vault.id};vaults.push(vault);owners.push(entry);keys.set(entry.relative,vault);}
 const value=(id,count=owners.length)=>({id,source:path.join(directory,'Source'),destination,destinationIdentity:{dev:String(pinned.dev),ino:String(pinned.ino)},owners:owners.slice(0,count)});
 const rows=ref=>f.workspace.catalogue(async store=>Number((await store.db.get('SELECT count(*) AS n FROM state WHERE slot LIKE $1','portability:'+ref.id+':%')).n));
 const prepare=async()=>{const id=randomUUID(),discard=new ImportDiscard(f.workspace,id);await assert.rejects(discard.prepare(value(id),keys,{checkpoint:stage=>{if(stage==='cancel-prepared')throw Error('Prepared checkpoint');}}),/Prepared checkpoint/);return {discard,receipt:await discard.pending()};};
 const first=await prepare(),retainedKeys=structuredClone(first.receipt.keyOwners);
 assert.equal(Array.isArray(first.receipt.owners),false);assert.equal(first.receipt.owners.count,97);assert.ok((await stat(first.discard.file(first.receipt.id))).size<16384);
 let count=0;for await(const entry of first.discard.owners(first.receipt).entries()){assert.equal(entry.relative,owners[count++].relative);assert.equal(Object.hasOwn(entry,'key'),false);}assert.equal(count,97);
 await first.discard.owners(first.receipt).update('Child 96',{stopped:true});assert.equal((await first.discard.owners(await first.discard.pending()).get('Child 96')).stopped,false);await first.discard.save(first.receipt);assert.equal((await first.discard.owners(await first.discard.pending()).get('Child 96')).stopped,true);
 assert.ok(await rows(retainedKeys)>0);let rejectFinal=true;const write=f.workspace.writeFile;
 f.workspace.writeFile=async function(file,contents){if(file===first.discard.file(first.receipt.id)&&rejectFinal){const saved=JSON.parse(contents);if(saved.phase==='complete'&&!saved.keyOwners){rejectFinal=false;throw Error('Final receipt interrupted');}}return write.call(this,file,contents);};
 first.receipt.phase='complete';try{await assert.rejects(first.discard.save(first.receipt),/Final receipt interrupted/);}finally{f.workspace.writeFile=write;}
 // Keys are gone even when the last control-file write did not happen.
 assert.equal(await rows(retainedKeys),0);const pending=JSON.parse(await f.workspace.readFile(first.discard.file(first.receipt.id),'utf8'));assert.ok(pending.keyOwners);
 const completed=await new ImportDiscard(f.workspace,first.receipt.id).pending();assert.equal(completed.phase,'complete');assert.equal(completed.keyOwners,undefined);assert.equal(await rows(retainedKeys),0);assert.equal((await first.discard.owners(completed).get('Child 96')).stopped,true);
 // A pre-freeze discard can restart after its keys were removed but before
 // its independent owner metadata was removed. The destination is untouched.
 const second=await prepare(),metadataRef=structuredClone(second.receipt.owners),keyRef=structuredClone(second.receipt.keyOwners),open=f.workspace.openCatalogue;let failMetadata=true;
 f.workspace.openCatalogue=async function(...args){const db=await open.apply(this,args),run=db.run;db.run=async function(sql,...params){if(failMetadata&&sql==='DELETE FROM state WHERE slot LIKE $1'&&params[0]==='portability:'+metadataRef.id+':%'){failMetadata=false;throw Error('Metadata cleanup interrupted');}return run.call(this,sql,...params);};return db;};
 try{await assert.rejects(second.discard.discard(second.receipt.id),/Metadata cleanup interrupted/);}finally{f.workspace.openCatalogue=open;}
 assert.equal(await rows(keyRef),0);assert.ok(await rows(metadataRef)>0);assert.equal((await second.discard.pending()).discarding,true);
 await new ImportDiscard(f.workspace,second.receipt.id).discard(second.receipt.id);assert.equal(await second.discard.pending(),null);assert.equal(await rows(metadataRef),0);assert.equal((await stat(destination)).ino,pinned.ino);assert.equal(await readFile(path.join(destination,'workspace.observanda'),'utf8'),'Disposable unpublished descriptor');
 // Completion retains its credential pointer if erasure itself fails, and
 // reopening retries cleanup without needing the removed destination.
 const erase=await prepare(),eraseKeys=structuredClone(erase.receipt.keyOwners);let failKeys=true;
 f.workspace.openCatalogue=async function(...args){const db=await open.apply(this,args),run=db.run;db.run=async function(sql,...params){if(failKeys&&sql==='DELETE FROM state WHERE slot LIKE $1'&&params[0]==='portability:'+eraseKeys.id+':%'){failKeys=false;throw Error('Credential erasure interrupted');}return run.call(this,sql,...params);};return db;};
 erase.receipt.phase='complete';try{await assert.rejects(erase.discard.save(erase.receipt),/Credential erasure interrupted/);}finally{f.workspace.openCatalogue=open;}
 assert.ok(await rows(eraseKeys)>0);const erasePending=JSON.parse(await f.workspace.readFile(erase.discard.file(erase.receipt.id),'utf8'));assert.equal(erasePending.phase,'complete');assert.deepEqual(erasePending.keyOwners,eraseKeys);
 assert.equal((await new ImportDiscard(f.workspace,erase.receipt.id).pending()).keyOwners,undefined);assert.equal(await rows(eraseKeys),0);
 // A receipt write can succeed on disk before its caller receives an error.
 // Its native roots must remain readable for cancellation recovery.
 const durableId=randomUUID(),durable=new ImportDiscard(f.workspace,durableId);let afterWrite=true;
 f.workspace.writeFile=async function(file,contents){await write.call(this,file,contents);if(afterWrite&&file===durable.file(durableId)&&!JSON.parse(contents).preparing){afterWrite=false;throw Error('Prepared write acknowledgement lost');}};
 try{await assert.rejects(durable.prepare(value(durableId),keys),/Prepared write acknowledgement lost/);}finally{f.workspace.writeFile=write;}
 const recovered=await durable.pending();assert.equal(recovered.phase,'prepared');assert.equal(recovered.owners.count,97);assert.ok(await rows(recovered.keyOwners)>0);await durable.discard(durableId);assert.equal(await durable.pending(),null);
 // Every preparation boundary is recoverable with only its durable journal,
 // including an empty namespace or an unpublished committed collection.
 for(const stage of ['cancel-journalled','cancel-owners-prepared','cancel-keys-prepared','cancel-prepared']){
  const id=randomUUID(),discard=new ImportDiscard(f.workspace,id);await assert.rejects(discard.prepare(value(id,2),keys,{checkpoint:point=>{if(point===stage)throw Error('Interrupted '+stage);}}),new RegExp('Interrupted '+stage));
  const receipt=await new ImportDiscard(f.workspace,id).pending();assert.equal(receipt.preparing,stage==='cancel-prepared'?undefined:true);const metadata=receipt.owners,credentials=receipt.keyOwners;
  assert.equal(await rows(metadata)>0,stage!=='cancel-journalled');assert.equal(await rows(credentials)>0,['cancel-keys-prepared','cancel-prepared'].includes(stage));
  await discard.discard(id);assert.equal(await discard.pending(),null);assert.equal(await rows(metadata),0);assert.equal(await rows(credentials),0);assert.equal((await stat(destination)).ino,pinned.ino);
 }
 const journalId=randomUUID(),journal=new ImportDiscard(f.workspace,journalId);let journalAck=true;
 f.workspace.writeFile=async function(file,contents){await write.call(this,file,contents);if(journalAck&&file===journal.file(journalId)){journalAck=false;throw Error('Journal acknowledgement lost');}};
 try{await assert.rejects(journal.prepare(value(journalId,2),keys),/Journal acknowledgement lost/);}finally{f.workspace.writeFile=write;}
 const journalled=await journal.pending();assert.equal(journalled.preparing,true);assert.equal(await rows(journalled.keyOwners),0);await journal.discard(journalId);assert.equal(await journal.pending(),null);
 // Losing the acknowledgement of the key transaction still leaves a cleanup
 // pointer even though createPortabilityCollection never returned its root.
 const commitId=randomUUID(),commit=new ImportDiscard(f.workspace,commitId);let keyId=null,lostCommit=true;
 f.workspace.openCatalogue=async function(...args){const db=await open.apply(this,args),run=db.run;let keyPublication=false;db.run=async function(sql,...params){const result=await run.call(this,sql,...params);if(sql.startsWith('INSERT INTO state')&&params[0]==='portability:'+keyId+':head')keyPublication=true;if(sql==='COMMIT'&&keyPublication&&lostCommit){lostCommit=false;throw Error('Key commit acknowledgement lost');}return result;};return db;};
 try{await assert.rejects(commit.prepare(value(commitId,2),keys,{checkpoint:(stage,receipt)=>{if(stage==='cancel-journalled')keyId=receipt.keyOwners.id;}}),/Key commit acknowledgement lost/);}finally{f.workspace.openCatalogue=open;}
 const committed=await commit.pending();assert.equal(committed.preparing,true);assert.ok(await rows(committed.keyOwners)>0);await commit.discard(commitId);assert.equal(await rows(committed.keyOwners),0);assert.equal(await commit.pending(),null);
 // Every retained key must still identify the corresponding owner; native
 // encryption alone does not substitute for this identity check.
 const third=await prepare(),badRows=async function*(){for await(const entry of portabilityCollection(f.workspace,third.receipt.keyOwners).entries())yield {...entry,...(entry.relative==='Child 96'?{vaultId:randomUUID()}: {})};};
 third.receipt.keyOwners=await createPortabilityCollection(f.workspace,badRows());await third.discard.save(third.receipt);await assert.rejects(third.discard.pending(),{code:'STORAGE_DELETE_STATE'});
 // Existing array receipts remain readable and complete without retaining keys.
 const legacyId=randomUUID(),legacy=new ImportDiscard(f.workspace,legacyId),old={...first.receipt,id:legacyId,phase:'prepared',owners:owners.map(entry=>({...entry,key:keys.get(entry.relative).key.toString('base64')}))};delete old.keyOwners;
 await legacy.save(old);assert.equal((await legacy.pending()).owners.length,97);assert.equal(await legacy.ownedDirectory(destination,old),'workspace.observanda');old.phase='complete';await legacy.save(old);assert.equal((await legacy.pending()).owners.some(entry=>Object.hasOwn(entry,'key')),false);
 assert.ok(Buffer.byteLength(serialize(completed))<16384);
});

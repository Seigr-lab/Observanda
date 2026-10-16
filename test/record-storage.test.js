import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {initializeLocation,copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {clearVault,seal} from '../src/encryption.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {catalogueDescriptor} from '../src/research-catalogue.js';
import {catalogueFormat} from '../src/catalogue-format.js';
import {withStoredRecord,verifyStoredRecord} from '../src/record-storage.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {digest,serialize} from '../src/storage-format.js';
import {CATALOGUE_ARCHIVE} from '../src/postgres.js';
import {interruptWorkspace} from './fixtures/interrupt-workspace.js';
import {preparation,event,assessment} from './fixtures/attempts.js';
import {RecordDocument,withRecordDocument} from '../src/record-document.js';
import {RecordAttemptIndex} from '../src/record-attempt-index.js';
import {RecordBlockStore} from '../src/record-block-store.js';
import {attemptFactPosition} from '../src/record-attempt-context.js';
import {RecordValues} from '../src/record-values.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
const runFacts=()=>{const p=preparation();return {version:1,preparations:[p],events:[event(p)],assessments:[assessment(p)]};};

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-storage-upgrade-')),root=path.join(directory,'source');
 const access=await createAccess('','synthetic storage upgrade password'),vault=takeCreatedVault(access);
 await initializeLocation(root,upgradeNotebook(sampleNotebook()),access,vault);
 const workspace=new Workspace(root,vault),base=await workspace.read(),record=structuredClone(base.book.entries[0]);
 record.attachments=[];record.figures=[];record.sections=Array.from({length:257},(_,i)=>({id:randomUUID(),title:'Observation '+i,body:'Exact notes '+i+' '+('α🔬 '.repeat(100))}));
 record.sections[0].body='Long scalar α🔬 \uD800 \n\t\\" '.repeat(2000);
 t.after(async()=>{clearVault(vault);await rm(directory,{recursive:true,force:true});});
 return {directory,workspace,vault,base,record,service:new ResearchRecords(workspace,{})};
}
async function save(f,record=f.record,previous=f.base.book.entries[0]){
 const result=await f.service.save({workspaceId:f.base.book.id,changes:[{id:record.id,expectedRevision:recordRevision(previous),record}]},{recordIds:[record.id]});return result.book.entries[0];
}
const storageVersion=record=>digest(serialize(record));
async function manifest(workspace,record){return workspace.catalogue(store=>withStoredRecord(store,record.id,storageVersion(record),({value,blocks})=>({value,blocked:!!blocks})));}

test('large-record saves atomically adopt blocks, retain old originals and preserve exact revisions through edits',async t=>{
 const f=await fixture(t),original=f.base.book.entries[0];
 assert.equal(await f.workspace.catalogue(store=>catalogueFormat(store.db)),3);
 assert.equal((await manifest(f.workspace,original)).blocked,false);
 assert.deepEqual(await f.workspace.read(),f.base);
 const first=await save(f);assert.deepEqual(first.sections,f.record.sections);
 assert.equal(await f.workspace.catalogue(store=>catalogueFormat(store.db)),6);
 const retained=await manifest(f.workspace,first);assert.equal(retained.blocked,true);assert.ok(Buffer.byteLength(serialize(retained.value))<512);
 assert.deepEqual((await manifest(f.workspace,original)).value,original);
 const next=structuredClone(first);next.sections[256].body='Amended late observation';const second=await save(f,next,first);
 await f.workspace.catalogue(async store=>{
  assert.deepEqual(await store.record(first.id,storageVersion(first)),first);
  assert.deepEqual(await store.record(second.id,storageVersion(second)),second);
  const read=RecordValueTree.prototype.read;
  RecordValueTree.prototype.read=async function(revision){assert.notEqual((await this.node(revision)).type,'string','Verification must not assemble long strings');return read.call(this,revision);};
  try{await verifyStoredRecord(store,first.id,storageVersion(first));await verifyStoredRecord(store,second.id,storageVersion(second));}finally{RecordValueTree.prototype.read=read;}
  const controller=new AbortController();controller.abort(Error('Stopped verification'));
  await assert.rejects(verifyStoredRecord(store,first.id,storageVersion(first),{signal:controller.signal}),/Stopped verification/);
  const maximum=await store.db.get('SELECT MAX(octet_length(payload)) AS bytes FROM state WHERE starts_with(slot,$1)','record-block:');assert.ok(maximum.bytes<128*1024);
  await withStoredRecord(store,second.id,storageVersion(second),async({value,blocks})=>{
   let reads=0;const get=store.db.get.bind(store.db);store.db.get=async(...args)=>{reads++;return get(...args);};
   try{const page=await blocks.tree().page(value.root,['sections'],{offset:253,limit:4});assert.deepEqual(page.values,second.sections.slice(253));assert.ok(reads<60,reads+' selected-block reads');}finally{store.db.get=get;}
  });
  await store.verify(catalogueDescriptor(f.base.book));
 });
 await assert.rejects(save(f,{...first,title:'Stale revision'},first),{code:'RECORD_CHANGED'});
});

test('a failed first block save rolls back the storage generation, scope data, history and head together',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  await store.putRecord(f.record);assert.equal(await catalogueFormat(store.db),4);throw Error('Interrupted before commit');
 })),/Interrupted before commit/);
 assert.deepEqual(await f.workspace.read(),f.base);
 await f.workspace.catalogue(async store=>{
  assert.equal(await catalogueFormat(store.db),3);
  assert.equal(Number((await store.db.get("SELECT count(*) AS n FROM state WHERE starts_with(slot,'record-block:')")).n),0);
  assert.equal(await store.db.get('SELECT 1 FROM records WHERE id=$1 AND revision=$2',f.record.id,storageVersion(f.record)),undefined);
 });
 const saved=await save(f);assert.equal((await manifest(f.workspace,saved)).blocked,true);
});

test('process termination during the first block write leaves an ordinary generation-three workspace',async t=>{
 const f=await fixture(t);await interruptWorkspace(f.workspace.root,f.vault,'record-block-write',{record:f.record});
 assert.deepEqual(await f.workspace.read(),f.base);
 await f.workspace.catalogue(async store=>{
  assert.equal(await catalogueFormat(store.db),3);
  assert.equal(Number((await store.db.get("SELECT count(*) AS n FROM state WHERE starts_with(slot,'record-block:')")).n),0);
 });
 const record=await save(f);assert.deepEqual(record.sections,f.record.sections);
});

for(const indexed of [false,true])test(`normal and fresh-key backups retain ${indexed?'run-indexed':'ordinary'} block roots, histories and format fences and reject damaged blocks`,async t=>{
 const f=await fixture(t);if(indexed)f.record.attempt=runFacts();const generation=indexed?12:6,first=await save(f),second=await save(f,{...first,title:'A later interpretation'},first),expected=await f.workspace.read(),history=await f.workspace.history(),retained=(await manifest(f.workspace,second)).value,root=retained.root;
 if(indexed){assert.equal(retained.version,2);assert.deepEqual(retained.attemptIndex,(await manifest(f.workspace,first)).value.attemptIndex);}
 const backup=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'backup')),{vault:f.vault});
 const header=JSON.parse((await readFile(path.join(backup,CATALOGUE_ARCHIVE),'utf8')).split('\n')[0]);assert.deepEqual(header,{format:'observanda-postgresql-archive',version:3,catalogueVersion:generation});
 const restored=new Workspace(backup,f.vault);assert.deepEqual(await restored.read(),expected);assert.deepEqual(await restored.history(),history);
 const access=await createAccess('','different synthetic recovery password'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const target=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'fresh')),access,vault,f.vault),fresh=new Workspace(target,vault);
 assert.deepEqual(await fresh.read(),expected);assert.deepEqual(await fresh.history(),history);assert.equal((await manifest(fresh,second)).value.root,root);
 await fresh.catalogue(async store=>{assert.equal(await catalogueFormat(store.db),generation);assert.deepEqual(await store.record(first.id,storageVersion(first)),first);await store.verify(catalogueDescriptor(expected.book));
  if(indexed)await withRecordDocument(store,second.id,storageVersion(second),async document=>{assert.deepEqual(document.attemptIndex,retained.attemptIndex);assert.equal(await attemptFactPosition(document,'events',second.attempt.events[0].id),0);const index=await RecordAttemptIndex.open(document);await index.verify();assert.equal((await index.currentWindow('events')).total,second.attempt.events.length);});
 });
 await assert.rejects(new Workspace(target,f.vault).read(),{code:'ENCRYPTION_DAMAGED'});
 // Mislabelled archives must fail before publishing a database binding.
 const downgraded=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'downgraded')),{vault:f.vault}),file=path.join(downgraded,CATALOGUE_ARCHIVE),raw=await readFile(file,'utf8');
 await writeFile(file,JSON.stringify({format:'observanda-postgresql-archive',version:2})+raw.slice(raw.indexOf('\n')));
 await assert.rejects(new Workspace(downgraded,f.vault).read(),{code:'CATALOGUE_DAMAGED'});
 // Authenticated outer storage does not excuse a damaged notebook envelope.
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const slot='record-block:'+second.notebookId+':1:value:'+root,row=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot),value=store.decode('state',slot,row.payload),bytes=Buffer.from(value.content,'base64');bytes[bytes.length-1]^=1;value.content=bytes.toString('base64');await store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',store.encode('state',slot,value),slot);
 }));
 await assert.rejects(copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'damaged-copy')),{vault:f.vault}),{code:'ENCRYPTION_DAMAGED'});
 await assert.rejects(encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'damaged-fresh')),access,vault,f.vault),{code:'ENCRYPTION_DAMAGED'});
 assert.deepEqual(await restored.read(),expected);
});

test('the first run index upgrades atomically, rejects damaged descriptors and retains legacy originals',async t=>{
 const f=await fixture(t),original=f.base.book.entries[0],record={...original,attempt:runFacts()};f.record=record;
 await assert.rejects(f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  await store.putRecord(record);assert.equal(await catalogueFormat(store.db),12);throw Error('Interrupted index adoption');
 })),/Interrupted index adoption/);
 await f.workspace.catalogue(async store=>{assert.equal(await catalogueFormat(store.db),3);assert.equal(Number((await store.db.get("SELECT count(*) AS n FROM state WHERE starts_with(slot,'record-block:')")).n),0);});assert.deepEqual(await f.workspace.read(),f.base);
 const saved=await save(f),revision=storageVersion(saved),expected=await f.workspace.read();assert.equal((await manifest(f.workspace,saved)).value.version,2);assert.deepEqual((await manifest(f.workspace,original)).value,original);
 await f.workspace.catalogue(store=>withStoredRecord(store,saved.id,revision,async({value,blocks,row})=>{
  const hash=value.attemptIndex.root.hash,slot=blocks.slot('index',hash),cipher=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot),envelope=store.decode('state',slot,cipher.payload);
  assert.throws(()=>new RecordBlockStore(store,row.scope_id,row.generation,f.vault.key).decode(slot,envelope,hash),{code:'ENCRYPTION_DAMAGED'});
 }));
 for(const damage of ['source','count','downgrade']){
  await assert.rejects(f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
   if(damage==='downgrade')await store.db.run('UPDATE catalogue_format SET version=11');
   else await withStoredRecord(store,saved.id,revision,async({value,key,row})=>{
    if(damage==='source')value.attemptIndex.source='0'.repeat(64);else value.attemptIndex.events++;
    await store.db.run('UPDATE records SET payload=$1 WHERE id=$2 AND revision=$3',seal(Buffer.from(serialize(value)),key,store.recordAAD(saved.id,revision,row.scope_id,row.generation)),saved.id,revision);
   });
   await verifyStoredRecord(store,saved.id,revision);
  })),{code:'CATALOGUE_DAMAGED'});
  assert.deepEqual(await f.workspace.read(),expected);
 }
});

test('version-one run indexes remain unchanged until an atomic counted-index append and survive its rollback',async t=>{
 const f=await fixture(t);f.record={...f.base.book.entries[0],attempt:runFacts()};const saved=await save(f),revision=storageVersion(saved);let legacy;
 await f.workspace.withLock(()=>f.workspace.catalogue(store=>withStoredRecord(store,saved.id,revision,async({value,key,row,blocks})=>{
  const document=new RecordDocument(blocks,value.root),index=new RecordAttemptIndex(document,value.attemptIndex),old=new RecordAttemptIndex(document,{...value.attemptIndex,version:1,root:null});
  for await(const entry of index.index.entries(index.value))if(!entry.id.startsWith('current:'))old.value.root=await old.index.change(old.value.root,entry.id,entry.revision);
  await old.index.flush(old.value.root);await blocks.flush();legacy=old.value;value.attemptIndex=legacy;
  await store.db.run('UPDATE records SET payload=$1 WHERE id=$2 AND revision=$3',seal(Buffer.from(serialize(value)),key,store.recordAAD(saved.id,revision,row.scope_id,row.generation)),saved.id,revision);
  await store.db.run('UPDATE catalogue_format SET version=11');
 })));
 await f.workspace.catalogue(store=>store.verifySnapshot(undefined,f.base.book.id));
 const values=new RecordValues(f.workspace),target={workspaceId:f.base.book.id,recordId:saved.id},title=await values.read({...target,field:'title'});
 await values.save({...target,field:'title',expectedRevision:title.revision,value:{value:'Prose edit keeps original index'}});assert.equal(await f.workspace.catalogue(store=>catalogueFormat(store.db)),11);
 const added=event(saved.attempt.preparations[0]),field='attempt:event:'+added.id,base=await values.read({...target,field}),command={...target,field,expectedRevision:base.revision,value:{value:added}},head=(await f.workspace.outline()).etag,finish=ResearchCatalogue.prototype.finishRecordChanges;
 t.mock.method(ResearchCatalogue.prototype,'finishRecordChanges',async function(...args){await finish.apply(this,args);throw Error('Interrupted counted index upgrade');});
 await assert.rejects(values.save(command),/Interrupted counted index upgrade/);ResearchCatalogue.prototype.finishRecordChanges.mock.restore();assert.equal((await f.workspace.outline()).etag,head);assert.equal(await f.workspace.catalogue(store=>catalogueFormat(store.db)),11);
 await values.save(command);await f.workspace.catalogue(async store=>{
  assert.equal(await catalogueFormat(store.db),12);await store.verifySnapshot(undefined,f.base.book.id);
  const member=await store.member(await store.snapshot(),saved.id);await withRecordDocument(store,member.id,member.revision,async document=>{assert.equal(document.attemptIndex.version,2);assert.equal((await (await RecordAttemptIndex.open(document)).currentWindow('events')).total,2);});
 });
 assert.deepEqual((await manifest(f.workspace,saved)).value.attemptIndex,legacy);assert.deepEqual(await f.workspace.catalogue(store=>store.record(saved.id,revision)),saved);
});

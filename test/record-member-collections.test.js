import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {RecordMemberCollections,memberCollectionCount} from '../src/record-member-collections.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {RecordWriting} from '../src/record-writing.js';
import {catalogueFormat} from '../src/catalogue-format.js';
import {SnapshotIndex} from '../src/snapshot-index.js';
import {validateRecordChanges} from '../src/model.js';

test('record membership keeps growing identities in counted references and selects late values without full originals',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-member-collections-')),book=sampleNotebook();
 const first=book.entries[0],second=book.entries[1];
 book.entries=[first,second];
 first.sections=Array.from({length:65},(_,i)=>({id:randomUUID(),title:'Small '+i,body:''}));
 second.sections=Array.from({length:513},(_,i)=>({id:randomUUID(),title:'Large '+i,body:''}));
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 await f.workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(),a=await store.member(snapshot,first.id),b=await store.member(snapshot,second.id),items=new RecordMemberCollections(store);
  assert.ok(await catalogueFormat(store.db)>=6);assert.equal(a.sections,undefined);assert.equal(b.sections,undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(b))<4096);
  assert.ok(Math.abs(JSON.stringify(a.collections.sections).length-JSON.stringify(b.collections.sections).length)<10);
  assert.equal(memberCollectionCount(b,'sections'),513);
  let reads=0;const get=store.db.get.bind(store.db);store.db.get=async(...args)=>{reads++;return get(...args);};
  try{assert.equal(await items.position(b,'sections',second.sections[512].id),512);assert.deepEqual(await Array.fromAsync(items.ids(b,'sections',{offset:510,limit:3})),second.sections.slice(510).map(s=>s.id));assert.ok(reads<100,reads+' selected identity reads');}finally{store.db.get=get;}
  const changed={...second,sections:[{...second.sections[0],id:first.sections[64].id}]};
  const validation=await new SnapshotIndex(store).validationRows(snapshot.membership,[changed]);
  assert.throws(()=>validateRecordChanges(snapshot.metadata,[changed],validation),{code:'INVALID'});
  await new SnapshotIndex(store).verify(snapshot);
 });
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Membership assembled a complete record');});
 const writing=new RecordWriting(f.workspace),target={workspaceId:book.id,recordId:second.id,sectionId:second.sections[512].id},base=await writing.read(target);
 await writing.save({...target,expectedRevision:base.revision,value:{title:'Still addressable',body:'A selected late edit'}});
 assert.equal((await writing.read(target)).value.body,'A selected late edit');await f.workspace.catalogue(store=>store.verifySnapshot(undefined,book.id));
 t.mock.restoreAll();
 const source=await f.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),second.id);return store.record(row.id,row.revision);});
 const changed=structuredClone(source);changed.sections.reverse();
 await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:changed.id,record:changed,expectedRevision:recordRevision(source)}]},{recordIds:[changed.id]});
 assert.equal((await writing.read(target)).value.title,'Still addressable');await f.workspace.catalogue(store=>store.verifySnapshot(undefined,book.id));
});

test('membership reference upgrade is transactional and duplicate identities never become visible',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-member-rollback-')),book=sampleNotebook(),f=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const initial=await f.workspace.catalogue(store=>catalogueFormat(store.db));
 await assert.rejects(f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const row=await store.member(await store.snapshot(),book.entries[0].id),ids=Array.from({length:65},()=>randomUUID());ids[64]=ids[0];
  await new RecordMemberCollections(store).retain({...row,sections:ids});
 })),{code:'CATALOGUE_DAMAGED'});
 assert.equal(await f.workspace.catalogue(store=>catalogueFormat(store.db)),initial);
 await f.workspace.catalogue(store=>store.verifySnapshot(undefined,book.id));
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto,{randomUUID} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {SnapshotIndex} from '../src/snapshot-index.js';
import {ResearchRecords,historicalRecordValue,recordRevision} from '../src/research.js';
import {withRecordWriteEncoding,recordWriteEncoding,recordWriteDisplay} from '../src/record-write-encoding.js';
import {digest,serialize} from '../src/storage-format.js';
import {revisionText} from '../src/web/revision-model.js';
import {publicationDescriptor} from '../src/publication-record-descriptor.js';
import {recordQueryDocument} from '../src/web/record-query.js';
import {recordPublicationSummary} from '../src/web/record-publication-summary.js';
import {publicationCard} from '../src/web/publication-card.js';
import {recordEditionInventory} from '../src/web/publication-inventory.js';
import {verifyStoredRecord} from '../src/record-storage.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {legacyRecords} from './legacy-records.js';

function source(){const book=upgradeNotebook(sampleNotebook());book.entries=[book.entries[2]];return book;}
const identities=record=>({storage:digest(serialize(record)),content:digest(revisionText(record))});
async function measured(t,record,run){
 const expected=identities(record),counts={storage:0,content:0},create=crypto.createHash,oneShot=crypto.hash;
 const count=result=>{const value=Buffer.isBuffer(result)?result.toString('hex'):result;for(const kind of Object.keys(counts))if(value===expected[kind])counts[kind]++;return result;};
 const spy=t.mock.method(crypto,'createHash',function(...args){
  const hash=create.apply(this,args),finish=hash.digest;
  hash.digest=function(...args){return count(finish.apply(this,args));};return hash;
 });
 const single=t.mock.method(crypto,'hash',function(...args){return count(oneShot.apply(this,args));});
 syncBuiltinESMExports();
 try{return {result:await run(),counts,expected};}
 finally{spy.mock.restore();single.mock.restore();syncBuiltinESMExports();}
}
async function verify(workspace,record,{compact=false}={}){
 const expected=identities(record);
 await workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(),row=await store.member(snapshot,record.id);
  assert.equal(row.revision,expected.storage);assert.deepEqual(await store.record(row.id,row.revision),record);
  await verifyStoredRecord(store,row.id,row.revision);await store.verifySnapshot(undefined,snapshot.metadata.id);await store.verifyRecordHistory(row.id);
  const queries=[];for await(const query of store.queryDocuments([row],snapshot.metadata,{revisions:true,publication:true,cards:true,inventory:true,publicationDetails:true,stored:true}))queries.push(query);
  assert.equal(queries.length,1);assert.equal(queries[0].revision,expected.content);
  assert.equal(JSON.stringify(queries[0].publicationDescriptor),JSON.stringify(publicationDescriptor(record)));
  if(compact){
   const query={...recordQueryDocument(record),publication:recordPublicationSummary(record),publicationCard:publicationCard(record),publicationDescriptor:publicationDescriptor(record),editionInventory:recordEditionInventory(record,expected.content),recordRevision:expected.content};
   assert.equal(row.queryRevision,digest(serialize(query)),'Compact query bytes and property order changed');
  }
 });
}

test('prepared writes own immutable records, reject executable values and expire on failure',async()=>{
 const book=source(),record=book.entries[0],metadata={...book,entries:[]},owner={},before=structuredClone(record),expected=identities(record);let owned,late;
 await withRecordWriteEncoding(owner,record,metadata,async(receipt,value)=>{
  owned=value;assert.notEqual(value,record);assert.ok(Object.isFrozen(value));assert.ok(Object.isFrozen(value.tags));
  assert.equal(receipt.encoding.revision,expected.storage);assert.equal(receipt.contentRevision,expected.content);
  assert.equal(recordWriteEncoding(owner,record),null);assert.equal(recordWriteEncoding({},value),null);assert.equal(recordWriteEncoding(owner,value,{}),null);
  assert.equal(recordWriteDisplay(owner,value,metadata),value);assert.throws(()=>value.tags.push('forged'),TypeError);
  await Promise.resolve();record.title='Caller changed during await';record.tags.push('caller');assert.deepEqual(value,before);
  late=new Promise(resolve=>setImmediate(()=>resolve(recordWriteEncoding(owner,value,metadata))));
 });
 assert.equal(await late,null);assert.equal(recordWriteEncoding(owner,owned),null);assert.equal(Object.isFrozen(record),false);
 const failure=Error('Synthetic interrupted write');await assert.rejects(withRecordWriteEncoding(owner,record,metadata,async(_receipt,value)=>{owned=value;throw failure;}),error=>error===failure);
 assert.equal(recordWriteEncoding(owner,owned),null);
 await withRecordWriteEncoding(owner,record,metadata,async(receipt,value)=>{assert.notEqual(value,owned);assert.equal(receipt.contentRevision,identities(record).content);});
 const getter={...record};Object.defineProperty(getter,'body',{enumerable:true,get(){assert.fail('Record getter was invoked');}});
 await assert.rejects(withRecordWriteEncoding(owner,getter,metadata,()=>assert.fail('Invalid source consumed')),{code:'INVALID'});
 const hook={...record,toJSON(){assert.fail('Record serialization hook was invoked');}};
 await assert.rejects(withRecordWriteEncoding(owner,hook,metadata,()=>assert.fail('Invalid source consumed')),{code:'INVALID'});
});

test('prepared legacy originals keep their storage spelling and independently upgraded display identity',async()=>{
 const book=legacyRecords(source());book.formatVersion=12;
 const record=book.entries[0],metadata={...book,entries:[]},owner={},before=structuredClone(record),display=historicalRecordValue(metadata,record);
 assert.notDeepEqual(display,record);
 await withRecordWriteEncoding(owner,record,metadata,async(receipt,value)=>{
  const retained=recordWriteDisplay(owner,value,metadata);assert.notEqual(retained,value);assert.ok(Object.isFrozen(retained));assert.ok(Object.isFrozen(retained.contributors));
  assert.deepEqual(retained,display);assert.equal(receipt.encoding.revision,digest(serialize(before)));assert.equal(receipt.contentRevision,digest(revisionText(display)));
  await Promise.resolve();record.author='Caller changed legacy author';assert.deepEqual(value,before);assert.deepEqual(retained,display);
 });
});

test('public full and selected saves reuse exact encoding identities through query and history storage',async t=>{
 const temporary=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(temporary,'observanda-write-encoding-'));let fixture;
 t.after(async()=>{if(fixture)clearVault(fixture.vault);assert.equal(path.dirname(directory),temporary);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 fixture=await encryptedFixture(directory,source());const {workspace}=fixture;let saved=(await workspace.read()).book.entries[0];
 await t.test('full compatibility save hashes its admitted original once in each required order',async t=>{
  const current=await workspace.read();current.book.entries[0].title='Exact compact full save';const put=ResearchCatalogue.prototype.put;let observed,expected;
  const spy=t.mock.method(ResearchCatalogue.prototype,'put',async function(book,...args){expected=structuredClone(book.entries[0]);observed=await measured(t,expected,()=>put.call(this,book,...args));return observed.result;});
  try{await workspace.save(current.book,current.etag);}finally{spy.mock.restore();}
  assert.deepEqual(observed.counts,{storage:1,content:1});saved=expected;await verify(workspace,saved,{compact:true});
 });
 await t.test('public selected replacement shares its blocked original identity with the derived query and history',async t=>{
  const record={...structuredClone(saved),title:'Exact blocked selected save',sections:Array.from({length:9},(_,i)=>({id:randomUUID(),title:'Observation '+i,body:'Measured detail '.repeat(700)}))};
  assert.ok(Buffer.byteLength(serialize(record))>65535);const commit=ResearchCatalogue.prototype.commitChanges;let observed,expected;
  const spy=t.mock.method(ResearchCatalogue.prototype,'commitChanges',async function(head,current,metadata,modified,...args){assert.equal(modified.length,1);expected=structuredClone(modified[0]);observed=await measured(t,expected,()=>commit.call(this,head,current,metadata,modified,...args));return observed.result;});
  try{await new ResearchRecords(workspace,{}).save({workspaceId:(await workspace.outline()).metadata.id,changes:[{id:record.id,expectedRevision:recordRevision(saved),record}]},{receipt:true});}finally{spy.mock.restore();}
  assert.deepEqual(observed.counts,{storage:1,content:1});saved=expected;await verify(workspace,saved);
 });
 await t.test('caller mutation during awaited admission and query cannot change admitted storage, summary or history',async t=>{
  const caller={...structuredClone(saved),title:'Admitted before await'},expected=structuredClone(caller),putQuery=ResearchCatalogue.prototype.putQuery,get=SnapshotIndex.prototype.get;let calls=0,admissionMutated=false;
  const admission=t.mock.method(SnapshotIndex.prototype,'get',async function(root,id){const row=await get.call(this,root,id);if(id===caller.id&&!admissionMutated){admissionMutated=true;caller.title='Mutated caller during admission';caller.sections[0].body='Changed while checking prior membership';}return row;});
  const spy=t.mock.method(ResearchCatalogue.prototype,'putQuery',async function(record,metadata){
   calls++;assert.notEqual(record,caller);assert.ok(Object.isFrozen(record.sections[0]));await Promise.resolve();
   caller.title='Mutated caller after admission';caller.sections[0].body='Mutated nested caller value';
   return putQuery.call(this,record,metadata);
  });
  try{await workspace.withLock(()=>workspace.catalogue(async store=>{const head=await store.head(),snapshot=await store.snapshot(head);await store.commitChanges(head,snapshot,snapshot.metadata,[caller]);}));}finally{spy.mock.restore();admission.mock.restore();}
  assert.equal(admissionMutated,true);assert.equal(calls,1);assert.equal(caller.title,'Mutated caller after admission');assert.equal(Object.isFrozen(caller.sections[0]),false);saved=expected;await verify(workspace,saved);
  // A later use of the same caller object must acquire its new identities.
  await workspace.withLock(()=>workspace.catalogue(async store=>{const head=await store.head(),snapshot=await store.snapshot(head),observed=await measured(t,caller,()=>store.commitChanges(head,snapshot,snapshot.metadata,[caller]));assert.deepEqual(observed.counts,{storage:1,content:1});}));
  saved=structuredClone(caller);await verify(workspace,saved);
 });
 await t.test('public storage and query entry points self-hash and legacy query fallback reuses its computed descriptor identity',async t=>{
  const rollback=Error('Discard standalone unreferenced revisions'),record={...structuredClone(saved),title:'First standalone original'},head=(await workspace.outline()).etag;
  await assert.rejects(workspace.withLock(()=>workspace.catalogue(async store=>{
   for(const title of ['First standalone original','Mutated standalone original']){
    record.title=title;const observed=await measured(t,record,()=>store.putRecord(record,{revision:'0'.repeat(64)}));
    assert.equal(observed.result,true);assert.deepEqual(observed.counts,{storage:1,content:0});assert.deepEqual(await store.record(record.id,observed.expected.storage),record);
   }
   const snapshot=await store.snapshot(),query=await measured(t,saved,()=>store.putQuery(saved,snapshot.metadata));assert.deepEqual(query.counts,{storage:0,content:1});
   throw rollback;
  })),error=>error===rollback);
  assert.equal((await workspace.outline()).etag,head);
  await workspace.catalogue(async store=>{
   const snapshot=await store.snapshot(),row={...await store.member(snapshot,saved.id),queryRevision:undefined,summaryRevision:undefined};
   const observed=await measured(t,saved,async()=>{const rows=[];for await(const value of store.queryDocuments([row],snapshot.metadata,{revisions:true,publicationDetails:true}))rows.push(value);return rows;});
   assert.deepEqual(observed.counts,{storage:1,content:1});assert.equal(JSON.stringify(observed.result[0].publicationDescriptor),JSON.stringify(publicationDescriptor(saved)));
  });
 });
});

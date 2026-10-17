import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {withCatalogueVerification} from '../src/catalogue-verification.js';
import {withRecordDocument} from '../src/record-document.js';
import {withStoredRecord} from '../src/record-storage.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {recordEncoding,recordContentRevision} from '../src/record-encoding.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {catalogueDescriptor} from '../src/research-catalogue.js';
import {retainedRecordDisplay} from '../src/record-history-display.js';
import {RetainedRecordDocuments} from '../src/retained-record-documents.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';

async function originals(workspace,id){
 return workspace.catalogue(async store=>{
  const result=[];
  for await(const {revision} of store.db.rows('SELECT revision FROM records WHERE id=$1',[id]))await withStoredRecord(store,id,revision,async({value,row})=>{
   assert.equal(value.format,'observanda-record-blocks');const record=await store.record(id,revision);
   result.push({id,revision,root:value.root,scope:row.scope_id,generation:row.generation,encoding:{...recordEncoding(record),contentRevision:recordContentRevision(record)}});
  });
  return result;
 });
}
async function measured(t,sources,operation){
 const calls=new Map(sources.map(row=>[row.root,{storage:0,content:0}])),json=RecordValueTree.prototype.json;
 const spy=t.mock.method(RecordValueTree.prototype,'json',async function*(root,options={}){
  if((options.depth??0)===0&&calls.has(root))calls.get(root)[options.canonical?'content':'storage']++;
  yield* json.call(this,root,options);
 });
 try{await operation();return [...calls.values()];}finally{spy.mock.restore();}
}

test('one native audit shares exact encodings across snapshots, history and retained materials without sharing semantic admission',async t=>{
 const temporary=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(temporary,'observanda-encoding-audit-'));let f;
 t.after(async()=>{if(f)clearVault(f.vault);assert.equal(path.dirname(directory),temporary);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const book=upgradeNotebook(sampleNotebook()),record={...book.entries[0],relations:[],figures:[],attachments:[],contributors:[],sections:Array.from({length:8},(_,i)=>({id:randomUUID(),title:'Observation '+i,body:('Exact observation '+i+' \ud83d\udd2c\n').repeat(700)}))};book.entries=[record];
 f=await encryptedFixture(directory,book);const {workspace}=f,materials=new ResearchMaterials(workspace),retained=new RetainedRecordDocuments(workspace),references=[];
 let current=(await workspace.read()).book.entries[0];references.push(await materials.pinRecord(record.id,recordRevision(current)));
 await new ResearchRecords(workspace,{}).save({workspaceId:book.id,changes:[{id:record.id,expectedRevision:recordRevision(current),record:{...current,title:'A second retained revision'}}]},{receipt:true});
 current=await workspace.catalogue(async store=>store.record(record.id,(await store.member(await store.snapshot(),record.id)).revision));references.push(await materials.pinRecord(record.id,recordRevision(current)));
 const sources=await originals(workspace,record.id);assert.equal(sources.length,2);
 await t.test('complete catalogue audit hashes each original once in each required order',async()=>{
  assert.deepEqual(await measured(t,sources,()=>workspace.catalogue(store=>store.verify(catalogueDescriptor(book)))),sources.map(()=>({storage:1,content:1})));
 });
 await t.test('repeated real consumers reuse raw proof while incompatible metadata still fails',async()=>{
  const counts=await measured(t,sources,()=>workspace.catalogue(store=>withCatalogueVerification(store,verified=>workspace.inspectCatalogue(store,async()=>{
   for await(const {id} of store.db.rows('SELECT id FROM snapshots ORDER BY ordinal'))await store.verifySnapshot(id,book.id,verified);
   const snapshot=await store.snapshot(),row=await store.member(snapshot,record.id);
   await assert.rejects(retainedRecordDisplay(store,record.id,row.revision,{...snapshot.metadata,notebooks:[]}),{code:'INVALID'});
   for(let i=0;i<3;i++){
    await store.verifyRecordHistory(record.id);
    for(const ref of references)await retained.open(ref,async(document,member)=>assert.deepEqual(await document.encoding(),sources.find(source=>source.revision===member.revision).encoding),{verify:true});
    await materials.verifySnapshot({readOnly:true});
   }
  }))));
  assert.deepEqual(counts,sources.map(()=>({storage:1,content:1})));
 });
 await t.test('a new audit recomputes proof, while writer-owned READ COMMITTED never reuses it',async()=>{
  assert.deepEqual(await measured(t,sources,()=>workspace.catalogue(store=>store.verify(catalogueDescriptor(book)))),sources.map(()=>({storage:1,content:1})));
  const row=sources[0];const counts=await measured(t,[row],()=>workspace.withLock(()=>workspace.catalogue(store=>withCatalogueVerification(store,async verified=>{
   assert.equal(verified.stableSnapshot,undefined);for(let i=0;i<2;i++)await withRecordDocument(store,row.id,row.revision,document=>document.encoding());
  }))));assert.deepEqual(counts,[{storage:2,content:2}]);
 });
 await t.test('fresh-key archive recovery preserves original and canonical identities and retained references',async()=>{
  const access=await createAccess('','Encoding audit recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
  const copied=await encryptedCopy(await copyPlan(workspace.root,path.join(directory,'backup')),access,vault,f.vault),restored=new Workspace(copied,vault);
  assert.deepEqual((await originals(restored,record.id)).sort((a,b)=>a.revision.localeCompare(b.revision)),sources.toSorted((a,b)=>a.revision.localeCompare(b.revision)));
  for(const ref of references)await new RetainedRecordDocuments(restored).check(ref);
  assert.deepEqual(await measured(t,sources,()=>restored.catalogue(store=>store.verify(catalogueDescriptor(book)))),sources.map(()=>({storage:1,content:1})));
 });
 await t.test('later encrypted-body corruption is rejected by a new audit',async()=>{
  const row=sources[0];let slot;
  await workspace.withLock(()=>workspace.catalogue(store=>withRecordDocument(store,row.id,row.revision,async document=>{
   slot=document.blocks.slot('value',await document.reference(['sections','0','body']));const value=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot),payload=Buffer.from(value.payload);payload[payload.length-1]^=1;
   await store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',payload,slot);
  })));
  await assert.rejects(workspace.catalogue(store=>withCatalogueVerification(store,()=>withRecordDocument(store,row.id,row.revision,document=>document.encoding()))),{code:'ENCRYPTION_DAMAGED'});
 });
});

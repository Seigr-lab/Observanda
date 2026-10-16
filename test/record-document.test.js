import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {withRecordDocument} from '../src/record-document.js';
import {recordEncoding,recordContentRevision} from '../src/record-encoding.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {validateRecordDocument} from '../src/record-document-validation.js';
import {validateRecordChanges} from '../src/model.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-document-')),f=await encryptedFixture(directory,sampleNotebook()),before=await f.workspace.read();
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 return {...f,before,record:before.book.entries[0]};
}
test('read-only document selection never writes decomposed legacy envelopes',async t=>{
 const f=await fixture(t);
 await f.workspace.catalogue(async store=>{
  const original=store.db.run.bind(store.db);store.db.run=async(sql,...args)=>{if(!/^SELECT\b/i.test(sql.trim()))throw Error('A record read must not write');return original(sql,...args);};
  try{await withRecordDocument(store,f.record.id,recordEncoding(f.record).revision,async document=>{
   assert.deepEqual((await document.field(['body'])).value,f.record.body);
   assert.deepEqual(await document.encoding(),{...recordEncoding(f.record),contentRevision:recordContentRevision(f.record)});
   await assert.rejects(document.replace(['title'],'Unexpected mutation'),{code:'INVALID'});
  });}finally{store.db.run=original;}
 });
});

test('stored-block validation agrees with saved record rules and detects identities across distant sections',async t=>{
 const f=await fixture(t),saved=recordEncoding(f.record).revision;
 const mutations=[
  ['title',''],['title','x'.repeat(181)],['body','x'.repeat(60001)],
  ['tags',['x'.repeat(41)]],
  ['contributors',[{id:crypto.randomUUID(),name:'',role:'Author'}]],
  ['sections',[{id:f.record.id,title:'Collision with record',body:''}]],
  ['sections',[{id:f.before.book.id,title:'Collision with workspace',body:''}]],
  ['sections',[{id:crypto.randomUUID(),title:'',body:''}]],
  ['relations',[{id:crypto.randomUUID(),type:'Uses',label:'Self',role:'uses-method',target:{workspaceId:f.before.book.id,kind:'record',id:f.record.id,revision:recordRevision(f.record)}}]]
 ];
 await f.workspace.withLock(()=>f.workspace.catalogue(store=>withRecordDocument(store,f.record.id,saved,async document=>{
  assert.equal((await validateRecordDocument(document,f.before.book)).id,f.record.id);
  const tags=Array.from({length:13},(_,i)=>'tag '+i);assert.doesNotThrow(()=>validateRecordChanges(f.before.book,[{...f.record,tags}],[]));await validateRecordDocument(await document.replace(['tags'],tags),f.before.book);
  for(const [name,value] of mutations){
   const expected={...f.record,[name]:value};assert.throws(()=>validateRecordChanges(f.before.book,[expected],[]),{code:'INVALID'});
   await assert.rejects(validateRecordDocument(await document.replace([name],value),f.before.book),{code:'INVALID'});
  }
  const sections=Array.from({length:70},(_,i)=>({id:crypto.randomUUID(),title:'Section '+i,body:''}));sections[69].id=sections[0].id;
  await assert.rejects(validateRecordDocument(await document.replace(['sections'],sections),f.before.book),{code:'INVALID'});
 },{mutable:true})));
});
test('late array replacement and insertion preserve complete serialization without reading other bodies',async t=>{
 const f=await fixture(t),record={...f.record,sections:Array.from({length:1103},(_,i)=>({id:crypto.randomUUID(),title:'Section '+i,body:'Exact '+i+' '+('α🔬 '.repeat(30))}))};
 await new ResearchRecords(f.workspace,{}).save({workspaceId:f.before.book.id,changes:[{id:record.id,expectedRevision:recordRevision(f.record),record}]},{receipt:true});
 const saved=await f.workspace.catalogue(async store=>{const snapshot=await store.snapshot(),row=await store.member(snapshot,record.id);return store.record(row.id,row.revision);});
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  await withRecordDocument(store,saved.id,recordEncoding(saved).revision,async document=>{
   const read=RecordValueTree.prototype.read;let bodyReads=0;
   RecordValueTree.prototype.read=async function(revision){if((await this.node(revision)).type==='object')bodyReads++;return read.call(this,revision);};
   try{
    const replacement={id:crypto.randomUUID(),title:'Replacement',body:'Verified Δ'},inserted={id:crypto.randomUUID(),title:'Inserted',body:'Exact inserted text'};
    const changed=await document.splice(['sections'],1099,1,[replacement,inserted]);
    const expected={...saved,sections:[...saved.sections.slice(0,1099),replacement,inserted,...saved.sections.slice(1100)]};
    assert.deepEqual(await changed.encoding(),{...recordEncoding(expected),contentRevision:recordContentRevision(expected)});
    assert.equal(bodyReads,0,'Splicing references must not reconstruct section bodies');
    assert.deepEqual((await document.field(['sections','1099'])).value,saved.sections[1099]);
    assert.deepEqual((await changed.field(['sections','1100'])).value,inserted);
    const abort=new AbortController();abort.abort(Error('Stop edit'));await assert.rejects(document.splice(['sections'],0,0,[inserted],{signal:abort.signal}),/Stop edit/);
    await assert.rejects(document.splice(['sections'],1104,0,[]),{code:'INVALID'});
   }finally{RecordValueTree.prototype.read=read;}
  },{mutable:true});
 }));
});

test('history verification traverses blocks instead of loading originals and authenticates later revisions',async t=>{
 const f=await fixture(t),records=new ResearchRecords(f.workspace,{});
 let previous=f.record;
 for(let i=0;i<3;i++){
  const record={...previous,title:'Retained history '+i,sections:Array.from({length:34},(_,n)=>({id:crypto.randomUUID(),title:'Part '+n,body:('Exact retained text '+n+' ').repeat(1000)}))};
  await records.save({workspaceId:f.before.book.id,changes:[{id:record.id,expectedRevision:recordRevision(previous),record}]},{receipt:true});
  previous=await f.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),record.id);return store.record(row.id,row.revision);});
 }
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('History assembled a whole original');});
 await f.workspace.catalogue(store=>store.verifyRecordHistory(f.record.id));
});

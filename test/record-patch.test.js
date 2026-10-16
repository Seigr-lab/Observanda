import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyRecordPatch} from '../src/web/record-patch.js';

function fixture(count=4){
 const book={id:'workspace',title:'Book',entries:Array.from({length:count},(_,i)=>({id:'record-'+i,title:'Original '+i}))};
 const revisions=Object.fromEntries(book.entries.map(record=>[record.id,'original-'+record.id]));
 const result={etag:'new',recordPatch:{baseEtag:'old',metadata:{id:book.id,title:'Renamed book',entries:[]},count,order:null,
  records:[{id:'record-0',title:'Revised'},{id:'new-record',title:'New take'}],removed:['record-1'],appended:['new-record']},
  recordRevisions:{'record-0':'revised','new-record':'new-take'}};
 return {book,revisions,result};
}

test('ordinary patch adoption keeps only changed identities and shares unchanged records as the client corpus grows',()=>{
 for(const count of [24,2400]){
  const {book,revisions,result}=fixture(count),original=structuredClone({book,revisions,result}),MapClass=globalThis.Map,SetClass=globalThis.Set;
  let patched;
  globalThis.Map=class extends MapClass{set(key,value){super.set(key,value);assert.ok(this.size<=2,'a complete identity map was rebuilt');return this;}};
  globalThis.Set=class extends SetClass{add(value){super.add(value);assert.ok(this.size<=2,'a complete identity set was rebuilt');return this;}};
  try{patched=applyRecordPatch(book,'old',revisions,result);}finally{globalThis.Map=MapClass;globalThis.Set=SetClass;}
  assert.deepEqual(patched.book.entries,[result.recordPatch.records[0],...book.entries.slice(2),result.recordPatch.records[1]]);
  assert.equal(patched.book.entries[1],book.entries[2]);assert.equal(patched.book.title,'Renamed book');
  assert.equal(patched.recordRevisions['record-0'],'revised');assert.equal(patched.recordRevisions['record-2'],'original-record-2');
  assert.equal(patched.recordRevisions['record-1'],undefined);assert.equal(Object.keys(patched.recordRevisions).length,count);
  assert.deepEqual({book,revisions,result},original);
 }
});

test('invalid or partial responses cannot discard saved records or adopt missing revisions',()=>{
 const mutations=[
  p=>p.records.push(p.records[0]),p=>p.removed.push('record-1'),p=>p.appended.push('new-record'),
  p=>p.removed.push('absent'),p=>p.records.push({id:'unannounced',title:'Wrong'}),
  p=>p.appended.push('record-0'),p=>p.records.pop(),p=>p.count--,
  p=>p.records.push({id:'record-1',title:'Removed and changed'}),p=>p.metadata.entries.push({id:'private'}),
  p=>p.order=['record-0','new-record'],p=>p.order=['record-0','record-2','record-2','new-record'],
  p=>p.order=['record-0','record-2','absent','new-record'],p=>p.order=undefined,
 ];
 for(const mutate of mutations){
  const {book,revisions,result}=fixture(),saved=structuredClone(book);mutate(result.recordPatch);
  assert.throws(()=>applyRecordPatch(book,'old',revisions,result),/Incomplete record update/);assert.deepEqual(book,saved);
 }
 const {book,revisions,result}=fixture();delete result.recordRevisions['record-0'];
 assert.throws(()=>applyRecordPatch(book,'old',revisions,result),/Incomplete record update/);
 assert.throws(()=>applyRecordPatch(book,'different',revisions,result),{code:'WORKSPACE_CHANGED'});
 result.recordPatch.metadata.id='another-workspace';
 assert.throws(()=>applyRecordPatch(book,'old',revisions,result),{code:'WORKSPACE_CHANGED'});
});

test('accepting a small delta never reserializes unrelated heavy record bodies',()=>{
 const {book,revisions,result}=fixture(32),json=JSON.stringify;
 for(const record of book.entries)record.body='Retained observation '.repeat(4000);
 assert.ok(Buffer.byteLength(json(book))>2*1024*1024);
 JSON.stringify=()=>assert.fail('Patch adoption serialized already loaded research');
 try{
  const patched=applyRecordPatch(book,'old',revisions,result);
  assert.equal(patched.book.entries[1],book.entries[2]);
  assert.equal(patched.book.entries[1].body,book.entries[2].body);
  assert.equal(patched.recordRevisions['record-0'],'revised');
 }finally{JSON.stringify=json;}
});

test('explicit reordering and the legacy response shape retain all declared changes and exact order',()=>{
 const {book,revisions,result}=fixture();result.recordPatch.order=['new-record','record-3','record-0','record-2'];
 for(const legacy of [false,true]){
  if(legacy){delete result.recordPatch.appended;delete result.recordPatch.count;}
  const patched=applyRecordPatch(book,'old',revisions,result);
  assert.deepEqual(patched.book.entries.map(record=>record.id),result.recordPatch.order);
  assert.equal(patched.book.entries[1],book.entries[3]);assert.equal(patched.recordRevisions['new-record'],'new-take');
 }
});

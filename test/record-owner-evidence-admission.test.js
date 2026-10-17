import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordOwnerEvidenceAdmission} from '../src/record-owner-evidence.js';
const selected='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';

function sourceWithReceipts({pending=false,missing=false}={}){
 const prefix='metadata:.observanda/materials/',first='00000000-0000-4000-8000-000000000001',last='ffffffff-ffff-4fff-bfff-ffffffffffff';
 const rows=new Map(),receipt=prefix+'intakes/'+last+'/batch.json';
 for(let i=0;i<10000;i++)rows.set(prefix+'intakes/'+first+'/items/'+String(i).padStart(6,'0'),null);
 rows.set(prefix+'intakes/'+first+'/batch.json',{command:{recordId:other},state:'prepared'});
 rows.set(receipt,{command:{recordId:selected},state:pending?'prepared':'completed'});
 rows.set(prefix+'drafts/'+first+'/draft.json',{command:{recordId:other},state:'editing'});
 const keys=[...rows.keys()].sort();let pages=0,revision='proof';const reads=[];
 const store={objectIndex:()=>({head:async()=>({root:revision})}),
  objectIdPage:async(prefix,{after,limit})=>{pages++;return {items:keys.filter(k=>k.startsWith(prefix)&&(!after||k>after)).slice(0,limit)};},
  objectIdentity:async key=>{if(missing&&key===receipt)throw Object.assign(new Error(),{code:'CATALOGUE_DAMAGED'});return rows.has(key)?{id:key}:null;},
  async *objectIdEntries(prefix){yield* keys.filter(k=>k.startsWith(prefix));}};
 const source={catalogue:callback=>callback(store),readMetadata:async name=>{const key='metadata:'+name;reads.push(key);assert.ok(rows.get(key),'read only workflow receipts');return JSON.stringify(rows.get(key));}};
 return {source,reads,pages:()=>pages,change(){rows.get(receipt).state='prepared';revision='changed';}};
}
test('record move admission seeks past evidence items while checking every workflow receipt',async()=>{
 const f=sourceWithReceipts();assert.equal(typeof await recordOwnerEvidenceAdmission(f.source,selected),'string');
 const readCount=f.reads.length;await recordOwnerEvidenceAdmission(f.source,selected);assert.equal(f.reads.length,readCount,'unchanged authenticated root reuses only the verified workflow lookup');
 f.change();await assert.rejects(recordOwnerEvidenceAdmission(f.source,selected),{code:'RECORD_TRANSFER_PENDING'});
assert.ok(f.pages()<20,'admission cost follows workflow count, not evidence item count');
 await assert.rejects(recordOwnerEvidenceAdmission(sourceWithReceipts({pending:true}).source,selected),{code:'RECORD_TRANSFER_PENDING'});
 await assert.rejects(recordOwnerEvidenceAdmission(sourceWithReceipts({missing:true}).source,selected),{code:'CATALOGUE_DAMAGED'});
 const abort=new AbortController();abort.abort();await assert.rejects(recordOwnerEvidenceAdmission(f.source,selected,{signal:abort.signal}),{name:'AbortError'});
});

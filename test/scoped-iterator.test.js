import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scopedIterator} from '../src/scoped-iterator.js';
test('iterator owns the resource until exhaustion, early return or failed consumption',async()=>{
 for(const mode of ['complete','return','throw']){
  let active=false,closed=false;
  const values=scopedIterator(async use=>{active=true;try{return await use({value:7});}finally{active=false;closed=true;}},async function*(resource){assert.ok(active);yield resource.value;assert.ok(active);if(mode==='throw')throw Error('Failure');yield 8;});
  assert.equal((await values.next()).value,7);assert.ok(active);
  if(mode==='return')await values.return();
  else if(mode==='throw')await assert.rejects(values.next(),/Failure/);
  else assert.deepEqual(await Array.fromAsync(values),[8]);
  assert.equal(active,false);assert.equal(closed,true);
 }
});
test('failed resource acquisition and iterator creation reject without hanging',async()=>{
 await assert.rejects(Array.fromAsync(scopedIterator(async()=>{throw Error('Open failed');},()=>[])),/Open failed/);
 let closed=false;
 await assert.rejects(Array.fromAsync(scopedIterator(async use=>{try{return await use({});}finally{closed=true;}},()=>{throw Error('Create failed');})),/Create failed/);
 assert.ok(closed);
});

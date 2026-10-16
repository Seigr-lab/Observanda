import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicationReferenceWindow} from '../src/publication-reference-window.js';

test('overlapping reference namespaces retain one ordered window and release every iterator',async()=>{
 for(const backward of [false,true]){
  const reads=[0,0,0],closed=[0,0,0];let active=0;
  const sources=[0,1,2].map((value,index)=>async function*(){
   assert.equal(active++,0);
   try{for(let i=0;i<10000;i++){reads[index]++;yield {position:backward?100000-i*3-value:i*3+value};}}
   finally{active--;closed[index]++;}
  });
  const rows=await publicationReferenceWindow([...sources,sources[0]],{backward});
  assert.equal(rows.length,257);assert.deepEqual(rows.map(row=>row.position),Array.from({length:257},(_,i)=>backward?100000-i:i));
  assert.deepEqual(reads,[514,257,257]);assert.deepEqual(closed,[2,1,1]);assert.equal(active,0);
 }
});

test('cancelled reference windows close their current iterator',async()=>{
 const controller=new AbortController();let closed=false;
 async function* rows(){try{yield {position:0};controller.abort();yield {position:1};}finally{closed=true;}}
 await assert.rejects(publicationReferenceWindow([rows],{signal:controller.signal}),{name:'AbortError'});assert.equal(closed,true);
});

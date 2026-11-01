import {test} from 'node:test';
import assert from 'node:assert/strict';
import {datasetJSONTokens} from '../src/dataset-json-tokens.js';
import {DATASET_LIMITS} from '../src/dataset-reader.js';
const source=async function*(value){for(let i=0;i<value.length;i+=17)yield value.slice(i,i+17);};
const deep=n=>'['.repeat(n)+'0'+']'.repeat(n);

test('chunked and ordinary tokenizers reject excessive nesting before exposing its container',async()=>{
 for(const chunked of [false,true])for(const selected of [()=>false,()=>true]){
  // Ordinary selected containers are deliberately rejected by the scalar API.
  if(!chunked&&selected())continue;
  let begins=0;await assert.rejects(async()=>{for await(const token of datasetJSONTokens(source(deep(10000)),selected,DATASET_LIMITS,{chunked}))if(token.event==='begin')begins++;},{code:'MATERIAL_TABLE'});
  assert.equal(begins,DATASET_LIMITS.depth);
 }
 let value;for await(const token of datasetJSONTokens(source(deep(64)),()=>true,DATASET_LIMITS,{chunked:true}))if(token.event==='value')value=token;
 assert.equal(value.path.length,64);assert.deepEqual(value.arrays,Array.from({length:64},(_,i)=>i));
 for(const depth of [Infinity,NaN,0,-1,1.5])await assert.rejects(Array.fromAsync(datasetJSONTokens(source('[]'),()=>false,{...DATASET_LIMITS,depth},{chunked:true})),{code:'MATERIAL_TABLE'});
});

test('streamed locations preserve sibling array ordinals and object paths after popping containers',async()=>{
 const tokens=await Array.fromAsync(datasetJSONTokens(source('{"rows":[{"a":[1,2]},{"b":3}],"tail":[]}'),()=>true,DATASET_LIMITS,{chunked:true}));
 assert.deepEqual(tokens.filter(t=>t.event==='value').map(t=>t.path),[['rows','0','a','0'],['rows','0','a','1'],['rows','1','b']]);
 assert.deepEqual(tokens.filter(t=>t.event==='end').map(t=>t.path),[['rows','0','a'],['rows','0'],['rows','1'],['rows'],['tail'],[]]);
});

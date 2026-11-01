import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sampleAnalysisOrder} from '../src/sample-analysis-order.js';
import {SampleAnalysisCatalogue} from '../src/sample-analysis-catalogue.js';

test('sample ordinals preserve every original key and sort across decimal boundaries',()=>{
 for(let i=0;i<100000;i++)assert.equal(sampleAnalysisOrder(i),String(i).padStart(5,'0'));
 const positions=[0,1,99998,99999,100000,100001,999999,1000000,10**12,Number.MAX_SAFE_INTEGER];
 assert.deepEqual([...positions].reverse().sort((a,b)=>sampleAnalysisOrder(a)<sampleAnalysisOrder(b)?-1:1),positions);
 for(const value of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'1'])assert.throws(()=>sampleAnalysisOrder(value),{code:'LAB_INVALID'});
});

test('native sample heads admit large corpora while preserving old head validation and exact arithmetic',async()=>{
 let value;const owner=new SampleAnalysisCatalogue({object:async()=>value});
 const empty=(await owner.source()).head;assert.equal(empty.formatVersion,3);
 value={...structuredClone(empty),counts:{samples:5001,analyses:10001,review:1,archive:10,approved:1,events:100001},bytes:{samples:2**24,analyses:2**25,events:2**26},lastEventHash:'a'.repeat(64)};
 assert.deepEqual((await owner.source()).head,value);
 value.formatVersion=2;await assert.rejects(owner.source(),{code:'LAB_INVALID'});
 value=structuredClone(empty);value.formatVersion=2;value.bytes.samples=2**24;value.counts.samples=1;await assert.rejects(owner.source(),{code:'LIMIT'});
 for(const alter of [head=>head.counts.analyses=Number.MAX_SAFE_INTEGER,head=>head.bytes.events=Number.MAX_SAFE_INTEGER,head=>head.revision=Number.MAX_SAFE_INTEGER+1]){
  value={...structuredClone(empty),counts:{...empty.counts,archive:1,events:1},lastEventHash:'a'.repeat(64)};alter(value);
  await assert.rejects(owner.source(),{code:'LAB_INVALID'});
 }
});

test('whole sample assembly is admitted before originals are read and never limits paged storage',async()=>{
 let value;const owner=new SampleAnalysisCatalogue({object:async()=>value});value=(await owner.source()).head;
 value.counts.samples=10**9;value.bytes.samples=10**12;
 let reads=0;owner.value=async()=>{reads++;throw Error('unexpected original read');};
 const source=await owner.source();await assert.rejects(owner.assemble(source),{code:'MEDIA_RESOURCE_LIMIT'});assert.equal(reads,0);
});

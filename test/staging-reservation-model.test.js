import test from 'node:test';
import assert from 'node:assert/strict';
import {declaredStagingBytes,stagingRemaining,admitStagingClaim} from '../src/staging-reservation-model.js';
import {SEGMENTED_HEADER_BYTES,SEGMENTED_BLOCK_BYTES,SEGMENTED_CHUNK_OVERHEAD} from '../src/segmented-file-format.js';

test('signed aggregate reservation covers encrypted split rounding including empty and large entries',()=>{
 for(const sizes of [[0],[0,0,0],[1,1,1],[SEGMENTED_BLOCK_BYTES-1,1,2],[2**40,3,0]]){
  const actual=sizes.reduce((sum,size)=>sum+SEGMENTED_HEADER_BYTES+size+Math.ceil(size/SEGMENTED_BLOCK_BYTES)*SEGMENTED_CHUNK_OVERHEAD,0),bound=declaredStagingBytes(sizes.reduce((a,b)=>a+b,0),sizes.length);assert.ok(bound>=actual);assert.ok(bound-actual<=sizes.length*SEGMENTED_CHUNK_OVERHEAD);
 }
 assert.throws(()=>declaredStagingBytes(Number.MAX_SAFE_INTEGER,1),{code:'LIMIT'});
});
test('aggregate claims reserve only unwritten bytes and active admission never limits committed project size',()=>{
 const prior={id:'one',principalId:'a',expectedBytes:10000,writtenBytes:9000},next={id:'two',principalId:'b',expectedBytes:5000,writtenBytes:2000};assert.equal(stagingRemaining(prior),1000);assert.equal(admitStagingClaim([prior],next),4000);
 assert.equal(admitStagingClaim([], {id:'large',principalId:'a',expectedBytes:2**42,writtenBytes:0}),2**42);
 assert.throws(()=>admitStagingClaim([prior],next,{activeLimit:1}),{code:'WORKLOAD_BUSY'});assert.throws(()=>admitStagingClaim([prior],{...next,principalId:'a'},{principalLimit:1}),{code:'WORKLOAD_BUSY'});
 assert.throws(()=>stagingRemaining({...prior,writtenBytes:10001}),{code:'COLLABORATION_DAMAGED'});
});

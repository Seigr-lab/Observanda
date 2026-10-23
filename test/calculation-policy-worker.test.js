import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultCalculationPolicy} from '../src/web/tools/calculation-policy.js';
let response;globalThis.self={postMessage:value=>{response=value;}};
await import('../src/tools/worker.js');
const run=value=>{response=null;self.onmessage({data:{kind:'calculator-sheet',value:{engine:3,mode:'expression',angle:'rad',digits:'',fromBase:10,toBase:6,...value}}});return response;};
test('actual worker refuses unavailable pinned versions and retains policy metadata on approximations',()=>{
 const policy=defaultCalculationPolicy();policy.library.version='99.0.0';assert.equal(run({policy,expression:'sqrt(2)'}).errorCode,'CALCULATION_LIBRARY_UNAVAILABLE');
 const current=defaultCalculationPolicy();current.displayDigits=5;current.rounding='ceiling';const result=run({policy:current,expression:'sqrt(2)\n1/3'}).result;
 assert.equal(result[0].result,'1.4143');assert.deepEqual(result[0].approximation,{engine:3,...current});assert.equal(result[1].result,'1/3');
 assert.equal(run({policy:current,expression:'sqrt(-1)'}).result[0].errorCode,'CALCULATION_REAL_RESULT');
});
test('calculator worksheet rows share one exact and approximate operation budget',()=>{
 const policy=defaultCalculationPolicy();policy.resources.maxOperations=30;
 const result=run({policy,expression:Array(12).fill('sin(1)').join('\n')}).result;
 assert.ok(result[0].approximation);const first=result.findIndex(row=>row.error);assert.ok(first>0&&first<12);assert.ok(result.slice(first).every(row=>row.error.includes('resource budget')&&!row.approximation));
 const low=defaultCalculationPolicy();low.resources.maxBits=64;const denied=run({policy:low,expression:'1e100+1-1e100'}).result[0];assert.match(denied.error,/resource budget/);assert.equal(denied.approximation,undefined);
});

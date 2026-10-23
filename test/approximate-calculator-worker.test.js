import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultStructuredCalculationPolicy} from '../src/web/tools/calculation-policy.js';
import {validApproximateResult} from '../src/web/tools/approximate-calculation-model.js';
let response;globalThis.self={postMessage:value=>{response=structuredClone(value);}};
await import('../src/tools/worker.js');
function run(expression,policy=defaultStructuredCalculationPolicy()){response=null;self.onmessage({data:{kind:'calculator-sheet',value:{engine:4,policy,mode:'expression',angle:'rad',expression,digits:'',fromBase:10,toBase:6}}});return response;}

test('actual source worker transports full computational digits and signed zero separately from display',()=>{
 const policy=defaultStructuredCalculationPolicy();policy.displayDigits=3;const response=run('sqrt(2)\nsin(-0)\n2 cm to m',policy);assert.equal(response.error,undefined);const [sqrt,zero,unit]=response.result;
 assert.equal(sqrt.result,'1.41');assert.ok(sqrt.computation.spelling.length>60);assert.equal(validApproximateResult(sqrt.computation),true);assert.equal(sqrt.approximation.workingDigits,64);assert.ok(sqrt.tex);assert.equal(zero.computation.spelling,'-0');assert.equal(unit.computation,undefined);assert.ok(unit.approximation);
});

test('actual source worker exposes resource and nonfinite refusal without partial computational output',()=>{
 const policy=defaultStructuredCalculationPolicy();policy.resources.maxResultCharacters=400;const limited=run('sqrt(2)',policy).result[0];assert.equal(limited.errorCode,'CALCULATION_STRUCTURED_RESOURCE');assert.equal(limited.computation,undefined);assert.equal(limited.result,undefined);
 const invalid=run('log(-1)').result[0];assert.equal(invalid.errorCode,'CALCULATION_STRUCTURED_UNSUPPORTED');assert.equal(invalid.computation,undefined);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateDetailed,calculationRuntime} from '../src/tools/math.js';
import {defaultCalculationPolicy,defaultStructuredCalculationPolicy} from '../src/web/tools/calculation-policy.js';
import {validApproximateResult} from '../src/web/tools/approximate-calculation-model.js';
const options=(changes={})=>({engine:4,policy:{...defaultStructuredCalculationPolicy(),displayDigits:3,...changes}});
const sqrt2='1.414213562373095048801688724209698078569671875376948073176679738';

test('approximate computation retains all working digits independently of display precision',()=>{
 const low=options(),a=calculateDetailed('sqrt(2)',low),b=calculateDetailed('sqrt(2)',options({displayDigits:40}));
 assert.equal(a.result,'1.41');assert.equal(a.computation.spelling,sqrt2);assert.equal(validApproximateResult(a.computation),true);assert.deepEqual(a.computation,b.computation);assert.notEqual(a.result,b.result);assert.deepEqual(a.approximation,{engine:4,...low.policy});assert.equal(a.exact,undefined);
 const changed=calculateDetailed('sqrt(2)',options({workingDigits:32}));assert.equal(changed.result,a.result);assert.notEqual(changed.computation.spelling,a.computation.spelling);assert.equal(changed.computation.spelling,'1.4142135623730950488016887242097');
 const scientific=calculateDetailed('exp(1000)',low);assert.match(scientific.computation.spelling,/e\+434$/);assert.ok(scientific.computation.spelling.length>scientific.result.length);assert.equal(validApproximateResult(scientific.computation),true);
});

test('signed computational zero survives display formatting and JSON transport',()=>{
 const negative=calculateDetailed('sin(-0)',options()),positive=calculateDetailed('sin(0)',options());assert.equal(negative.result,'0');assert.equal(positive.result,'0');assert.equal(negative.computation.spelling,'-0');assert.equal(positive.computation.spelling,'0');assert.deepEqual(JSON.parse(JSON.stringify(negative.computation)),negative.computation);
 assert.equal(calculateDetailed('1/3',options()).computation,undefined);assert.equal(calculateDetailed('[1/3,2]',options()).computation,undefined);
 for(const engine of [1,2,3]){const settings={engine,...(engine===3?{policy:defaultCalculationPolicy()}:{})};assert.equal(calculateDetailed('sqrt(2)',settings).computation,undefined);}
});

test('Units and JavaScript numbers cannot acquire a BigNumber computation payload',()=>{
 const unit=calculateDetailed('2 cm to m',options());assert.equal(unit.result,'0.02 m');assert.ok(unit.approximation);assert.equal(unit.computation,undefined);
 // Exercise the scalar-library result boundary without changing a cached math instance.
 const settings=options(),base=calculationRuntime(settings),math=Object.create(base.math);Object.defineProperty(math,'parse',{value:(...args)=>{const node=base.math.parse(...args),copy=Object.create(node);copy.evaluate=()=>0.5;return copy;}});
 const number=calculateDetailed('sin(1)',{...settings,runtime:{...base,math}});assert.equal(number.result,'0.5');assert.equal(number.computation,undefined);assert.equal(calculateDetailed('sin(1)',settings).computation.kind,'approximate-real');
 for(const expression of ['log(-1)','exp(1e100)'])assert.throws(()=>calculateDetailed(expression,options()),{code:'CALCULATION_STRUCTURED_UNSUPPORTED'});
});

test('complete computational payload is charged under the saved result limit',()=>{
 const result=calculateDetailed('sqrt(2)',options()),without=JSON.stringify({result:result.result,approximation:result.approximation}).length,limited=options();limited.policy.resources.maxResultCharacters=without+20;
 assert.throws(()=>calculateDetailed('sqrt(2)',limited),{code:'CALCULATION_STRUCTURED_RESOURCE'});
 const admitted=options();admitted.policy.resources.maxResultCharacters=1024;assert.equal(calculateDetailed('sqrt(2)',admitted).computation.spelling,sqrt2);
});

test('approximate wire validation rejects other kinds, partial shapes and nonfinite spellings',()=>{
 const valid=calculateDetailed('sqrt(2)',options()).computation;
 for(const spelling of ['', 'NaN','Infinity','-Infinity','1/3',' 1','1 ','1\n','01','1e','1e99999999999999999999'])assert.equal(validApproximateResult({...valid,spelling}),false,spelling);
 for(const change of [{version:2},{kind:'exact'},{representation:'rational'},{radix:6},{spelling:3},{extra:true}])assert.equal(validApproximateResult({...valid,...change}),false);
 assert.equal(validApproximateResult(null),false);assert.equal(validApproximateResult({...valid,spelling:'-0'}),true);assert.equal(validApproximateResult({...valid,spelling:'1.25e-7'}),true);
});

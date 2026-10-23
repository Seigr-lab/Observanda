import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateDetailed,calculationRuntime,calculationPreview,convertBase,spreadsheet} from '../src/tools/math.js';
import {defaultCalculationPolicy,defaultStructuredCalculationPolicy,validCalculationPolicy,calculationWorkerTimeout} from '../src/web/tools/calculation-policy.js';
import {validStructuredResult,STRUCTURED_CALCULATION_ENGINE} from '../src/web/tools/structured-calculation-model.js';
const options=(resources={})=>{const policy=defaultStructuredCalculationPolicy();Object.assign(policy.resources,resources);return {engine:4,policy};};
const calculate=(expression,settings=options())=>calculateDetailed(expression,settings);
const components=answer=>answer.structured.components.map(value=>value.numerator+'/'+value.denominator);
const code=(expression,errorCode,settings)=>assert.throws(()=>calculate(expression,settings),{code:errorCode},expression);

test('engine 4 exact arrays preserve complete rational values and row-major matrix meaning',()=>{
 const vector=calculate('[1/3,9007199254740993+1]+[2/3,0]');assert.deepEqual(components(vector),['1/1','9007199254740994/1']);assert.equal(vector.result,'[1,9007199254740994]');assert.equal(validStructuredResult(vector.structured),true);assert.deepEqual(calculate(vector.result).structured,vector.structured);
 const a='[[1,2],[3,4]]',b='[[0,1],[1,0]]',ab=calculate(`matmul(${a},${b})`),ba=calculate(`matmul(${b},${a})`);assert.deepEqual(components(ab),['2/1','1/1','4/1','3/1']);assert.deepEqual(components(ba),['3/1','4/1','1/1','2/1']);assert.deepEqual(ab.structured.shape,[2,2]);assert.deepEqual(calculate(ab.result).structured,ab.structured);
 const rectangle=calculate('matmul([[1,2,3],[4,5,6]],[[7,8],[9,10],[11,12]])');assert.deepEqual(components(rectangle),['58/1','64/1','139/1','154/1']);
 assert.deepEqual(calculate('dot([6,1/2],[1,1/2])').exact,{numerator:'25',denominator:'4'});assert.deepEqual(components(calculate('-[1/3,2]+[1,3]')),['2/3','1/1']);assert.match(calculationPreview('[1,2]+[3,4]',options()),/bmatrix/);
});

test('complex expressions retain exact real and imaginary components without approximate roots',()=>{
 assert.deepEqual(components(calculate('(1+i)/(1-i)')),['0/1','1/1']);assert.deepEqual(components(calculate('sqrt(-4/9)')),['0/1','2/3']);
 const collapsed=calculate('(1+i)*(1-i)');assert.equal(collapsed.structured.codec,'complex');assert.deepEqual(components(collapsed),['2/1','0/1']);assert.deepEqual(calculate(collapsed.result).structured,collapsed.structured);
 assert.deepEqual(components(calculate('2-i')),['2/1','-1/1']);assert.deepEqual(components(calculate('i*2')),['0/1','2/1']);
 code('i/(1-1)','CALCULATION_STRUCTURED_ZERO_DIVISOR');code('sqrt(-2)','CALCULATION_STRUCTURED_UNSUPPORTED');code('log(-1)','CALCULATION_STRUCTURED_UNSUPPORTED');
 for(const expression of ['[sqrt(2),1]','sin(1)+i','sqrt(-2)+i','sqrt(i)','[i,1]','[2 cm,3 cm]'])assert.throws(()=>calculate(expression),error=>['CALCULATION_STRUCTURED_UNSUPPORTED','CALCULATION_STRUCTURED_SHAPE'].includes(error.code),expression);
});

test('ordinary scalar functions, units and precision retain the previous scalar pipeline',()=>{
 for(const expression of ['sqrt(2)','sin(1)','25 degC to degF','2 cm to m']){const old=calculateDetailed(expression,{engine:3,policy:defaultCalculationPolicy()}),next=calculate(expression);assert.equal(next.result,old.result);assert.equal(next.approximation.engine,4);assert.equal(next.approximation.version,2);assert.equal(next.structured,undefined);}
 assert.deepEqual(calculate('1/3').exact,{numerator:'1',denominator:'3'});assert.equal(calculate('1e100+1-1e100').result,'1');assert.equal(convertBase('0.2',6,10,options()),'1/3');
 assert.throws(()=>spreadsheet([['=i']],options()),{code:'CALCULATION_STRUCTURED_UNSUPPORTED'});
 for(const engine of [1,2,3])assert.throws(()=>calculateDetailed('[1,2]',{engine,...(engine===3?{policy:defaultCalculationPolicy()}:{})}),/Only numbers/);
 assert.throws(()=>calculateDetailed('1',{engine:3,policy:defaultStructuredCalculationPolicy()}),{code:'CALCULATION_POLICY_INVALID'});assert.throws(()=>calculateDetailed('1',{engine:4,policy:defaultCalculationPolicy()}),{code:'CALCULATION_POLICY_INVALID'});
});

test('shape and arity failures cannot broadcast or silently choose an array multiplication',()=>{
 for(const expression of ['[]','[[1,2],[3]]','[[[1]]]','[1,2]+1','[1,2]+[1]','[1,2]*[3,4]','[1,2]*2','dot([1,2],[3])','dot([1],[1],[1])','matmul([1,2],[3,4])','matmul([[1,2]],[[1,2]])'])code(expression,'CALCULATION_STRUCTURED_SHAPE');
 code('matmul([[1],[2]],[[1,2]])','CALCULATION_STRUCTURED_RESOURCE',options({maxComponents:3}));code('i','CALCULATION_STRUCTURED_RESOURCE',options({maxComponents:1}));
});

test('saved result limits charge exact computational payload even behind short scientific display',()=>{
 const large=calculate('10^100');assert.equal(large.result,'1e+100');assert.equal(large.exact.numerator.length,101);
 code('10^100','CALCULATION_STRUCTURED_RESOURCE',options({maxResultCharacters:100}));
 const vector=calculate('[1/3,2/3]'),size=JSON.stringify(vector).length;assert.deepEqual(calculate('[1/3,2/3]',options({maxResultCharacters:size})),vector);code('[1/3,2/3]','CALCULATION_STRUCTURED_RESOURCE',options({maxResultCharacters:size-1}));
 assert.equal(validCalculationPolicy(options().policy),true);const invalid=options().policy;delete invalid.resources.maxComponents;assert.equal(validCalculationPolicy(invalid),false);assert.deepEqual(STRUCTURED_CALCULATION_ENGINE,{name:'observanda-exact-structured',version:1});assert.equal(calculationWorkerTimeout(options()),5000);
});

test('each term and worksheet row shares the saved refusing arithmetic budget',()=>{
 const limited=options({maxOperations:60});assert.throws(()=>calculate('dot([1,2,3,4],[5,6,7,8])',limited),/resource budget/);assert.equal(calculate('dot([1,2,3,4],[5,6,7,8])').result,'70');
 const settings=options({maxOperations:100}),runtime=calculationRuntime(settings);assert.deepEqual(components(calculate('[1,2]',{...settings,runtime})),['1/1','2/1']);assert.throws(()=>{for(let i=0;i<20;i++)calculate('[1,2]+[3,4]',{...settings,runtime});},/resource budget/);
 const expired=calculationRuntime(options());expired.budget.deadline=0;assert.throws(()=>calculate('[1,2]',{...options(),runtime:expired}),/resource budget/);
 assert.throws(()=>calculate('[2^100,1]',options({maxBits:64})),/resource budget/);
});

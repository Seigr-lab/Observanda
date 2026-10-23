import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultDatasetResourcePolicy,validDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {DatasetResourceBudget} from '../src/dataset-resource-budget.js';
import {exactRational} from '../src/web/measurement-rational.js';
import {formatExactResult} from '../src/web/measurement-format.js';
import {calculateExactStep,exactCalculationCondition,exactCalculationKey} from '../src/dataset-exact-calculation.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
const policy=resources=>{const p=defaultDatasetResourcePolicy();return {...p,resources:{...p.resources,...resources}};};
const run=(resources,fn)=>{const b=new DatasetResourceBudget(policy(resources));return b.run(()=>fn(b));};
const output={version:1,representation:'integer',radix:10};
const constant=value=>({constant:value,representation:'decimal',radix:10,unit:''});
test('saved graph policy parses and formats complete large exact scalars without changing the legacy parser',()=>{
 const source='1'+'0'.repeat(9000),resources={maxScalarCharacters:12000,maxExponent:12000,maxOperations:200000};
 assert.throws(()=>exactRational(source,'integer'));assert.throws(()=>exactRational('1e9000'));
 const exact=run(resources,b=>exactRational('1e9000','decimal',10,b));assert.equal(exact.numerator.toString(),source);
 assert.equal(run(resources,b=>formatExactResult(exact,output,b)),source);assert.throws(()=>formatExactResult(exact,output),{code:'NUMERAL_RESULT_CAPACITY'});
 const radix='1'+'0'.repeat(9000);assert.equal(run(resources,b=>exactRational(radix,'radix',6,b)).numerator,6n**9000n);assert.equal(radix.length,9001);
 assert.throws(()=>run({},b=>exactRational(source,'integer',10,b)),{code:'DATASET_CALCULATION_RESOURCE'});
});
test('parse arithmetic and formatting share one refusing policy budget with no approximate fallback',()=>{
 const step={operation:'add',left:constant('1'),right:constant('2'),condition:null,unit:'',output};
 assert.equal(run({},b=>calculateExactStep(step,{cells:[]},[],b).value),'3');
 assert.throws(()=>run({maxOperations:8},b=>calculateExactStep(step,{cells:[]},[],b)),{code:'DATASET_CALCULATION_RESOURCE'});
 assert.throws(()=>run({maxBits:64},b=>exactRational('1e10000','decimal',10,b)),{code:'DATASET_CALCULATION_RESOURCE'});
 assert.throws(()=>run({maxExponent:4},b=>exactRational('1e5','decimal',10,b)),{code:'DATASET_CALCULATION_RESOURCE'});
 assert.throws(()=>run({maxScalarCharacters:16},b=>formatExactResult({numerator:10n**20n,denominator:1n},output,b)),{code:'DATASET_CALCULATION_RESOURCE'});
 assert.throws(()=>run({},b=>formatExactResult({numerator:1n,denominator:3n},{version:1,representation:'decimal',radix:10},b)),{code:'NUMERAL_RESULT_INEXACT'});
});
test('numeric matches and comparisons share exact source interpretation and reject malicious spelling before allocation',()=>{
 const column={...defaultColumn({label:'Input'}),representation:'radix',radix:6},comparison={operator:'eq',left:{column:0},right:constant('6')};
 assert.equal(run({},b=>exactCalculationCondition(comparison,{cells:['10']},[column],b)),true);
 assert.deepEqual(run({},b=>exactCalculationKey('10',column,b)),['6','1','']);
 for(const text of ['1e999999999999999999999999','1e-99999999999999999999999'])assert.throws(()=>run({},b=>exactRational(text,'decimal',10,b)),{code:'DATASET_CALCULATION_RESOURCE'});
 assert.throws(()=>run({},b=>exactRational('9','radix',6,b)),/digit/);assert.throws(()=>run({},b=>exactRational('1/0','rational',10,b)),/value/);
 const saved=policy({maxScalarCharacters:12000});assert.equal(validDatasetResourcePolicy(saved),true);assert.equal(validDatasetResourcePolicy({...saved,scope:'job'}),false);assert.equal(validDatasetResourcePolicy({...saved,resources:{...saved.resources,maxBits:1000000000}}),false);
});

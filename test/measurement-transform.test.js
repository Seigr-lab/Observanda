import test from 'node:test';
import assert from 'node:assert/strict';
import {binary64Rational,projectTransformedValue,validMeasurementProjection,validateMeasurementProjection} from '../src/web/measurement-transform.js';
import {exactRational} from '../src/web/measurement-model.js';
import {rationalProjection} from '../src/web/measurement-projection.js';
const q=(spelling,representation='decimal',radix=10)=>({spelling,representation,radix});
const transform=(origin,scale)=>({origin:q(origin),scale:q(scale)});

test('exact origin subtraction preserves adjacent counters beyond binary64 integer precision',()=>{
 const t=transform('1000000000000000000000000000000','0.001');
 const values=['1000000000000000000000000000000.001','1000000000000000000000000000000.002'];
 assert.deepEqual(values.map(value=>projectTransformedValue(exactRational(value),t).coordinate),[1,2]);
 for(const value of values)assert.deepEqual(projectTransformedValue(exactRational(value),t).error,{numerator:'0',denominator:'1'});
 assert.equal(t.origin.spelling,'1000000000000000000000000000000');
});
test('extreme values are scaled exactly before finite coordinates are projected',()=>{
 assert.equal(projectTransformedValue(exactRational('1e1000'),transform('0','1e999')).coordinate,10);
 assert.equal(projectTransformedValue(exactRational('1e-1000'),transform('0','1e-1001')).coordinate,10);
 assert.throws(()=>projectTransformedValue(exactRational('1e1000')));
 assert.throws(()=>projectTransformedValue(exactRational('1e-1000')));
});
test('radix and repeating-fraction transformations preserve exact interpretation',()=>{
 const t={origin:q('10.3','radix-fraction',6),scale:q('1/3','rational')};
 const projected=projectTransformedValue(exactRational('41/6','rational'),t);
 assert.equal(projected.coordinate,1);assert.deepEqual(projected.origin,{numerator:'13',denominator:'2'});
 assert.deepEqual(projected.scale,{numerator:'1',denominator:'3'});assert.deepEqual(projected.error,{numerator:'0',denominator:'1'});
 assert.throws(()=>projectTransformedValue(exactRational('1/3','rational')));
 const rounded=projectTransformedValue(exactRational('1/3','rational'),undefined,{policy:'approximate'});
 assert.equal(rounded.coordinate,1/3);assert.deepEqual(rounded.error,{numerator:'-1',denominator:'54043195528445952'});
});
test('error is measured against the binary coordinate and expressed in original units',()=>{
 const result=projectTransformedValue(exactRational('1000.01'),transform('1000','0.1'));
 assert.equal(result.coordinate,0.1);assert.deepEqual(result.projected,{numerator:'1',denominator:'10'});
 assert.deepEqual(result.error,{numerator:'1',denominator:'1801439850948198400'});
 assert.deepEqual(projectTransformedValue(exactRational('1000'),transform('1000','0.1')).error,{numerator:'0',denominator:'1'});
});
test('uncertainty widths scale without origin while endpoints use the affine transform',()=>{
 const t=transform('100','10');
 assert.equal(projectTransformedValue(exactRational('5'),t,{delta:true}).coordinate,0.5);
 assert.equal(projectTransformedValue(exactRational('95'),t).coordinate,-0.5);
 assert.equal(projectTransformedValue(exactRational('105'),t).coordinate,0.5);
});
test('binary identity covers signed values, subnormals and largest finite coordinates',()=>{
 assert.deepEqual(binary64Rational(-0),{numerator:0n,denominator:1n});
 assert.deepEqual(binary64Rational(Number.MIN_VALUE),{numerator:1n,denominator:2n**1074n});
 for(const value of [-Number.MAX_VALUE,-1.1,-Number.MIN_VALUE,Number.MIN_VALUE,0.1,1,1+Number.EPSILON,Number.MAX_VALUE])assert.equal(rationalProjection(binary64Rational(value)),value);
 for(const value of [NaN,Infinity,-Infinity])assert.throws(()=>binary64Rational(value));
});
test('projection admission rejects malformed, undeclared and nonpositive scale contexts',()=>{
 const valid={version:1,x:transform('0','1')};assert.equal(validMeasurementProjection(valid),true);
 for(const value of [{version:1},{...valid,version:2},{...valid,z:valid.x},{version:1,x:undefined},{version:1,x:transform('0','0')},{version:1,x:transform('0','-1')},{version:1,x:{...valid.x,other:true}},{version:1,x:{origin:q('6','radix',6),scale:q('1')}},{version:1,x:{origin:q('10','decimal',6),scale:q('1')}}])assert.equal(validMeasurementProjection(value),false);
 assert.throws(()=>projectTransformedValue(exactRational('1'),valid.x,{policy:'rounded'}));
});

import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {plotNumericalOperation,plotRational,plotRationalText} from '../src/web/plot-resource-policy.js';
import {exactFigureValue,projectFigureValue} from '../src/web/figure-mapping-values.js';
import {compareRationalText,sumRationalText,divideRationalText} from '../src/web/measurement-reduction.js';
const resources=changes=>{const p=defaultDatasetResourcePolicy();return {...p,resources:{...p.resources,...changes}};};

test('versioned projection policy parses complete large source values and keeps internal receipts beyond source spelling length',()=>{
 const policy=resources({maxExponent:12000,maxScalarCharacters:12000,maxOperations:200000}),axis=transform('1e9000','1'),projection={version:2,resourcePolicy:policy,x:axis};
 assert.equal(validMeasurementProjection(projection),true);assert.equal(validMeasurementProjection({version:1,x:axis}),false);
 const source='1'+'0'.repeat(8999)+'1',mapping={resourcePolicy:policy,numericPolicy:'safe',projection};
 const exact=plotNumericalOperation(policy,budget=>exactFigureValue(source,0,{budget,parseNumber:(value)=>exactRational(value,'integer',10,budget)}));
 assert.equal(projectFigureValue(exact,mapping,{axis:'x'}).coordinate,1);assert.deepEqual(projectFigureValue(exact,mapping,{axis:'x'}).error,{numerator:'0',denominator:'1'});
 const compact=resources({maxScalarCharacters:16,maxExponent:12000}),ratio=plotNumericalOperation(compact,b=>plotRationalText(exactRational('1e9000','decimal',10,b),b));
 assert.ok(ratio.length>8192);assert.equal(projectFigureValue(ratio,{resourcePolicy:compact,projection:{version:2,resourcePolicy:compact,y:transform('0','1e9000')}}).coordinate,1);
 assert.throws(()=>exactRational(source,'integer'));assert.throws(()=>projectFigureValue(ratio,{}));
});

test('plot policy budgets reductions sorting affine proofs and refuses without approximate fallback',()=>{
 const policy=resources({maxScalarCharacters:12000,maxExponent:12000,maxOperations:200000}),a='1'+'0'.repeat(8999)+'1/1',b='1'+'0'.repeat(8999)+'3/1';
 const sum=plotNumericalOperation(policy,budget=>sumRationalText(a,b,1n,budget)),mean=plotNumericalOperation(policy,budget=>divideRationalText(sum,2,budget));
 assert.equal(plotNumericalOperation(policy,budget=>compareRationalText(a,b,budget)),-1);
 assert.equal(projectFigureValue(mean,{resourcePolicy:policy,projection:{version:2,resourcePolicy:policy,y:transform('1e9000','1')}}).coordinate,2);
 for(const limited of [resources({maxBits:64}),resources({maxOperations:1}),resources({maxExponent:3})]){
  const projection={version:2,resourcePolicy:limited,y:transform('0','1e9000')};
  assert.throws(()=>validateMeasurementProjection(projection),{code:'DATASET_CALCULATION_RESOURCE'});
  assert.throws(()=>projectFigureValue('1/3',{numericPolicy:'approximate',resourcePolicy:limited,projection}),{code:'DATASET_CALCULATION_RESOURCE'});
 }
 assert.throws(()=>plotNumericalOperation(resources({maxBits:64}),b=>plotRational('9'.repeat(1000)+'/1',b)),{code:'DATASET_CALCULATION_RESOURCE'});
 const strict=resources({maxOperations:1});assert.throws(()=>plotNumericalOperation(strict,b=>compareRationalText('1/1','2/1',b)),{code:'DATASET_CALCULATION_RESOURCE'});
});

test('policy-aware interval deltas and exact source-unit error match legacy mathematical identities',()=>{
 const policy=resources({}),axis=transform('1000','0.1'),run=(value,delta=false)=>plotNumericalOperation(policy,budget=>projectTransformedValue(exactRational(value,'decimal',10,budget),axis,{budget,delta}));
 assert.equal(run('0.005',true).coordinate,.05);assert.equal(run('999.99').coordinate,-.1);
 assert.deepEqual(run('1000.01').error,{numerator:'1',denominator:'1801439850948198400'});
 assert.deepEqual(run('1000.01'),projectTransformedValue(exactRational('1000.01'),axis));
});


test('binary error proofs and approximate round-trip checks retain declared intermediate limits',()=>{
 const small=resources({maxBits:65}),normal=resources({});
 assert.throws(()=>plotNumericalOperation(small,b=>binary64Rational(Number.MIN_VALUE,b)),{code:'DATASET_CALCULATION_RESOURCE'});
 assert.deepEqual(plotNumericalOperation(normal,b=>binary64Rational(Number.MIN_VALUE,b)),binary64Rational(Number.MIN_VALUE));
 assert.deepEqual(plotNumericalOperation(resources({maxBits:64}),b=>binary64Rational(1,b)),{numerator:1n,denominator:1n});
 assert.throws(()=>projectFigureValue('1/2051',{numericPolicy:'approximate',resourcePolicy:small}),{code:'DATASET_CALCULATION_RESOURCE'});
 assert.throws(()=>projectFigureValue('1/2051',{numericPolicy:'approximate',resourcePolicy:small,projection:{version:2,resourcePolicy:small,y:transform('0','1')}}),{code:'DATASET_CALCULATION_RESOURCE'});
});


import {figureIssues,createFigure} from '../src/web/figure-model.js';
import {safeError} from '../src/errors.js';
import {DatasetResourceError} from '../src/web/dataset-resource-policy.js';
test('elapsed projection policy failures remain recoverable while ordinary validation stays boolean',t=>{
 const policy=resources({maxMilliseconds:1}),projection={version:2,resourcePolicy:policy,y:transform('0','1')},figure=createFigure();figure.projection=projection;figure.series[0].points=[{x:1,y:2,error:null}];
 let now=0;t.mock.method(Date,'now',()=>now+=10);
 assert.equal(validMeasurementProjection(projection),false);assert.throws(()=>validMeasurementProjection(projection,{resourceErrors:true}),{code:'DATASET_CALCULATION_RESOURCE'});assert.throws(()=>figureIssues(figure,{retained:true,resourceErrors:true}),{code:'DATASET_CALCULATION_RESOURCE'});
 assert.equal(validMeasurementProjection({version:2},{resourceErrors:true}),false);
 assert.equal(safeError(new DatasetResourceError()).code,'DATASET_CALCULATION_RESOURCE');assert.equal(safeError({code:'DATASET_CALCULATION_RESOURCE'}).code,'IO');
});

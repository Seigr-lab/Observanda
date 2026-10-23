import test from 'node:test';
import assert from 'node:assert/strict';
import {binary64Rational,projectTransformedValue,validMeasurementProjection} from '../src/web/measurement-transform.js';
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

import {plotNumericalOperation,reducePlotRational,addPlotRational,multiplyPlotRational,dividePlotRational,isResourceFailure} from './plot-resource-policy.js';
import {validDatasetResourcePolicy} from './dataset-resource-policy.js';
// Exact affine coordinates are display projections of retained measurements.
// The source spelling, origin and scale are never rewritten from plot numbers.
import {exactRational} from './measurement-model.js';
import {validNumeralContext} from './numeral-context.js';
import {rationalProjection,safeRationalProjection} from './measurement-projection.js';
const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===expected.length&&expected.every(key=>Object.hasOwn(value,key));
const reduce=({numerator:n,denominator:d})=>{
 if(d===0n)throw RangeError('Zero projection denominator');if(d<0n){n=-n;d=-d;}
 let a=n<0n?-n:n,b=d;while(b)[a,b]=[b,a%b];const gcd=a||1n;return {numerator:n/gcd,denominator:d/gcd};
};
const add=(a,b)=>reduce({numerator:a.numerator*b.denominator+b.numerator*a.denominator,denominator:a.denominator*b.denominator});
const subtract=(a,b)=>add(a,{...b,numerator:-b.numerator});
const multiply=(a,b)=>reduce({numerator:a.numerator*b.numerator,denominator:a.denominator*b.denominator});
const divide=(a,b)=>multiply(a,{numerator:b.denominator,denominator:b.numerator});
const zero=Object.freeze({numerator:0n,denominator:1n}),one=Object.freeze({numerator:1n,denominator:1n});
const serialized=r=>({numerator:String(r.numerator),denominator:String(r.denominator)});
function quantity(value,budget){
 if(!keys(value,['spelling','representation','radix'])||!validNumeralContext({version:1,representation:value.representation,radix:value.radix}))throw RangeError('Invalid projection quantity');
 return exactRational(value.spelling,value.representation,value.radix,budget);
}
export function projectionTransform(value,{resourcePolicy,budget}={}){
 if(resourcePolicy&&!budget)return plotNumericalOperation(resourcePolicy,b=>projectionTransform(value,{budget:b}));
 if(value===undefined)return {origin:zero,scale:one};
 if(!keys(value,['origin','scale']))throw RangeError('Invalid projection transform');
 const origin=quantity(value.origin,budget),scale=quantity(value.scale,budget);
 if(scale.numerator<=0n)throw RangeError('Projection scale must be positive');return {origin,scale};
}
export function validateMeasurementProjection(value){
 const version=value?.version,allowed=version===2?['version','resourcePolicy','x','y']:['version','x','y'];
 if(!value||typeof value!=='object'||Array.isArray(value)||![1,2].includes(version)||!Object.hasOwn(value,'x')&&!Object.hasOwn(value,'y')||Object.keys(value).some(key=>!allowed.includes(key))||version===2&&!validDatasetResourcePolicy(value.resourcePolicy))throw RangeError('Invalid projection transform');
 for(const key of ['x','y'])if(Object.hasOwn(value,key)){if(value[key]===undefined)throw RangeError('Invalid projection transform');projectionTransform(value[key],{resourcePolicy:value.resourcePolicy});}return value;
}
export function validMeasurementProjection(value,{resourceErrors=false}={}){try{validateMeasurementProjection(value);return true;}catch(error){if(resourceErrors&&isResourceFailure(error))throw error;return false;}}
// Decode the actual IEEE value, not Number.toString's shortest decimal. This
// makes projection error explicit even for decimal values such as 0.1.
export function binary64Rational(value,budget){
 if(!Number.isFinite(value))throw RangeError('A finite plot coordinate is required');
 if(value===0)return {...zero};
 const bytes=new DataView(new ArrayBuffer(8));bytes.setFloat64(0,value,false);
 const bits=bytes.getBigUint64(0,false),field=Number((bits>>52n)&2047n),fraction=bits&((1n<<52n)-1n);
 let mantissa=(field===0?fraction:(1n<<52n)|fraction)*(bits>>63n?-1n:1n),exponent=field===0?-1074:field-1023-52;
 if(budget){
  budget.size(mantissa);while(exponent<0&&mantissa%2n===0n){budget.step();mantissa/=2n;exponent++;}
  const factor=budget.power(2n,BigInt(Math.abs(exponent)));
  return reducePlotRational(exponent>=0?{numerator:budget.product(mantissa,factor),denominator:1n}:{numerator:mantissa,denominator:factor},budget);
 }
 return reduce(exponent>=0?{numerator:mantissa<<BigInt(exponent),denominator:1n}:{numerator:mantissa,denominator:1n<<BigInt(-exponent)});
}
export function projectTransformedValue(exact,transform,{policy='safe',delta=false,budget}={}){
 if(!['safe','approximate'].includes(policy)||typeof delta!=='boolean')throw RangeError('Invalid projection policy');
 const {origin,scale}=projectionTransform(transform,{budget}),offset=delta?zero:origin;
 const sum=budget?(a,b)=>addPlotRational(a,b,budget):add,mul=budget?(a,b)=>multiplyPlotRational(a,b,budget):multiply,div=budget?(a,b)=>dividePlotRational(a,b,budget):divide;
 const sub=(a,b)=>sum(a,{...b,numerator:-b.numerator}),projected=div(sub(exact,offset),scale);
 const coordinate=policy==='safe'?safeRationalProjection(projected,undefined,budget):rationalProjection(projected,budget);
 const restored=sum(mul(binary64Rational(coordinate,budget),scale),offset),error=sub(restored,exact);
 return {coordinate,projected:serialized(projected),error:serialized(error),origin:serialized(offset),scale:serialized(scale)};
}

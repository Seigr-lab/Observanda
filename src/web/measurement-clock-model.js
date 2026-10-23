// An explicit clock model describes counts and intervals. It does not unwrap
// observations, resolve resets or synchronize a counter to an external clock.
import {validDatasetResourcePolicy} from './dataset-resource-policy.js';
import {validPolicyScalar,withScalarPolicy} from './measurement-scalar-policy.js';
import {unitScalar,validUnitDefinition,validateUnitDefinition,canonicalUnitValue,divideUnitRational} from './measurement-unit-model.js';
const keys=(value,required,optional=[])=>value&&typeof value==='object'&&!Array.isArray(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const text=value=>typeof value==='string'&&value.length<=100&&!/[\u0000-\u001f]/u.test(value);
export function validClockDefinition(value){
 if(!keys(value,['version','modulus','rate',...(value?.version===2?['resourcePolicy']:[])])||![1,2].includes(value.version)||value.modulus===null&&value.rate===null)return false;
 if(value.version===2){if(!validDatasetResourcePolicy(value.resourcePolicy)||value.modulus!==null&&!validPolicyScalar(value.modulus,value.resourcePolicy))return false;const rate=value.rate;return rate===null||keys(rate,['counts','interval','unit'],['unitDefinition'])&&text(rate.unit)&&validPolicyScalar(rate.counts,value.resourcePolicy)&&validPolicyScalar(rate.interval,value.resourcePolicy)&&(rate.unitDefinition===undefined||validUnitDefinition(rate.unitDefinition)&&rate.unitDefinition.kind==='difference');}
 try{
  if(value.modulus!==null){const modulus=unitScalar(value.modulus);if(modulus.denominator!==1n||modulus.numerator<=0n)return false;}
  if(value.rate!==null){
   const rate=value.rate;if(!keys(rate,['counts','interval','unit'],['unitDefinition'])||!text(rate.unit)||unitScalar(rate.counts).numerator<=0n||unitScalar(rate.interval).numerator<=0n)return false;
   if(rate.unitDefinition!==undefined&&(!validUnitDefinition(rate.unitDefinition)||rate.unitDefinition.kind!=='difference'))return false;
  }
  return true;
 }catch{return false;}
}
export function validateClockDefinition(value,{budget}={}){if(!validClockDefinition(value))throw RangeError('Invalid declared clock definition');if(value.version===2){if(value.modulus){const modulus=unitScalar(value.modulus,budget,value.resourcePolicy);if(modulus.denominator!==1n||modulus.numerator<=0n)throw RangeError('Invalid clock modulus');}if(value.rate){if(unitScalar(value.rate.counts,budget,value.resourcePolicy).numerator<=0n||unitScalar(value.rate.interval,budget,value.resourcePolicy).numerator<=0n)throw RangeError('Invalid clock rate');if(value.rate.unitDefinition)validateUnitDefinition(value.rate.unitDefinition,{budget});}}return value;}
const definition=(value,budget)=>validateClockDefinition(value,{budget});
export function clockModulusIdentity(value,{budget}={}){definition(value,budget);return value.modulus===null?null:unitScalar(value.modulus,budget,value.resourcePolicy).numerator.toString();}
const divide=(a,b)=>{
 let n=a.numerator*b.denominator,d=a.denominator*b.numerator,x=n,y=d;while(y)[x,y]=[y,x%y];return {numerator:(n/x).toString(),denominator:(d/x).toString()};
};
// The identity is counts per one explicitly named interval unit. Canonicalizing
// an explicitly typed interval is opt-in and changes no retained source text.
export function clockRateIdentity(value,{canonical=false,budget}={}){
 if(value?.version===2)return withScalarPolicy(value.resourcePolicy,budget,b=>{definition(value,b);if(typeof canonical!=='boolean')throw RangeError('Invalid rate identity context');if(!value.rate)return null;const {counts,interval,unit,unitDefinition}=value.rate;if(canonical&&!unitDefinition)throw RangeError('A declared interval unit is required for canonical rate');const exact=unitScalar(interval,b,value.resourcePolicy),ratio=divideUnitRational(unitScalar(counts,b,value.resourcePolicy),canonical?canonicalUnitValue(exact,unitDefinition,b):exact,b);return {numerator:String(ratio.numerator),denominator:String(ratio.denominator),unit:canonical?null:unit,...(canonical?{sourceUnit:unit,intervalDimensions:structuredClone(unitDefinition.dimensions)}:unitDefinition?{unitDefinition:structuredClone(unitDefinition)}:{}),canonical};});
 definition(value);if(typeof canonical!=='boolean')throw RangeError('Invalid rate identity context');if(!value.rate)return null;const {counts,interval,unit,unitDefinition}=value.rate;
 const exactInterval=unitScalar(interval);if(canonical&&!unitDefinition)throw RangeError('A declared interval unit is required for canonical rate');
 return {...divide(unitScalar(counts),canonical?canonicalUnitValue(exactInterval,unitDefinition):exactInterval),unit:canonical?null:unit,...(canonical?{sourceUnit:unit,intervalDimensions:structuredClone(unitDefinition.dimensions)}:unitDefinition?{unitDefinition:structuredClone(unitDefinition)}:{}),canonical};
}

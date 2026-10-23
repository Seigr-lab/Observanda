// An explicit clock model describes counts and intervals. It does not unwrap
// observations, resolve resets or synchronize a counter to an external clock.
import {unitScalar,validUnitDefinition,canonicalUnitValue} from './measurement-unit-model.js';
const keys=(value,required,optional=[])=>value&&typeof value==='object'&&!Array.isArray(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const text=value=>typeof value==='string'&&value.length<=100&&!/[\u0000-\u001f]/u.test(value);
export function validClockDefinition(value){
 if(!keys(value,['version','modulus','rate'])||value.version!==1||value.modulus===null&&value.rate===null)return false;
 try{
  if(value.modulus!==null){const modulus=unitScalar(value.modulus);if(modulus.denominator!==1n||modulus.numerator<=0n)return false;}
  if(value.rate!==null){
   const rate=value.rate;if(!keys(rate,['counts','interval','unit'],['unitDefinition'])||!text(rate.unit)||unitScalar(rate.counts).numerator<=0n||unitScalar(rate.interval).numerator<=0n)return false;
   if(rate.unitDefinition!==undefined&&(!validUnitDefinition(rate.unitDefinition)||rate.unitDefinition.kind!=='difference'))return false;
  }
  return true;
 }catch{return false;}
}
function definition(value){if(!validClockDefinition(value))throw RangeError('Invalid declared clock definition');return value;}
export function clockModulusIdentity(value){definition(value);return value.modulus===null?null:unitScalar(value.modulus).numerator.toString();}
const divide=(a,b)=>{
 let n=a.numerator*b.denominator,d=a.denominator*b.numerator,x=n,y=d;while(y)[x,y]=[y,x%y];return {numerator:(n/x).toString(),denominator:(d/x).toString()};
};
// The identity is counts per one explicitly named interval unit. Canonicalizing
// an explicitly typed interval is opt-in and changes no retained source text.
export function clockRateIdentity(value,{canonical=false}={}){
 definition(value);if(typeof canonical!=='boolean')throw RangeError('Invalid rate identity context');if(!value.rate)return null;const {counts,interval,unit,unitDefinition}=value.rate;
 const exactInterval=unitScalar(interval);if(canonical&&!unitDefinition)throw RangeError('A declared interval unit is required for canonical rate');
 return {...divide(unitScalar(counts),canonical?canonicalUnitValue(exactInterval,unitDefinition):exactInterval),unit:canonical?null:unit,...(canonical?{sourceUnit:unit,intervalDimensions:structuredClone(unitDefinition.dimensions)}:unitDefinition?{unitDefinition:structuredClone(unitDefinition)}:{}),canonical};
}

import {REPRESENTATIONS,exactRational,supportedValue} from './measurement-model.js';

export const CONSTANT_REPRESENTATIONS=REPRESENTATIONS.filter(value=>value!=='unsupported');
// Unannotated recipes retain their original text-or-decimal interpretation.
// New typed constants use exactly the same parser as retained measurements.
export function validConstantType(value){
 if(value.representation===undefined&&value.radix===undefined)return true;
 return CONSTANT_REPRESENTATIONS.includes(value.representation)&&Number.isInteger(value.radix)&&value.radix>=2&&value.radix<=36&&(['radix','radix-fraction'].includes(value.representation)||value.radix===10)&&supportedValue(value.constant,value.representation,value.radix);
}
export function constantExact(value){
 if(value.representation==='text')return null;
 if(value.representation!==undefined)return exactRational(value.constant,value.representation,value.radix);
 try{return exactRational(value.constant);}catch{return null;}
}

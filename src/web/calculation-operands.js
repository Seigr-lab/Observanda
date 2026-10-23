import {isScalarRepresentation,REPRESENTATIONS,exactRational,supportedValue} from './measurement-model.js';

export const CONSTANT_REPRESENTATIONS=REPRESENTATIONS.filter(value=>value==='text'||isScalarRepresentation(value));
// Unannotated recipes retain their original text-or-decimal interpretation.
// New typed constants use exactly the same parser as retained measurements.
export function validConstantType(value){
 if(value.representation===undefined&&value.radix===undefined)return true;
 return CONSTANT_REPRESENTATIONS.includes(value.representation)&&Number.isInteger(value.radix)&&value.radix>=2&&value.radix<=36&&(['radix','radix-fraction'].includes(value.representation)||value.radix===10)&&supportedValue(value.constant,value.representation,value.radix);
}
export function constantExact(value,budget){
 if(value.representation==='text')return null;
 if(value.representation!==undefined)return exactRational(value.constant,value.representation,value.radix,budget);
 try{return exactRational(value.constant,'decimal',10,budget);}catch(error){if(budget?.scalarPolicy&&error.code)throw error;return null;}
}

import {AppError} from './errors.js';
import {materialReference} from './web/material-reference.js';
import {defaultColumn} from './web/dataset-schema.js';
// Capture reuses native-domain storage. This is the owned interpretation of
// canonical rational components; the recipe retains the whole-expression policy.
export function calculatorResultScalarPolicy(recipe,result){
 const saved=recipe.policy.resources,exponent=recipe.version===3?Math.abs(Number(/e([+-]?[0-9]+)$/.exec(result.spelling)?.[1]??0)):0;
 if(!Number.isSafeInteger(exponent)||exponent>Math.min(65536,saved.maxBits))throw new AppError('CALCULATOR_RESULT_RESOURCE');
 return {version:1,engine:'observanda-exact',engineVersion:1,scope:'scalar-operation',resources:{maxBits:saved.maxBits,maxOperations:saved.maxOperations,maxMilliseconds:saved.maxMilliseconds,maxScalarCharacters:Math.min(65536,saved.maxResultCharacters),maxExponent:exponent}};
}
export function calculatorResultColumn(recipe,result,recipeRef){
 const base={...defaultColumn({label:'Result'}),quantity:{origin:'derived',conversion:null,calibration:null}},resourcePolicy=calculatorResultScalarPolicy(recipe,result);
 if(recipe.version===3)return {...base,representation:'decimal',resourcePolicy,computation:{version:1,kind:'approximate',recipe:materialReference(recipeRef)}};
 return result.structured?{...base,representation:'domain',domain:{version:2,codec:'observanda.'+result.structured.codec,codecVersion:1,namespace:'observanda.calculator',shape:[...result.structured.shape],component:{version:1,representation:'rational',radix:10},resourcePolicy}}:{...base,representation:'rational',resourcePolicy};
}
export function* calculatorResultDomainComponents(result){for(const value of result.structured.components)yield {spelling:value.numerator+'/'+value.denominator};}

import {defaultColumn} from './web/dataset-schema.js';
// Capture reuses native-domain storage. This is the owned interpretation of
// canonical rational components; the recipe retains the whole-expression policy.
export function calculatorResultColumn(recipe,result){
 const base={...defaultColumn({label:'Result'}),quantity:{origin:'derived',conversion:null,calibration:null}},saved=recipe.policy.resources,resourcePolicy={version:1,engine:'observanda-exact',engineVersion:1,scope:'scalar-operation',resources:{maxBits:saved.maxBits,maxOperations:saved.maxOperations,maxMilliseconds:saved.maxMilliseconds,maxScalarCharacters:Math.min(65536,saved.maxResultCharacters),maxExponent:0}};
 return result.structured?{...base,representation:'domain',domain:{version:2,codec:'observanda.'+result.structured.codec,codecVersion:1,namespace:'observanda.calculator',shape:[...result.structured.shape],component:{version:1,representation:'rational',radix:10},resourcePolicy}}:{...base,representation:'rational',resourcePolicy};
}
export function* calculatorResultDomainComponents(result){for(const value of result.structured.components)yield {spelling:value.numerator+'/'+value.denominator};}

import {plotNumericalOperation,plotRational,plotRationalText,isResourceFailure} from './plot-resource-policy.js';
// Shared exact arithmetic for inline previews and retained plot production.
import {exactRational} from './measurement-model.js';
import {rationalText} from './dataset-calculation-model.js';
import {rationalProjection,safeRationalProjection} from './measurement-projection.js';
import {projectTransformedValue} from './measurement-transform.js';
export function exactFigureValue(raw,column,{parseNumber,decimal='.',budget}={}){
 const value=String(raw??'').trim();if(!value)return null;
 const exact=parseNumber?parseNumber(value,column,budget):exactRational(decimal===','?value.replace(',','.'):value,'decimal',10,budget);return budget?plotRationalText(exact,budget):rationalText(exact);
}
export function projectFigureValue(value,mapping,{axis='y',delta=false,forceSafe=false,transformed=true,budget}={}){
 if(value===null)return {coordinate:null,rounded:false};
 if(mapping.resourcePolicy&&!budget)return plotNumericalOperation(mapping.resourcePolicy,b=>projectFigureValue(value,mapping,{axis,delta,forceSafe,transformed,budget:b}));
 const exact=budget?plotRational(value,budget):exactRational(value,'rational'),policy=forceSafe?'safe':mapping.numericPolicy??'safe';
 if(mapping.projection&&transformed){const result=projectTransformedValue(exact,mapping.projection[axis],{policy,delta,budget});let rounded=false;try{projectTransformedValue(exact,mapping.projection[axis],{policy:'safe',delta,budget});}catch(error){if(isResourceFailure(error))throw error;rounded=true;}return {coordinate:result.coordinate,error:result.error,rounded};}
 try{return {coordinate:safeRationalProjection(exact,undefined,budget),rounded:false};}catch(error){if(isResourceFailure(error)||policy!=='approximate')throw error;return {coordinate:rationalProjection(exact,budget),rounded:true};}
}

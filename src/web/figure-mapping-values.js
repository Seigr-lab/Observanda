// Shared exact arithmetic for inline previews and retained plot production.
import {exactRational} from './measurement-model.js';
import {rationalText} from './dataset-calculation-model.js';
import {rationalProjection,safeRationalProjection} from './measurement-projection.js';
import {projectTransformedValue} from './measurement-transform.js';
export function exactFigureValue(raw,column,{parseNumber,decimal='.'}={}){
 const value=String(raw??'').trim();if(!value)return null;
 return rationalText(parseNumber?parseNumber(value,column):exactRational(decimal===','?value.replace(',','.'):value));
}
export function projectFigureValue(value,mapping,{axis='y',delta=false,forceSafe=false,transformed=true}={}){
 if(value===null)return {coordinate:null,rounded:false};
 const exact=exactRational(value,'rational'),policy=forceSafe?'safe':mapping.numericPolicy??'safe';
 if(mapping.projection&&transformed){const result=projectTransformedValue(exact,mapping.projection[axis],{policy,delta});let rounded=false;try{projectTransformedValue(exact,mapping.projection[axis],{policy:'safe',delta});}catch{rounded=true;}return {coordinate:result.coordinate,error:result.error,rounded};}
 try{return {coordinate:safeRationalProjection(exact),rounded:false};}catch(error){if(policy!=='approximate')throw error;return {coordinate:rationalProjection(exact),rounded:true};}
}

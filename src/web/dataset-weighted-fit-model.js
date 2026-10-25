import {validPolicyScalar} from './measurement-scalar-policy.js';
import {validDatasetResourcePolicy} from './dataset-resource-policy.js';
import {validNumeralContext} from './numeral-context.js';
import {validUnitDefinition} from './measurement-unit-model.js';
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>names.includes(key));
const text=value=>typeof value==='string'&&value.length<=200&&!!value.trim()&&!/[\u0000-\u001f]/u.test(value);
export const WEIGHTED_FIT_RESULTS=Object.freeze(['slope','intercept','slope-variance','intercept-variance','coefficient-covariance','fitted-mean','fitted-mean-variance']);
export const isWeightedFitMetric=value=>value?.operation==='weighted-affine-fit';
export const weightedFitEvaluated=value=>['fitted-mean','fitted-mean-variance'].includes(value?.result);
function contract(value,policy){return value?.method==='observation-variance-affine-v1'&&value.pairing==='complete-triples-v1'&&WEIGHTED_FIT_RESULTS.includes(value.result)&&validPolicyScalar(value.referenceX,policy)&&(weightedFitEvaluated(value)?validPolicyScalar(value.evaluationX,policy):value.evaluationX===undefined);}
export function validWeightedFitMetric(value,policy,count=Number.MAX_SAFE_INTEGER){
 return isWeightedFitMetric(value)&&keys(value,['operation','method','pairing','column','pairedColumn','varianceColumn','result','referenceX',...(weightedFitEvaluated(value)?['evaluationX']:[]),'name','output'])&&contract(value,policy)&&['column','pairedColumn','varianceColumn'].every(key=>Number.isSafeInteger(value[key])&&value[key]>=0&&value[key]<count)&&text(value.name)&&(value.output===undefined||validNumeralContext(value.output));
}
export function validWeightedFitReceipt(value,metric,count,policy){
 if(!validWeightedFitMetric(metric,policy)||!Number.isSafeInteger(count)||count<0||!keys(value,['version','method','pairing','status'])||Object.keys(value).length!==4||value.version!==1||value.method!==metric.method||value.pairing!==metric.pairing)return false;
 return (count===0?['no-pairs']:count===1?['insufficient-pairs']:['ready','zero-x-spread']).includes(value.status);
}
export function validWeightedFitContext(value){
 const coordinate=value?.coordinateUnit;
 return keys(value,['version','method','pairing','result','referenceX',...(weightedFitEvaluated(value)?['evaluationX']:[]),'resourcePolicy','coordinateUnit'])&&value.version===1&&validDatasetResourcePolicy(value.resourcePolicy)&&contract(value,value.resourcePolicy)&&keys(coordinate,['unit','definition'])&&Object.keys(coordinate).length===2&&typeof coordinate.unit==='string'&&coordinate.unit.length<=100&&(coordinate.definition===null?coordinate.unit==='':validUnitDefinition(coordinate.definition));
}

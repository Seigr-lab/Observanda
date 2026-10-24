import {validNumericalExecutionPolicy} from './numerical-execution-policy.js';
// Parameters are authored in one declared difference-unit coordinate system.
// The method fixes retained-row order, zero initialization and strict crossing.
import {validMaterialReference} from './material-reference.js';
import {validPolicyScalar} from './measurement-scalar-policy.js';
import {validUnitDefinition} from './measurement-unit-model.js';
import {validDatasetResourcePolicy} from './dataset-resource-policy.js';
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const natural=value=>Number.isSafeInteger(value)&&value>=0;
export const CUSUM_METHOD='two-sided-tabular-cusum-v1';
export const CUSUM_CONVENTIONS=Object.freeze({order:'retained',initial:'zero',crossing:'strict-greater'});
export const CUSUM_GAP_POLICIES=Object.freeze(['reject','reset-both']);
export const CUSUM_SIGNAL_POLICIES=Object.freeze(['continue','reset-both-after-row']);
export const validCusumPolicies=value=>CUSUM_GAP_POLICIES.includes(value?.gaps)&&CUSUM_SIGNAL_POLICIES.includes(value?.afterSignal);
export function validCusumRecipe(value){
 if(!exact(value,['version','method','source','column','range','target','allowance','threshold','unitDefinition','gaps','afterSignal','resourcePolicy','executionPolicy',...Object.keys(CUSUM_CONVENTIONS)])||value.version!==1||value.method!==CUSUM_METHOD||!validMaterialReference(value.source)||value.source.kind!=='dataset'||!natural(value.column)||!validCusumPolicies(value)||!validDatasetResourcePolicy(value.resourcePolicy)||!validCusumExecutionPolicy(value))return false;
 if(!Object.entries(CUSUM_CONVENTIONS).every(([key,expected])=>value[key]===expected)||!exact(value.range,['start','count'])||!natural(value.range.start)||!Number.isSafeInteger(value.range.count)||value.range.count<1||!Number.isSafeInteger(value.range.start+value.range.count))return false;
 return ['target','allowance','threshold'].every(key=>validPolicyScalar(value[key],value.resourcePolicy))&&validUnitDefinition(value.unitDefinition)&&value.unitDefinition.kind==='difference';
}

// This first authored recipe includes explicit job accounting. There is no
// implicit upgrade of a previously published CUSUM recipe format.
export function validCusumExecutionPolicy(value){return validNumericalExecutionPolicy(value?.executionPolicy)&&validDatasetResourcePolicy(value.resourcePolicy)&&value.executionPolicy.slice.maxOperations<=value.resourcePolicy.resources.maxOperations&&value.executionPolicy.slice.maxActiveMilliseconds<=value.resourcePolicy.resources.maxMilliseconds;}
export const CUSUM_ROLES=Object.freeze(['source-position','upper-score','lower-score','upper-crossing','lower-crossing','upper-start','lower-start','status','reset-after']);
const contextKeys=['version','method','role','count','target','allowance','threshold','unitDefinition','gaps','afterSignal','resourcePolicy','executionPolicy',...Object.keys(CUSUM_CONVENTIONS)];
export function validCusumContext(value){
 return exact(value,contextKeys)&&value.version===1&&value.method===CUSUM_METHOD&&CUSUM_ROLES.includes(value.role)&&Number.isSafeInteger(value.count)&&value.count>0&&validCusumPolicies(value)&&validCusumExecutionPolicy(value)&&Object.entries(CUSUM_CONVENTIONS).every(([key,expected])=>value[key]===expected)&&['target','allowance','threshold'].every(key=>validPolicyScalar(value[key],value.resourcePolicy))&&validUnitDefinition(value.unitDefinition)&&value.unitDefinition.kind==='difference';
}
export function validCusumDescriptor(value){if(!exact(value,[...contextKeys,'analysis'])||!validMaterialReference(value.analysis)||value.analysis.kind!=='analysis')return false;const {analysis,...context}=value;return validCusumContext(context);}
export function cusumColumnDescriptor(recipe,analysis,role){
 if(!validCusumRecipe(recipe)||!validMaterialReference(analysis)||analysis.kind!=='analysis'||!CUSUM_ROLES.includes(role))throw RangeError('Invalid change-detection descriptor');
 const {source,column,range,...context}=recipe;return structuredClone({...context,role,count:range.count,analysis});
}
export function publicCusumContext(value){if(!validCusumDescriptor(value))throw RangeError('Invalid change-detection descriptor');const {analysis,...context}=value;return structuredClone(context);}

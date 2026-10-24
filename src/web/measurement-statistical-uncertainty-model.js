// One declared scalar measurand, evaluated at pinned input estimates.
// Statistical covariance is distinct from closed interval enclosures.
import {validLocator} from './measurement-model.js';
import {validMaterialReference} from './material-reference.js';
import {researchId} from './research-reference.js';
import {validUnitDefinition} from './measurement-unit-model.js';
import {validPolicyScalar} from './measurement-scalar-policy.js';
import {validDatasetResourcePolicy,defaultDatasetResourcePolicy} from './dataset-resource-policy.js';
import {validCalculationPolicy,defaultStructuredCalculationPolicy} from './tools/calculation-policy.js';
import {validApproximateResult} from './tools/approximate-calculation-model.js';
export const STATISTICAL_UNCERTAINTY_METHOD='first-order-covariance-v1';
const keys=(value,names)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const text=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const natural=value=>Number.isSafeInteger(value)&&value>=0;
export const statisticalUncertaintyCell=value=>validLocator(value)&&value.ref.kind==='dataset'&&value.selector.kind==='cell';
export function statisticalUncertaintyCovarianceCount(count){
 if(!natural(count))throw RangeError('Invalid uncertainty input count');
 const result=count%2===0?count/2*(count+1):count*((count+1)/2);if(!Number.isSafeInteger(result))throw RangeError('Unsafe covariance cardinality');return result;
}
export function statisticalUncertaintyCovariancePosition(i,j){
 if(!natural(i)||!natural(j)||i>j)throw RangeError('Invalid upper triangle position');const result=statisticalUncertaintyCovarianceCount(j)+i;if(!Number.isSafeInteger(result))throw RangeError('Unsafe covariance position');return result;
}
export function defaultStatisticalUncertaintyDefinition(){return {version:1,method:STATISTICAL_UNCERTAINTY_METHOD,nominal:null,rationale:'',reference:'',evaluationPoint:'',resourcePolicy:defaultDatasetResourcePolicy(),calculationPolicy:defaultStructuredCalculationPolicy()};}
export function validStatisticalUncertaintyDefinition(value,{complete=false}={}){
 return keys(value,['version','method','nominal','rationale','reference','evaluationPoint','resourcePolicy','calculationPolicy'])&&value.version===1&&value.method===STATISTICAL_UNCERTAINTY_METHOD&&(value.nominal===null?!complete:statisticalUncertaintyCell(value.nominal))&&text(value.rationale,10000)&&text(value.reference,2000)&&text(value.evaluationPoint,4000)&&(!complete||!!value.rationale.trim()&&!!value.evaluationPoint.trim())&&validDatasetResourcePolicy(value.resourcePolicy)&&validCalculationPolicy(value.calculationPolicy)&&value.calculationPolicy.version===2;
}
export function validStatisticalUncertaintyOperand(value,policy){
 if(value?.kind==='cell')return keys(value,['kind','source'])&&statisticalUncertaintyCell(value.source);
 return value?.kind==='declared'&&keys(value,['kind','scalar','unitDefinition','rationale'])&&validPolicyScalar(value.scalar,policy)&&validUnitDefinition(value.unitDefinition)&&value.unitDefinition.kind==='difference'&&text(value.rationale,10000)&&!!value.rationale.trim();
}
export function validStatisticalUncertaintyInput(value,policy){return keys(value,['id','name','estimate','sensitivity'])&&researchId(value.id)&&text(value.name,200)&&!!value.name.trim()&&statisticalUncertaintyCell(value.estimate)&&validStatisticalUncertaintyOperand(value.sensitivity,policy);}
export function validStatisticalUncertaintyCovariance(value,policy){
 if(!keys(value,['i','j','value'])||!natural(value.i)||!natural(value.j)||value.i>value.j||!validStatisticalUncertaintyOperand(value.value,policy))return false;
 try{statisticalUncertaintyCovariancePosition(value.i,value.j);return true;}catch{return false;}
}
export function validStatisticalUncertaintyResult(value){
 if(!keys(value,['version','method','inputCount','covarianceMeaning','resourcePolicy','nominal','variance','standardUncertainty','squareRoot','approximateInputs'])||value.version!==1||value.method!==STATISTICAL_UNCERTAINTY_METHOD||!natural(value.inputCount)||value.inputCount<1||value.covarianceMeaning!=='input-estimates'||!validDatasetResourcePolicy(value.resourcePolicy)||typeof value.approximateInputs!=='boolean')return false;
 try{statisticalUncertaintyCovarianceCount(value.inputCount);}catch{return false;}
 for(const key of ['nominal','variance','standardUncertainty'])if(!keys(value[key],['scalar','unitDefinition'])||!validPolicyScalar(value[key].scalar,value.resourcePolicy)||!validUnitDefinition(value[key].unitDefinition)||key!=='nominal'&&value[key].unitDefinition.kind!=='difference')return false;
 const root=value.squareRoot,standard=value.standardUncertainty.scalar;
 return value.variance.scalar.representation==='rational'&&value.variance.scalar.radix===10&&keys(root,['engine','policy','approximate','computation'])&&root.engine===4&&validCalculationPolicy(root.policy)&&root.policy.version===2&&typeof root.approximate==='boolean'&&standard.radix===10&&(root.approximate?standard.representation==='decimal'&&validApproximateResult(root.computation)&&(typeof standard.spelling!=='string'||root.computation.spelling===standard.spelling):standard.representation==='rational'&&root.computation===null);
}

export function validStatisticalUncertaintyDescriptor(value){
 const reference=ref=>validMaterialReference(ref)&&ref.kind==='analysis';
 if(!keys(value,['version','method','role','definition','analysis',...(value?.role==='standard'?['squareRoot']:[])])||value.version!==1||value.method!==STATISTICAL_UNCERTAINTY_METHOD||!['nominal','variance','standard'].includes(value.role)||!reference(value.definition)||!reference(value.analysis))return false;
 return value.role!=='standard'||keys(value.squareRoot,['engine','policy','approximate'])&&value.squareRoot.engine===4&&validCalculationPolicy(value.squareRoot.policy)&&value.squareRoot.policy.version===2&&typeof value.squareRoot.approximate==='boolean';
}

import {validNumericalExecutionPolicy} from './numerical-execution-policy.js';
// A spectrum pins sampling and transform conventions independently of display.
import {validMaterialReference} from './material-reference.js';
import {validPolicyScalar} from './measurement-scalar-policy.js';
import {validUnitDefinition} from './measurement-unit-model.js';
import {validDatasetResourcePolicy} from './dataset-resource-policy.js';
import {validCalculationPolicy} from './tools/calculation-policy.js';
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const index=value=>Number.isSafeInteger(value)&&value>=0;
export const SPECTRUM_METHOD='radix2-fft-v1';
export const SPECTRUM_CONVENTIONS=Object.freeze({window:'rectangular',detrend:'none',normalization:'forward-unscaled',ordering:'unshifted-negative-nyquist',missing:'reject',excluded:'reject'});
export function powerOfTwoCount(value){if(!Number.isSafeInteger(value)||value<1)return false;while(value>1){if(value%2!==0)return false;value/=2;}return true;}
export function signedSpectrumBin(bin,count){if(!powerOfTwoCount(count)||!index(bin)||bin>=count)throw RangeError('Invalid spectrum bin');return bin<count/2?bin:bin-count;}
export function validSpectrumExecutionPolicy(value){return validNumericalExecutionPolicy(value?.executionPolicy)&&validCalculationPolicy(value.calculationPolicy)&&value.calculationPolicy.version===2&&value.executionPolicy.slice.maxOperations<=value.calculationPolicy.resources.maxOperations&&value.executionPolicy.slice.maxActiveMilliseconds<=value.calculationPolicy.resources.maxMilliseconds;}
export function validSpectrumRecipe(value){
 if(!exact(value,['version','method','source','column','range','sampling','calculationPolicy','resourcePolicy',...Object.keys(SPECTRUM_CONVENTIONS),...(value?.version===2?['executionPolicy']:[])])||![1,2].includes(value.version)||value.version===2&&!validSpectrumExecutionPolicy(value)||value.method!==SPECTRUM_METHOD||!validMaterialReference(value.source)||value.source.kind!=='dataset'||!index(value.column))return false;
 if(Object.entries(SPECTRUM_CONVENTIONS).some(([key,expected])=>value[key]!==expected)||!exact(value.range,['start','count'])||!index(value.range.start)||!powerOfTwoCount(value.range.count)||!Number.isSafeInteger(value.range.start+value.range.count))return false;
 if(!validDatasetResourcePolicy(value.resourcePolicy)||!validCalculationPolicy(value.calculationPolicy)||value.calculationPolicy.version!==2)return false;
 const sampling=value.sampling;
 return exact(sampling,['step','origin','unitDefinition','coordinateColumn'])&&validPolicyScalar(sampling.step,value.resourcePolicy)&&validPolicyScalar(sampling.origin,value.resourcePolicy)&&validUnitDefinition(sampling.unitDefinition)&&sampling.unitDefinition.kind==='difference'&&(sampling.coordinateColumn===null||index(sampling.coordinateColumn)&&sampling.coordinateColumn!==value.column);
}

export const SPECTRUM_ROLES=Object.freeze(['signed-bin','frequency','coefficient','normalized-squared-magnitude']);
const contextKeys=['version','method','role','count','window','detrend','normalization','ordering','coordinateChecked','sampling','calculationPolicy','resourcePolicy'];
export function validSpectrumContext(value){
 if(!exact(value,[...contextKeys,...(value?.version===2?['executionPolicy']:[])])||![1,2].includes(value.version)||value.version===2&&!validSpectrumExecutionPolicy(value)||value.method!==SPECTRUM_METHOD||![...SPECTRUM_ROLES,'coefficient-real','coefficient-imaginary'].includes(value.role)||!powerOfTwoCount(value.count)||typeof value.coordinateChecked!=='boolean'||!['window','detrend','normalization','ordering'].every(k=>value[k]===SPECTRUM_CONVENTIONS[k])||!validDatasetResourcePolicy(value.resourcePolicy)||!validCalculationPolicy(value.calculationPolicy)||value.calculationPolicy.version!==2)return false;
 const s=value.sampling;return exact(s,['step','origin','unitDefinition'])&&validPolicyScalar(s.step,value.resourcePolicy)&&validPolicyScalar(s.origin,value.resourcePolicy)&&validUnitDefinition(s.unitDefinition)&&s.unitDefinition.kind==='difference';
}
export function validSpectrumDescriptor(value){if(!exact(value,[...contextKeys,'analysis',...(value?.version===2?['executionPolicy']:[])])||!validMaterialReference(value.analysis)||value.analysis.kind!=='analysis')return false;const {analysis,...context}=value;return validSpectrumContext(context);}
export function spectrumColumnDescriptor(recipe,analysis,role){
 if(!validSpectrumRecipe(recipe)||!validMaterialReference(analysis)||analysis.kind!=='analysis'||!SPECTRUM_ROLES.includes(role))throw RangeError('Invalid spectral result descriptor');
 const {coordinateColumn,...sampling}=recipe.sampling;
 return structuredClone({version:recipe.version,...(recipe.version===2?{executionPolicy:recipe.executionPolicy}:{}),method:recipe.method,role,analysis,count:recipe.range.count,window:recipe.window,detrend:recipe.detrend,normalization:recipe.normalization,ordering:recipe.ordering,coordinateChecked:coordinateColumn!==null,sampling,calculationPolicy:recipe.calculationPolicy,resourcePolicy:recipe.resourcePolicy});
}
export function publicSpectrumContext(value){if(!validSpectrumDescriptor(value))throw RangeError('Invalid spectral result descriptor');const {analysis,...context}=value;return structuredClone(context);}

export function spectrumComponentDescriptor(value,index){if(!validSpectrumDescriptor(value)||value.role!=='coefficient'||![0,1].includes(index))throw RangeError('Invalid spectral coefficient component');return {...structuredClone(value),role:index===0?'coefficient-real':'coefficient-imaginary'};}

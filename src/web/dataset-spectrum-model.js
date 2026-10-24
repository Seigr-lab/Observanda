import {validNumericalExecutionPolicy} from './numerical-execution-policy.js';
// A spectrum pins sampling, coordinate and transform conventions independently of display.
import {validMaterialReference} from './material-reference.js';
import {validPolicyScalar} from './measurement-scalar-policy.js';
import {validUnitDefinition} from './measurement-unit-model.js';
import {validDatasetResourcePolicy} from './dataset-resource-policy.js';
import {validCalculationPolicy} from './tools/calculation-policy.js';
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const index=value=>Number.isSafeInteger(value)&&value>=0;
export const SPECTRUM_METHOD='radix2-fft-v1';
export const DIRECT_SPECTRUM_METHOD='direct-coordinate-fourier-v1';
export const SPECTRUM_METHODS=Object.freeze([SPECTRUM_METHOD,DIRECT_SPECTRUM_METHOD]);
export const SPECTRUM_WINDOWS=Object.freeze(['rectangular','hann-periodic','hamming-periodic','blackman-periodic']);
export const SPECTRUM_CONVENTIONS=Object.freeze({window:'rectangular',detrend:'none',normalization:'forward-unscaled',ordering:'unshifted-negative-nyquist',missing:'reject',excluded:'reject'});
export const directSpectrum=value=>value?.version===3&&value.method===DIRECT_SPECTRUM_METHOD;
export function powerOfTwoCount(value){if(!Number.isSafeInteger(value)||value<1)return false;while(value>1){if(value%2!==0)return false;value/=2;}return true;}
export function signedSpectrumBin(bin,count){if(!powerOfTwoCount(count)||!index(bin)||bin>=count)throw RangeError('Invalid spectrum bin');return bin<count/2?bin:bin-count;}
export function validSpectrumExecutionPolicy(value){return validNumericalExecutionPolicy(value?.executionPolicy)&&validCalculationPolicy(value.calculationPolicy)&&value.calculationPolicy.version===2&&value.executionPolicy.slice.maxOperations<=value.calculationPolicy.resources.maxOperations&&value.executionPolicy.slice.maxActiveMilliseconds<=value.calculationPolicy.resources.maxMilliseconds;}
function validOmissionPolicies(value){return ['missing','excluded'].every(key=>directSpectrum(value)?['reject','omit'].includes(value[key]):value[key]==='reject');}
export function validSpectrumContributions(value,count=value.count){const {contributedCount,omittedMissing,omittedExcluded}=value;return index(count)&&count>0&&index(contributedCount)&&contributedCount>0&&index(omittedMissing)&&index(omittedExcluded)&&contributedCount<=count&&omittedMissing<=count-contributedCount&&omittedExcluded===count-contributedCount-omittedMissing&&validOmissionPolicies(value)&&(value.missing==='omit'||omittedMissing===0)&&(value.excluded==='omit'||omittedExcluded===0);}
function validMethod(value){return value.version===3?SPECTRUM_METHODS.includes(value.method):[1,2].includes(value.version)&&value.method===SPECTRUM_METHOD;}
function validConventions(value,count){return value.detrend==='none'&&value.normalization==='forward-unscaled'&&value.ordering===(directSpectrum(value)?'frequency-grid':SPECTRUM_CONVENTIONS.ordering)&&(value.version===3?SPECTRUM_WINDOWS.includes(value.window)&&(value.window==='rectangular'||count>=2):value.window==='rectangular');}
function validSampling(value,sampling,withColumn){const direct=directSpectrum(value),policy=value.resourcePolicy;return exact(sampling,[...(direct?[]:['step']),'origin','unitDefinition',...(withColumn?['coordinateColumn']:[])])&&(direct||validPolicyScalar(sampling.step,policy))&&validPolicyScalar(sampling.origin,policy)&&validUnitDefinition(sampling.unitDefinition)&&sampling.unitDefinition.kind==='difference'&&(!withColumn||(direct?index(sampling.coordinateColumn):sampling.coordinateColumn===null||index(sampling.coordinateColumn))&&sampling.coordinateColumn!==value.column);}
export function validSpectrumFrequencyGrid(value,policy){return exact(value,['start','step','count','unitDefinition'])&&validPolicyScalar(value.start,policy)&&validPolicyScalar(value.step,policy)&&index(value.count)&&value.count>0&&validUnitDefinition(value.unitDefinition)&&value.unitDefinition.kind==='difference';}
export function validSpectrumRecipe(value){
 if(!exact(value,['version','method','source','column','range','sampling','calculationPolicy','resourcePolicy',...Object.keys(SPECTRUM_CONVENTIONS),...(value?.version>=2?['executionPolicy']:[]),...(directSpectrum(value)?['frequencyGrid']:[])])||![1,2,3].includes(value.version)||value.version>=2&&!validSpectrumExecutionPolicy(value)||!validMethod(value)||!validMaterialReference(value.source)||value.source.kind!=='dataset'||!index(value.column))return false;
 if(!exact(value.range,['start','count'])||!index(value.range.start)||!(directSpectrum(value)?index(value.range.count)&&value.range.count>0:powerOfTwoCount(value.range.count))||!Number.isSafeInteger(value.range.start+value.range.count)||!validConventions(value,value.range.count)||!validOmissionPolicies(value))return false;
 if(!validDatasetResourcePolicy(value.resourcePolicy)||!validCalculationPolicy(value.calculationPolicy)||value.calculationPolicy.version!==2)return false;
 return validSampling(value,value.sampling,true)&&(!directSpectrum(value)||validSpectrumFrequencyGrid(value.frequencyGrid,value.resourcePolicy)&&Number.isSafeInteger(value.range.count*value.frequencyGrid.count));
}
export const SPECTRUM_ROLES=Object.freeze(['signed-bin','frequency','coefficient','normalized-squared-magnitude']);
export const DIRECT_SPECTRUM_ROLES=Object.freeze(['frequency-index','frequency','coefficient','normalized-squared-magnitude']);
export const spectrumRoles=value=>directSpectrum(value)?DIRECT_SPECTRUM_ROLES:SPECTRUM_ROLES;
export const spectrumOutputCount=value=>directSpectrum(value)?value.frequencyGrid.count:value.range?.count??value.count;
const contextKeys=['version','method','role','count','window','detrend','normalization','ordering','coordinateChecked','sampling','calculationPolicy','resourcePolicy'];
export function validSpectrumContext(value){
 if(!exact(value,[...contextKeys,...(value?.version>=2?['executionPolicy']:[]),...(value?.version===3?['missing','excluded','contributedCount','omittedMissing','omittedExcluded']:[]),...(directSpectrum(value)?['frequencyGrid']:[])])||![1,2,3].includes(value.version)||value.version>=2&&!validSpectrumExecutionPolicy(value)||!validMethod(value)||value.version===3&&!validSpectrumContributions(value)||![...spectrumRoles(value),'coefficient-real','coefficient-imaginary'].includes(value.role)||!(directSpectrum(value)?index(value.count)&&value.count>0:powerOfTwoCount(value.count))||typeof value.coordinateChecked!=='boolean'||directSpectrum(value)&&value.coordinateChecked!==false||!validConventions(value,value.count)||!validDatasetResourcePolicy(value.resourcePolicy)||!validCalculationPolicy(value.calculationPolicy)||value.calculationPolicy.version!==2)return false;
 return validSampling(value,value.sampling,false)&&(!directSpectrum(value)||validSpectrumFrequencyGrid(value.frequencyGrid,value.resourcePolicy)&&Number.isSafeInteger(value.count*value.frequencyGrid.count));
}
export function validSpectrumDescriptor(value){if(!value||typeof value!=='object'||Array.isArray(value)||!Object.hasOwn(value,'analysis')||!validMaterialReference(value.analysis)||value.analysis.kind!=='analysis')return false;const {analysis,...context}=value;return validSpectrumContext(context);}
export function spectrumColumnDescriptor(recipe,analysis,role,stats){
 if(!validSpectrumRecipe(recipe)||!validMaterialReference(analysis)||analysis.kind!=='analysis'||!spectrumRoles(recipe).includes(role))throw RangeError('Invalid spectral result descriptor');
 const {coordinateColumn,...sampling}=recipe.sampling;let contributions={};if(recipe.version===3){const source=stats??(recipe.missing==='reject'&&recipe.excluded==='reject'?{contributedCount:recipe.range.count,omittedMissing:0,omittedExcluded:0}:{});contributions={missing:recipe.missing,excluded:recipe.excluded,contributedCount:source.contributedCount,omittedMissing:source.omittedMissing,omittedExcluded:source.omittedExcluded};if(!validSpectrumContributions({...recipe,...contributions},recipe.range.count))throw RangeError('Invalid spectral contribution counts');}
 return structuredClone({version:recipe.version,...(recipe.version>=2?{executionPolicy:recipe.executionPolicy}:{}),method:recipe.method,role,analysis,count:recipe.range.count,...contributions,window:recipe.window,detrend:recipe.detrend,normalization:recipe.normalization,ordering:recipe.ordering,coordinateChecked:directSpectrum(recipe)?false:coordinateColumn!==null,sampling,...(directSpectrum(recipe)?{frequencyGrid:recipe.frequencyGrid}:{}),calculationPolicy:recipe.calculationPolicy,resourcePolicy:recipe.resourcePolicy});
}
export function publicSpectrumContext(value){if(!validSpectrumDescriptor(value))throw RangeError('Invalid spectral result descriptor');const {analysis,...context}=value;return structuredClone(context);}
export function spectrumComponentDescriptor(value,index){if(!validSpectrumDescriptor(value)||value.role!=='coefficient'||![0,1].includes(index))throw RangeError('Invalid spectral coefficient component');return {...structuredClone(value),role:index===0?'coefficient-real':'coefficient-imaginary'};}

// Correlated first-order propagation, JCGM 100:2008 sections 5.1 and 5.2:
// https://www.bipm.org/documents/20126/2071204/JCGM_100_2008_E.pdf
// The recipe declares covariance of estimates and the adequacy of its supplied
// sensitivities. No observation-covariance conversion or coverage is inferred.
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {revisionText} from './web/revision-model.js';
import {DatasetResourceBudget} from './dataset-resource-budget.js';
import {validDatasetResourcePolicy} from './web/dataset-resource-policy.js';
import {validatePolicyScalar,withScalarPolicy,isScalarResourceFailure} from './web/measurement-scalar-policy.js';
import {validUnitDefinition,unitScalar,unitOperationDimensions,exactUnitScalar} from './web/measurement-unit-model.js';
import {isScalarRepresentation} from './web/measurement-model.js';
import {hasApproximateComputation,validComputation} from './web/measurement-computation.js';
import {STATISTICAL_UNCERTAINTY_METHOD,statisticalUncertaintyCovarianceCount} from './web/measurement-statistical-uncertainty-model.js';
import {validCalculationPolicy} from './web/tools/calculation-policy.js';
import {validApproximateResult} from './web/tools/approximate-calculation-model.js';
import {plotRational,plotRationalText,addPlotRational,multiplyPlotRational,dividePlotRational} from './web/plot-resource-policy.js';
import {ExactNumber} from './tools/exact-arithmetic.js';
import {calculationRuntime,calculateDetailed} from './tools/math.js';
const fail=(code='STATISTICAL_UNCERTAINTY_INVALID')=>{throw new AppError(code);};
const zero=()=>({numerator:0n,denominator:1n}),two={numerator:2n,denominator:1n};
const scalar=spelling=>({spelling,representation:'rational',radix:10});
const subtract=(a,b,budget)=>addPlotRational(a,{numerator:-b.numerator,denominator:b.denominator},budget);
const dimensionsUnit=dimensions=>({version:1,kind:'difference',dimensions,scale:exactUnitScalar('1'),offset:exactUnitScalar('0')});
const sameDimensions=(a,b)=>a.length===b.length&&a.every((value,i)=>value.axis===b[i].axis&&value.exponent===b[i].exponent);
function expectedDimensions(operation,a,b,budget){return unitOperationDimensions(operation,dimensionsUnit(a),dimensionsUnit(b),null,budget).dimensions;}
function checked(operation,code='STATISTICAL_UNCERTAINTY_INVALID'){
 try{return operation();}catch(error){if(error instanceof AppError||error.name==='AbortError')throw error;if(isScalarResourceFailure(error)||error.code==='CALCULATION_STRUCTURED_RESOURCE')fail('DATASET_CALCULATION_RESOURCE');if(error.code==='CALCULATION_LIBRARY_UNAVAILABLE')fail('STATISTICAL_UNCERTAINTY_LIBRARY');fail(code);}
}
// Callers resolve one selected scalar/declaration at a time under its pinned
// source identity. Each value is parsed under both source and operation limits.
export async function evaluateStatisticalUncertainty({count,nominal,readInput,readCovariance,work},{resourcePolicy,calculationPolicy,signal,check,budget:providedBudget}={}){
 if(!Number.isSafeInteger(count)||count<1||typeof readInput!=='function'||typeof readCovariance!=='function'||typeof work?.get!=='function'||typeof work?.put!=='function'||!validDatasetResourcePolicy(resourcePolicy)||!validCalculationPolicy(calculationPolicy)||calculationPolicy.version!==2)fail();
 checked(()=>statisticalUncertaintyCovarianceCount(count));
 // Source resolution may already have consumed this same operation budget.
 // Preserve that consumption; only synchronous numerical slices are timed.
 if(providedBudget!==undefined&&(!(providedBudget instanceof DatasetResourceBudget)||revisionText(providedBudget.scalarPolicy)!==revisionText(resourcePolicy)))fail();
 const budget=providedBudget??new DatasetResourceBudget(resourcePolicy),prefix='statistical-uncertainty:'+randomUUID()+':';let approximateInputs=false;
 const current=async()=>{signal?.throwIfAborted();await check?.();signal?.throwIfAborted();};
 const run=(operation,code)=>{signal?.throwIfAborted();return checked(()=>budget.run(()=>operation(budget)),code);};
 const put=async(key,value)=>{await current();await work.put(prefix+key,value);await current();};
 const get=async key=>{await current();const value=await work.get(prefix+key);await current();if(value===undefined)fail('MATERIAL_MISSING');return value;};
 const read=async(operation)=>{await current();const value=await operation();await current();return value;};
 const matrix=(i,j)=>'matrix:'+i+':'+j;
 const rational=async key=>{const value=await get(key);return run(b=>plotRational(value,b));};
 function unit(definition,b){
  // Version 1 units have fixed scalar storage limits. Normalize only the
  // validation view so all numerical parsing uses the cumulative budget.
  if(!definition||![1,2].includes(definition.version))fail('STATISTICAL_UNCERTAINTY_UNITS');
  if(definition.version===1&&(!['scale','offset'].every(key=>typeof definition[key]?.spelling==='string'&&definition[key].spelling.length<=8192)||Object.hasOwn(definition,'resourcePolicy')))fail('STATISTICAL_UNCERTAINTY_UNITS');
  const admitted=definition.version===1?{...definition,version:2,resourcePolicy}:definition;
  if(!validUnitDefinition(admitted))fail('STATISTICAL_UNCERTAINTY_UNITS');
  const scale=unitScalar(definition.scale,b,admitted.resourcePolicy),offset=unitScalar(definition.offset,b,admitted.resourcePolicy);
  if(scale.numerator<=0n||definition.kind==='difference'&&offset.numerator!==0n)fail('STATISTICAL_UNCERTAINTY_UNITS');return {scale,offset};
 }
 function operand(value,b){
  if(!value||value.excluded||value.presence!==undefined&&value.presence!=='value'||value.value?.presence!==undefined&&value.value.presence!=='value')fail('STATISTICAL_UNCERTAINTY_INPUT');
  const {column}=value,number=value.value;
  if(!column||!isScalarRepresentation(column)||!number||typeof number.spelling!=='string'||number.representation!==column.representation||number.radix!==column.radix)fail('STATISTICAL_UNCERTAINTY_INPUT');
  if(column.computation!==undefined&&!validComputation(column.computation))fail('STATISTICAL_UNCERTAINTY_INPUT');
  if(column.missing?.some(item=>item.value===number.spelling))fail('STATISTICAL_UNCERTAINTY_INPUT');
  const parsed=validatePolicyScalar(number,column.resourcePolicy??resourcePolicy,{budget:b}),definition=column.quantity?.unitDefinition,coordinates=checked(()=>unit(definition,b),'STATISTICAL_UNCERTAINTY_UNITS');
  approximateInputs ||= hasApproximateComputation(column);
  return {parsed,definition,...coordinates};
 }
 await current();const nominalValue=run(b=>operand(nominal,b)),outputDimensions=nominalValue.definition.dimensions;
 // Offsets locate nominal/estimate values only. Sensitivities and covariances
 // are differences; canonical conversion therefore multiplies their scales.
 for(let i=0;i<count;i++){
  const source=await read(()=>readInput(i));
  const input=run(b=>{
   const estimate=operand(source?.estimate,b),sensitivity=operand(source?.sensitivity,b),expected=expectedDimensions('divide',outputDimensions,estimate.definition.dimensions,b);
   if(sensitivity.definition.kind!=='difference'||!sameDimensions(sensitivity.definition.dimensions,expected))fail('STATISTICAL_UNCERTAINTY_UNITS');
   return {dimensions:estimate.definition.dimensions,sensitivity:plotRationalText(multiplyPlotRational(sensitivity.parsed,sensitivity.scale,b),b)};
  });await put('input:'+i,input);
 }
 let variance=zero();
 for(let j=0;j<count;j++){
  const right=await get('input:'+j);
  for(let i=0;i<=j;i++){
   const left=i===j?right:await get('input:'+i),source=await read(()=>readCovariance(i,j));
   const covariance=run(b=>{
    const value=operand(source,b),expected=expectedDimensions('multiply',left.dimensions,right.dimensions,b);
    if(value.definition.kind!=='difference'||!sameDimensions(value.definition.dimensions,expected))fail('STATISTICAL_UNCERTAINTY_UNITS');
    const canonical=multiplyPlotRational(value.parsed,value.scale,b);if(i===j&&canonical.numerator<0n)fail('STATISTICAL_UNCERTAINTY_COVARIANCE');
    let contribution=multiplyPlotRational(multiplyPlotRational(plotRational(left.sensitivity,b),plotRational(right.sensitivity,b),b),canonical,b);if(i!==j)contribution=multiplyPlotRational(contribution,two,b);
    variance=addPlotRational(variance,contribution,b);return plotRationalText(canonical,b);
   });await put(matrix(i,j),covariance);
  }
 }
 // Exact symmetric LDL elimination of the upper triangle. A zero pivot in a
 // PSD matrix has a zero remaining row; this admits singular covariance while
 // rejecting indefinite matrices without tolerances or invented regularization.
 for(let k=0;k<count;k++){
  const pivot=await rational(matrix(k,k));if(pivot.numerator<0n)fail('STATISTICAL_UNCERTAINTY_COVARIANCE');
  for(let j=k+1;j<count;j++){
   const right=await rational(matrix(k,j));
   if(pivot.numerator===0n){if(right.numerator!==0n)fail('STATISTICAL_UNCERTAINTY_COVARIANCE');continue;}
   if(right.numerator===0n)continue;
   for(let i=k+1;i<=j;i++){
    const left=i===j?right:await rational(matrix(k,i)),previous=await rational(matrix(i,j));
    const next=run(b=>plotRationalText(subtract(previous,dividePlotRational(multiplyPlotRational(left,right,b),pivot,b),b),b));await put(matrix(i,j),next);
   }
  }
 }
 const output=run(b=>{
  if(variance.numerator<0n)fail('STATISTICAL_UNCERTAINTY_COVARIANCE');
  const scale=multiplyPlotRational(nominalValue.scale,nominalValue.scale,b),dimensions=expectedDimensions('multiply',outputDimensions,outputDimensions,b),value=dividePlotRational(variance,scale,b),exact=scalar(plotRationalText(value,b)),varianceUnit={version:2,kind:'difference',dimensions,scale:scalar(plotRationalText(scale,b)),offset:exactUnitScalar('0'),resourcePolicy:structuredClone(resourcePolicy)};
  validatePolicyScalar(exact,resourcePolicy,{budget:b});validatePolicyScalar(varianceUnit.scale,resourcePolicy,{budget:b});return {value,scalar:exact,unitDefinition:varianceUnit};
 });
 await current();
 const runtime=checked(()=>calculationRuntime({engine:4,policy:calculationPolicy}));
 const sqrtPolicy={...resourcePolicy,resources:{...resourcePolicy.resources,maxBits:calculationPolicy.resources.maxBits,maxOperations:calculationPolicy.resources.maxOperations,maxMilliseconds:calculationPolicy.resources.maxMilliseconds,maxScalarCharacters:Math.min(65536,calculationPolicy.resources.maxResultCharacters),maxExponent:Math.min(65536,calculationPolicy.resources.maxBits)}};
 const root=run(b=>withScalarPolicy(sqrtPolicy,b,combined=>calculateDetailed('sqrt(v)',{engine:4,policy:calculationPolicy,runtime,budget:combined,variables:{v:new ExactNumber(output.value.numerator,output.value.denominator,combined)}})));
 const standard=run(b=>{
  if(root.exact&&!root.approximation)return {scalar:scalar(root.exact.numerator+'/'+root.exact.denominator),approximate:false,computation:null};
  if(!root.approximation||!validApproximateResult(root.computation))fail();return {scalar:{spelling:root.computation.spelling,representation:'decimal',radix:10},approximate:true,computation:structuredClone(root.computation)};
 });
 run(b=>validatePolicyScalar(standard.scalar,resourcePolicy,{budget:b}));await current();
 return {version:1,method:STATISTICAL_UNCERTAINTY_METHOD,inputCount:count,covarianceMeaning:'input-estimates',resourcePolicy:structuredClone(resourcePolicy),nominal:{scalar:structuredClone(nominal.value),unitDefinition:structuredClone(nominalValue.definition)},variance:{scalar:output.scalar,unitDefinition:output.unitDefinition},standardUncertainty:{scalar:standard.scalar,unitDefinition:{...structuredClone(nominalValue.definition),kind:'difference',offset:exactUnitScalar('0')}},squareRoot:{engine:4,policy:structuredClone(calculationPolicy),approximate:standard.approximate,computation:standard.computation},approximateInputs};
}

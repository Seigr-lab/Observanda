// Complete-row Pearson correlation, with exact centered sums and an explicit
// engine-4 policy only when the coefficient has no rational square root.
// https://stat.ethz.ch/R-manual/R-devel/library/stats/html/cor.html
import {AppError} from './errors.js';
import {createPairMoments,validatePairMoments,updatePairMoments} from './dataset-pair-statistics.js';
import {withScalarPolicy,validatePolicyScalar,isScalarResourceFailure} from './web/measurement-scalar-policy.js';
import {plotRational,plotRationalText,addPlotRational,multiplyPlotRational,dividePlotRational} from './web/plot-resource-policy.js';
import {validCalculationPolicy} from './web/tools/calculation-policy.js';
import {validApproximateResult} from './web/tools/approximate-calculation-model.js';
import {ExactNumber} from './tools/exact-arithmetic.js';
import {calculationRuntime,calculateDetailed} from './tools/math.js';
export const PEARSON_METHOD='pearson-centered-pairs-v1';
export const PEARSON_PAIRING='complete-rows-v1';
const fail=(code='DATASET_AGGREGATION')=>{throw new AppError(code);};
const subtract=(a,b,budget)=>addPlotRational(a,{numerator:-b.numerator,denominator:b.denominator},budget);
function operate(policy,budget,operation){try{return withScalarPolicy(policy,budget,operation);}catch(error){if(error instanceof AppError||isScalarResourceFailure(error)||error.name==='AbortError'||error.code==='CALCULATION_LIBRARY_UNAVAILABLE')throw error;if(error.code==='CALCULATION_STRUCTURED_RESOURCE')fail('DATASET_CALCULATION_RESOURCE');fail();}}
const priorState=state=>{const {Cyy,...prior}=state;return {...prior,version:1};};
export function createPearsonMoments(){return {...createPairMoments(),version:2,Cyy:'0/1'};}
function parsed(state,policy,budget,count){
 if(!state||typeof state!=='object'||Array.isArray(state)||Object.keys(state).sort().join()!=='Cxx,Cxy,Cyy,meanX,meanY,n,version'||state.version!==2||count!==undefined&&(!Number.isSafeInteger(count)||count<0))fail('MATERIAL_MISSING');
 validatePairMoments(priorState(state),{policy,budget,count});
 if(typeof state.Cyy!=='string'||!/^[-]?\d+\/[1-9]\d*$/.test(state.Cyy))fail('MATERIAL_MISSING');
 const values=Object.fromEntries(['meanX','meanY','Cxx','Cxy','Cyy'].map(key=>[key,plotRational(state[key],budget)]));
 if(plotRationalText(values.Cyy,budget)!==state.Cyy||values.Cyy.numerator<0n||state.n<2&&values.Cyy.numerator!==0n)fail('MATERIAL_MISSING');
 const determinant=subtract(multiplyPlotRational(values.Cxx,values.Cyy,budget),multiplyPlotRational(values.Cxy,values.Cxy,budget),budget);
 if(determinant.numerator<0n||state.n===2&&determinant.numerator!==0n)fail('MATERIAL_MISSING');
 return values;
}
// Fixed-size checkpoint state; source-order membership/authenticity is checked
// by the existing aggregation checkpoint owner and deterministic replay.
export function validatePearsonMoments(state,{policy,budget,count}={}){return operate(policy,budget,b=>{parsed(state,policy,b,count);return state;});}
export function updatePearsonMoments(state,x,y,{policy,budget,signal}={}){
 signal?.throwIfAborted();return operate(policy,budget,b=>{
  const previous=parsed(state,policy,b),next=updatePairMoments(priorState(state),x,y,{policy,budget:b}),value=plotRational(y,b),meanY=plotRational(next.meanY,b);
  const Cyy=addPlotRational(previous.Cyy,multiplyPlotRational(subtract(value,previous.meanY,b),subtract(value,meanY,b),b),b);
  signal?.throwIfAborted();return {...next,version:2,Cyy:plotRationalText(Cyy,b)};
 });
}
export function finishPearsonStatistic(state,metric,{policy,budget,signal}={}){
 signal?.throwIfAborted();return operate(policy,budget,b=>{
  if(metric?.operation!=='correlation'||metric.method!==PEARSON_METHOD||metric.pairing!==PEARSON_PAIRING||!validCalculationPolicy(metric.calculationPolicy)||metric.calculationPolicy.version!==2)fail();
  const values=parsed(state,policy,b),receipt={version:2,method:PEARSON_METHOD,pairing:PEARSON_PAIRING,status:'ready',evaluation:null};
  const absent=status=>({value:null,receipt:{...receipt,status}});
  if(state.n===0)return absent('no-pairs');if(state.n<2)return absent('insufficient-pairs');
  if(values.Cxx.numerator===0n||values.Cyy.numerator===0n)return absent(values.Cxx.numerator===0n?(values.Cyy.numerator===0n?'zero-both-spread':'zero-x-spread'):'zero-y-spread');
  const calculationPolicy=metric.calculationPolicy,runtime=calculationRuntime({engine:4,policy:calculationPolicy}),ratio=dividePlotRational(multiplyPlotRational(values.Cxy,values.Cxy,b),multiplyPlotRational(values.Cxx,values.Cyy,b),b);
  const sqrtPolicy={...policy,resources:{...policy.resources,maxBits:calculationPolicy.resources.maxBits,maxOperations:calculationPolicy.resources.maxOperations,maxMilliseconds:calculationPolicy.resources.maxMilliseconds,maxScalarCharacters:Math.min(65536,calculationPolicy.resources.maxResultCharacters),maxExponent:Math.min(65536,calculationPolicy.resources.maxBits)}};
  // Evaluate the signed expression through the saved engine, never divide by a
  // previously rounded square root or persist its display-only rendering.
  const answer=withScalarPolicy(sqrtPolicy,b,combined=>calculateDetailed(values.Cxy.numerator<0n?'-sqrt(v)':'sqrt(v)',{engine:4,policy:calculationPolicy,runtime,budget:combined,variables:{v:new ExactNumber(ratio.numerator,ratio.denominator,combined)}}));
  const approximate=!!answer.approximation;let value;
  if(!approximate&&answer.exact)value=plotRationalText({numerator:BigInt(answer.exact.numerator),denominator:BigInt(answer.exact.denominator)},b);
  else{if(!approximate||!validApproximateResult(answer.computation))fail();value=plotRationalText(validatePolicyScalar({spelling:answer.computation.spelling,representation:'decimal',radix:10},policy,{budget:b}),b);}
  validatePolicyScalar({spelling:value,representation:'rational',radix:10},policy,{budget:b});signal?.throwIfAborted();
  return {value,receipt:{...receipt,evaluation:{engine:4,policy:structuredClone(calculationPolicy),approximate,computation:approximate?structuredClone(answer.computation):null}}};
 });
}

// Fixed-X affine fitting with supplied, fixed independent observation variances.
// WLS criterion and inverse-variance interpretation:
// https://www.itl.nist.gov/div898/handbook/pmd/section4/pmd432.htm
// https://www.itl.nist.gov/div898/handbook/pmd/section4/pmd452.htm
// No residual rescaling, weight estimation, coverage or prediction-noise claim.
import {AppError} from './errors.js';
import {withScalarPolicy,validatePolicyScalar,isScalarResourceFailure} from './web/measurement-scalar-policy.js';
import {plotRational,plotRationalText,addPlotRational,multiplyPlotRational,dividePlotRational} from './web/plot-resource-policy.js';
export const WEIGHTED_FIT_METHOD='observation-variance-affine-v1';
export const WEIGHTED_FIT_RESULTS=Object.freeze(['slope','intercept','slope-variance','intercept-variance','coefficient-covariance','fitted-mean','fitted-mean-variance']);
const fields=['W','meanX','meanY','Sxx','Sxy'],one={numerator:1n,denominator:1n};
const fail=(code='DATASET_AGGREGATION')=>{throw new AppError(code);};
const subtract=(a,b,budget)=>addPlotRational(a,{numerator:-b.numerator,denominator:b.denominator},budget);
function operate({policy,budget,signal},operation,code){
 signal?.throwIfAborted();try{return withScalarPolicy(policy,budget,b=>{const active=signal?{...b,step(){signal.throwIfAborted();b.step();}}:b,result=operation(active);signal?.throwIfAborted();return result;});}catch(error){if(error instanceof AppError||isScalarResourceFailure(error)||error.name==='AbortError')throw error;fail(code);}
}
export function createWeightedFitMoments(){return {version:1,n:0,W:'0/1',meanX:'0/1',meanY:'0/1',Sxx:'0/1',Sxy:'0/1'};}
function parsedMoments(state,budget,count){
 if(!state||typeof state!=='object'||Array.isArray(state)||Object.keys(state).sort().join()!=='Sxx,Sxy,W,meanX,meanY,n,version'||state.version!==1||!Number.isSafeInteger(state.n)||state.n<0||count!==undefined&&state.n!==count)fail('MATERIAL_MISSING');
 const values={};for(const key of fields){const text=state[key];if(typeof text!=='string'||!/^[-]?\d+\/[1-9]\d*$/.test(text))fail('MATERIAL_MISSING');values[key]=plotRational(text,budget);if(plotRationalText(values[key],budget)!==text)fail('MATERIAL_MISSING');}
 if(state.n===0?fields.some(key=>values[key].numerator!==0n):values.W.numerator<=0n)fail('MATERIAL_MISSING');
 if(values.Sxx.numerator<0n||values.Sxx.numerator===0n&&values.Sxy.numerator!==0n||state.n===1&&(values.Sxx.numerator!==0n||values.Sxy.numerator!==0n))fail('MATERIAL_MISSING');return values;
}
// These are local canonical/algebraic checks. The retained command and enclosing
// authenticated checkpoint bind source identity, row counts and replay history.
export function validateWeightedFitMoments(state,{policy,budget,count,signal}={}){
 return operate({policy,budget,signal},b=>{if(count!==undefined&&(!Number.isSafeInteger(count)||count<0))fail('MATERIAL_MISSING');parsedMoments(state,b,count);return state;},'MATERIAL_MISSING');
}
// x/y/variance are canonical coordinates already resolved and converted under
// their original source policies by the caller. This state has constant size.
export function updateWeightedFitMoments(state,x,y,variance,{policy,budget,signal}={}){
 return operate({policy,budget,signal},b=>{
  const prior=parsedMoments(state,b);if(!Number.isSafeInteger(state.n+1))fail('DATASET_AGGREGATION_LIMIT');
  const left=plotRational(x,b),right=plotRational(y,b),v=plotRational(variance,b);if(v.numerator<=0n)fail('DATASET_WEIGHTED_FIT_VARIANCE');
  const weight=dividePlotRational(one,v,b),W=addPlotRational(prior.W,weight,b),fraction=dividePlotRational(weight,W,b),dx=subtract(left,prior.meanX,b),dy=subtract(right,prior.meanY,b);
  const meanX=addPlotRational(prior.meanX,multiplyPlotRational(fraction,dx,b),b),meanY=addPlotRational(prior.meanY,multiplyPlotRational(fraction,dy,b),b),weightedDx=multiplyPlotRational(weight,dx,b);
  const Sxx=addPlotRational(prior.Sxx,multiplyPlotRational(weightedDx,subtract(left,meanX,b),b),b),Sxy=addPlotRational(prior.Sxy,multiplyPlotRational(weightedDx,subtract(right,meanY,b),b),b);
  return {version:1,n:state.n+1,W:plotRationalText(W,b),meanX:plotRationalText(meanX,b),meanY:plotRationalText(meanY,b),Sxx:plotRationalText(Sxx,b),Sxy:plotRationalText(Sxy,b)};
 });
}
export function finishWeightedFit(state,metric,{policy,budget,signal}={}){
 return operate({policy,budget,signal},b=>{
  if(metric?.method!==WEIGHTED_FIT_METHOD||metric.pairing!=='complete-triples-v1'||!WEIGHTED_FIT_RESULTS.includes(metric.result))fail();
  const reference=validatePolicyScalar(metric.referenceX,policy,{budget:b}),fitted=metric.result==='fitted-mean'||metric.result==='fitted-mean-variance';
  if(!fitted&&Object.hasOwn(metric,'evaluationX'))fail();const evaluation=fitted?validatePolicyScalar(metric.evaluationX,policy,{budget:b}):null,values=parsedMoments(state,b);
  const receipt={version:1,method:metric.method,pairing:metric.pairing,status:'ready'};
  if(state.n===0)return {value:null,receipt:{...receipt,status:'no-pairs'}};if(state.n<2)return {value:null,receipt:{...receipt,status:'insufficient-pairs'}};if(values.Sxx.numerator===0n)return {value:null,receipt:{...receipt,status:'zero-x-spread'}};
  let value;
  if(metric.result==='slope')value=dividePlotRational(values.Sxy,values.Sxx,b);
  else if(metric.result==='slope-variance')value=dividePlotRational(one,values.Sxx,b);
  else{const delta=subtract(fitted?evaluation:reference,values.meanX,b);
   if(metric.result==='coefficient-covariance')value=dividePlotRational(delta,values.Sxx,b);
   else if(metric.result==='intercept'||metric.result==='fitted-mean')value=addPlotRational(values.meanY,multiplyPlotRational(dividePlotRational(values.Sxy,values.Sxx,b),delta,b),b);
   else value=addPlotRational(dividePlotRational(one,values.W,b),dividePlotRational(multiplyPlotRational(delta,delta,b),values.Sxx,b),b);
  }
  return {value:plotRationalText(value,b),receipt};
 });
}

import {AppError} from './errors.js';
import {withScalarPolicy,validatePolicyScalar,isScalarResourceFailure} from './web/measurement-scalar-policy.js';
import {formatExactResult} from './web/measurement-format.js';
import {plotRational,plotRationalText,addPlotRational,multiplyPlotRational} from './web/plot-resource-policy.js';
const fail=()=>{throw new AppError('DATASET_AGGREGATION');};
const scalar=spelling=>({spelling,representation:'rational',radix:10});
const context={version:1,representation:'rational',radix:10};
function checked(operation){try{return operation();}catch(error){if(isScalarResourceFailure(error)||error.name==='AbortError')throw error;fail();}}
function probability(value,policy,budget){const exact=validatePolicyScalar(value,policy,{budget});if(exact.numerator<0n||exact.numerator>exact.denominator)fail();return exact;}
export function validateQuantileProbability(value,policy,{budget}={}){return checked(()=>probability(value,policy,budget));}
// Explicit linear interpolation at (k-1)/(n-1), the Type 7 definition described at
// https://stat.ethz.ch/R-manual/R-devel/library/stats/html/quantile.html .
// This operation uses exact rationals without floating fuzz or endpoint clamping.
export function quantileSelection(count,value,policy,{budget}={}){
 return checked(()=>withScalarPolicy(policy,budget,b=>{
  const p=probability(value,policy,b);if(!Number.isSafeInteger(count)||count<0)fail();if(count===0)return null;
  const position=multiplyPlotRational({numerator:BigInt(count-1),denominator:1n},p,b),lower=position.numerator/position.denominator,remainder=position.numerator%position.denominator;
  return {lower:Number(lower),upper:Number(lower+(remainder===0n?0n:1n)),weight:scalar(formatExactResult({numerator:remainder,denominator:position.denominator},context,b))};
 }));
}
export function interpolateQuantile(lower,upper,selection,{policy,budget}={}){
 return checked(()=>withScalarPolicy(policy,budget,b=>{
  if(!selection||!Number.isSafeInteger(selection.lower)||selection.lower<0||!Number.isSafeInteger(selection.upper)||selection.upper<selection.lower||selection.upper-selection.lower>1)fail();
  const weight=probability(selection.weight,policy,b),same=selection.lower===selection.upper;
  if(same?weight.numerator!==0n:weight.numerator===0n||weight.numerator===weight.denominator)fail();
  const left=plotRational(lower,b),right=plotRational(upper,b);
  if(same){if(left.numerator!==right.numerator||left.denominator!==right.denominator)fail();return plotRationalText(left,b);}
  return plotRationalText(addPlotRational(multiplyPlotRational(left,{numerator:weight.denominator-weight.numerator,denominator:weight.denominator},b),multiplyPlotRational(right,weight,b),b),b);
 }));
}

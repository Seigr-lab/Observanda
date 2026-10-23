import {DatasetResourceBudget} from './dataset-resource-budget.js';
import {validDatasetResourcePolicy,DatasetResourceError} from './dataset-resource-policy.js';
import {exactRational} from './measurement-rational.js';
export const isResourceFailure=error=>error?.code==='DATASET_CALCULATION_RESOURCE'||/calculation resource budget/.test(error?.message??'');
export function plotNumericalOperation(policy,fn){if(policy===undefined)return fn();if(!validDatasetResourcePolicy(policy))throw Error('Invalid plot resource policy.');const budget=new DatasetResourceBudget(policy);return budget.run(()=>fn(budget));}
// Canonical intermediates are bounded by bits, not the authored source spelling allowance.
export function plotRational(value,budget){
 if(!budget)return exactRational(value,'rational');
 const digits=Math.ceil(budget.maxBits*Math.LOG10E*Math.LN2)+1;
 if(typeof value!=='string'||value.length>2*digits+2||!/^[-+]?\d+\/[1-9]\d*$/.test(value))throw new DatasetResourceError();
 const [n,d]=value.split('/');if(n.replace(/^[-+]/,'').length>digits||d.length>digits)throw new DatasetResourceError();
 return reducePlotRational({numerator:BigInt(n),denominator:BigInt(d)},budget);
}
export function reducePlotRational({numerator:n,denominator:d},budget){
 budget?.size(n,d);if(!d)throw Error('Zero denominator');if(d<0n){n=-n;d=-d;}let a=n<0n?-n:n,b=d;while(b){budget?.step();[a,b]=[b,a%b];}a||=1n;return {numerator:n/a,denominator:d/a};
}
const product=(a,b,budget)=>budget?budget.product(a,b):a*b;
export function addPlotRational(a,b,budget){let x=a.denominator,y=b.denominator;while(y){budget?.step();[x,y]=[y,x%y];}const left=b.denominator/x,right=a.denominator/x;return reducePlotRational({numerator:product(a.numerator,left,budget)+product(b.numerator,right,budget),denominator:product(a.denominator,left,budget)},budget);}
export function multiplyPlotRational(a,b,budget){
 // Cancel before multiplying so a harmless rational factor does not exhaust intermediates.
 const left=reducePlotRational({numerator:a.numerator,denominator:b.denominator},budget),right=reducePlotRational({numerator:b.numerator,denominator:a.denominator},budget);
 return reducePlotRational({numerator:product(left.numerator,right.numerator,budget),denominator:product(left.denominator,right.denominator,budget)},budget);
}
export function dividePlotRational(a,b,budget){return multiplyPlotRational(a,{numerator:b.denominator,denominator:b.numerator},budget);}
export function plotRationalText(value,budget){const r=reducePlotRational(value,budget);return r.numerator+'/'+r.denominator;}

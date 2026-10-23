import {plotRational,plotRationalText,addPlotRational,dividePlotRational} from './plot-resource-policy.js';
// Exact reducers shared by retained datasets and figure mapping. Values stay
// canonical rationals until the caller explicitly projects a display coordinate.
import {exactRational} from './measurement-model.js';
import {rationalText} from './dataset-calculation-model.js';
const rational=value=>exactRational(value,'rational');
export function compareRationalText(a,b,budget){
 if(budget){const x=plotRational(a,budget),y=plotRational(b,budget),n=budget.product(x.numerator,y.denominator)-budget.product(y.numerator,x.denominator);budget.size(n);return n<0n?-1:n>0n?1:0;}
 const x=rational(a),y=rational(b),n=x.numerator*y.denominator-y.numerator*x.denominator;
 return n<0n?-1:n>0n?1:0;
}
export function sumRationalText(a,b,divisor=1n,budget){
 if(budget)return plotRationalText(dividePlotRational(addPlotRational(plotRational(a,budget),plotRational(b,budget),budget),{numerator:divisor,denominator:1n},budget),budget);
 const x=rational(a),y=rational(b);
 return rationalText({numerator:x.numerator*y.denominator+y.numerator*x.denominator,denominator:x.denominator*y.denominator*divisor});
}
export function divideRationalText(value,divisor,budget){
 if(budget)return plotRationalText(dividePlotRational(plotRational(value,budget),{numerator:BigInt(divisor),denominator:1n},budget),budget);
 const r=rational(value);return rationalText({...r,denominator:r.denominator*BigInt(divisor)});
}

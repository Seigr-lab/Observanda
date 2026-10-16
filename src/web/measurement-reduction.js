// Exact reducers shared by retained datasets and figure mapping. Values stay
// canonical rationals until the caller explicitly projects a display coordinate.
import {exactRational} from './measurement-model.js';
import {rationalText} from './dataset-calculation-model.js';
const rational=value=>exactRational(value,'rational');
export function compareRationalText(a,b){
 const x=rational(a),y=rational(b),n=x.numerator*y.denominator-y.numerator*x.denominator;
 return n<0n?-1:n>0n?1:0;
}
export function sumRationalText(a,b,divisor=1n){
 const x=rational(a),y=rational(b);
 return rationalText({numerator:x.numerator*y.denominator+y.numerator*x.denominator,denominator:x.denominator*y.denominator*divisor});
}
export function divideRationalText(value,divisor){
 const r=rational(value);return rationalText({...r,denominator:r.denominator*BigInt(divisor)});
}

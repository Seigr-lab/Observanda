import {validNumeralContext,resultContext} from './numeral-context.js';

// Matches the current exact-value parser's resource envelope. This is not a
// rounding precision: a value that does not fit is refused, never shortened.
const MAX_SPELLING=8192;
const gcd=(n,d)=>{while(d)[n,d]=[d,n%d];return n||1n;};
function reduced({numerator:n,denominator:d}){
 if(!d)throw Error('division');if(d<0n){n=-n;d=-d;}const divisor=gcd(n<0n?-n:n,d);
 return {numerator:n/divisor,denominator:d/divisor};
}
export function rationalText(value){
 const {numerator:n,denominator:d}=reduced(value),text=n+'/'+d;
 if(text.length>MAX_SPELLING)throw Error('precision');return text;
}
export class ExactFormatError extends Error{
 constructor(code){super(code);this.code=code;}
}
const fail=code=>{throw new ExactFormatError(code);};
export function formatExactResult(value,context=resultContext()){
 if(!validNumeralContext(context))throw Error('representation');
 const {numerator:n,denominator:d}=reduced(value);
 if(context.representation==='rational'){
  const text=n+'/'+d;if(text.length>MAX_SPELLING)fail('NUMERAL_RESULT_CAPACITY');return text;
 }
 const radix=context.radix,base=BigInt(radix),sign=n<0n?'-':'',absolute=n<0n?-n:n;
 if(['integer','radix'].includes(context.representation)&&d!==1n)fail('NUMERAL_RESULT_INEXACT');
 // A reduced fraction terminates only when its denominator's prime factors
 // divide the chosen base. No floating-point conversion or repeating cutoff.
 let denominator=d,digits=0;
 while(denominator!==1n){
  const divisor=gcd(denominator,base);if(divisor===1n)fail('NUMERAL_RESULT_INEXACT');
  denominator/=divisor;if(++digits>MAX_SPELLING)fail('NUMERAL_RESULT_CAPACITY');
 }
 const whole=sign+(absolute/d).toString(radix),length=whole.length+(digits?1+digits:0);
 if(length>MAX_SPELLING)fail('NUMERAL_RESULT_CAPACITY');
 let remainder=absolute%d;const fraction=[];
 while(remainder){remainder*=base;fraction.push((remainder/d).toString(radix));remainder%=d;}
 return whole+(fraction.length?'.'+fraction.join(''):'');
}

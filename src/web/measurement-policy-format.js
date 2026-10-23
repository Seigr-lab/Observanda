import {DatasetResourceError} from './dataset-resource-policy.js';
import {validNumeralContext,resultContext} from './numeral-context.js';
import {ExactFormatError} from './measurement-format-error.js';
export function policyFormat(value,context=resultContext(),budget){
 if(!validNumeralContext(context))throw Error('representation');let {numerator:n,denominator:d}=value;budget.size(n,d);if(!d)throw Error('division');if(d<0n){n=-n;d=-d;}
 const gcd=(a,b)=>{while(b){budget.step();[a,b]=[b,a%b];}return a||1n;},divisor=gcd(n<0n?-n:n,d);n/=divisor;d/=divisor;
 const max=budget.scalarPolicy.resources.maxScalarCharacters,check=text=>{if(text.length>max)throw new DatasetResourceError();return text;};
 if(context.representation==='rational')return check(n+'/'+d);
 if(['integer','radix'].includes(context.representation)&&d!==1n)throw new ExactFormatError('NUMERAL_RESULT_INEXACT');
 const base=BigInt(context.radix);let remaining=d,digits=0;while(remaining!==1n){const g=gcd(remaining,base);if(g===1n)throw new ExactFormatError('NUMERAL_RESULT_INEXACT');remaining/=g;if(++digits>max)throw new DatasetResourceError();}
 const absolute=n<0n?-n:n,whole=(n<0n?'-':'')+(absolute/d).toString(context.radix);if(whole.length+(digits?digits+1:0)>max)throw new DatasetResourceError();
 let remainder=absolute%d;const fractional=[];while(remainder){remainder=budget.product(remainder,base);fractional.push((remainder/d).toString(context.radix));remainder%=d;}return whole+(fractional.length?'.'+fractional.join(''):'');
}

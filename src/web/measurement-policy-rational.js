// The caller supplies the saved policy budget. No unchecked large BigInt is constructed.
import {DatasetResourceError} from './dataset-resource-policy.js';
const refuse=()=>{throw new DatasetResourceError();};
export function policyRational(value,representation,radix,budget){
 const limits=budget.scalarPolicy.resources;
 if(typeof value!=='string'||value.length>limits.maxScalarCharacters)refuse();
 let source=value,sign=1n;if(source[0]==='-'||source[0]==='+'){if(source[0]==='-')sign=-1n;source=source.slice(1);}
 const integer=(digits,base)=>{let n=0n;for(const c of digits.toLowerCase()){const digit=parseInt(c,36);if(!Number.isInteger(digit)||digit>=base)throw Error('digit');n=budget.product(n,BigInt(base))+BigInt(digit);budget.size(n);}return n;};
 const reduce=(n,d)=>{budget.size(n,d);if(d===0n)throw Error('value');let a=n,b=d;while(b){budget.step();[a,b]=[b,a%b];}return {numerator:sign*n/(a||1n),denominator:d/(a||1n)};};
 if(representation==='rational'){if(!/^\d+\/[1-9]\d*$/.test(source))throw Error('value');const [n,d]=source.split('/');return reduce(integer(n,10),integer(d,10));}
 if(!['decimal','integer','radix','radix-fraction'].includes(representation))throw Error('representation');
 let exponent=0;if(representation==='decimal'){if(!/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(source))throw Error('value');const parts=source.toLowerCase().split('e');source=parts[0];exponent=Number(parts[1]??0);if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>limits.maxExponent)refuse();radix=10;}else if(representation==='integer')radix=10;
 if(!Number.isInteger(radix)||radix<2||radix>36||!(/^(?:[0-9a-z]+\.?[0-9a-z]*|\.[0-9a-z]+)$/i.test(source))||['integer','radix'].includes(representation)&&source.includes('.'))throw Error('value');
 const [whole,fraction='']=source.split('.');let n=integer(whole+fraction,radix),d=budget.power(BigInt(radix),BigInt(fraction.length));
 if(exponent>0)n=budget.product(n,budget.power(10n,BigInt(exponent)));else if(exponent<0)d=budget.product(d,budget.power(10n,BigInt(-exponent)));
 return reduce(n,d);
}

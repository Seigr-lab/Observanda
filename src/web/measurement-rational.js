import {policyRational} from './measurement-policy-rational.js';
// Parse an explicitly declared numeral context without changing its source spelling.
const text=(v,max)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
export function exactRational(value,representation='decimal',radix=10,budget){
 if(budget?.scalarPolicy)return policyRational(value,representation,radix,budget);
 if(representation==='rational'){
  if(!text(value,8192)||!/^[-+]?\d+\/[1-9]\d*$/.test(value))throw Error('value');
  let [n,d]=value.split('/').map(BigInt),a=n<0n?-n:n,b=d;while(b)[a,b]=[b,a%b];a||=1n;return {numerator:n/a,denominator:d/a};
 }
 if(!text(value,8192)||!['decimal','integer','radix','radix-fraction'].includes(representation))throw Error('representation');
 let sign=1n,source=value;if(source[0]==='-'){sign=-1n;source=source.slice(1);}else if(source[0]==='+')source=source.slice(1);
 let exponent=0;
 if(representation==='decimal'){
  if(!/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(source))throw Error('value');
  const parts=source.toLowerCase().split('e');source=parts[0];exponent=Number(parts[1]??0);
  if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>8192)throw Error('exponent');radix=10;
 }else if(representation==='integer')radix=10;
 if(!Number.isInteger(radix)||radix<2||radix>36||!(/^(?:[0-9a-z]+\.?[0-9a-z]*|\.[0-9a-z]+)$/i.test(source))||['integer','radix'].includes(representation)&&source.includes('.'))throw Error('value');
 const [whole,fraction='']=source.toLowerCase().split('.');let numerator=0n;
 for(const digit of whole+fraction){const n=parseInt(digit,36);if(n>=radix)throw Error('digit');numerator=numerator*BigInt(radix)+BigInt(n);}
 let denominator=BigInt(radix)**BigInt(fraction.length);
 if(exponent>0)numerator*=10n**BigInt(exponent);else if(exponent<0)denominator*=10n**BigInt(-exponent);
 let a=numerator,b=denominator;while(b){[a,b]=[b,a%b];}const divisor=a||1n;
 return {numerator:sign*numerator/divisor,denominator:denominator/divisor};
}

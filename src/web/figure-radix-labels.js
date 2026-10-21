import {exactRational} from './measurement-model.js';

// Convert the plot value's canonical decimal spelling, never a formatted tick.
// Retained measurements remain separate from these presentation coordinates.
export function figureRadixLabel(value,radix=10,precision=6){
 if(!Number.isFinite(value)||!Number.isInteger(radix)||radix<2||radix>36||!Number.isInteger(precision)||precision<1||precision>64)throw RangeError('Invalid figure numeral format');
 const prefix=radix+'#';if(value===0)return prefix+'0';
 const {numerator,denominator}=exactRational(String(value)),negative=numerator<0n,n=negative?-numerator:numerator,b=BigInt(radix);
 let exponent=Math.floor(Math.log(Math.abs(value))/Math.log(radix));
 const below=e=>e>=0?n<denominator*b**BigInt(e):n*b**BigInt(-e)<denominator;
 while(below(exponent))exponent--;while(!below(exponent+1))exponent++;
 const shift=precision-1-exponent,dividend=shift>=0?n*b**BigInt(shift):n,divisor=shift>=0?denominator:denominator*b**BigInt(-shift);
 let rounded=dividend/divisor;const remainder=dividend%divisor;
 if(2n*remainder>divisor||2n*remainder===divisor&&rounded%2n!==0n)rounded++;
 let digits=rounded.toString(radix);if(digits.length>precision){digits=digits.slice(0,-1);exponent++;}
 digits=digits.replace(/0+$/,'');
 let label;
 if(exponent>=-3&&exponent<6){
  const position=exponent+1;label=position<=0?'0.'+'0'.repeat(-position)+digits:position>=digits.length?digits+'0'.repeat(position-digits.length):digits.slice(0,position)+'.'+digits.slice(position);
 }else{
  label=digits[0]+(digits.length>1?'.'+digits.slice(1):'')+' × '+radix+'^('+prefix+exponent.toString(radix)+')';
 }
 return (remainder?'≈ ':'')+prefix+(negative?'-':'')+label;
}
export const figureRadixPrecision=radix=>Math.ceil(17/Math.log10(radix))+2;
export const figureNumeralHelp=style=>style.numberFormat==='radix'?'Numbers use base '+style.radix+'. The base# prefix identifies digits, including exponents and fractions. ≈ marks a rounded plot label; retained source measurements are unchanged.':'';

// Exact decimal identity of a stored plot number, expressed in the chosen base.
// Recurring fractions use an explicit ratio instead of silently rounding.
export function figureRadixValue(value,radix=10){
 if(!Number.isFinite(value)||!Number.isInteger(radix)||radix<2||radix>36)throw RangeError('Invalid figure numeral format');
 const {numerator,denominator}=exactRational(String(value)),negative=numerator<0n,n=negative?-numerator:numerator,b=BigInt(radix),prefix=radix+'#'+(negative?'-':'');
 let d=denominator;const gcd=(a,b)=>{while(b){const r=a%b;a=b;b=r;}return a;};
 while(d!==1n){const factor=gcd(d,b);if(factor===1n)return prefix+'('+n.toString(radix)+'/'+denominator.toString(radix)+')';d/=factor;}
 let label=(n/denominator).toString(radix),remainder=n%denominator;
 if(remainder){label+='.';while(remainder){remainder*=b;label+=(remainder/denominator).toString(radix);remainder%=denominator;}}
 return prefix+label;
}

import {exactRational} from './measurement-model.js';

// One rounding step, directly from the exact rational to IEEE 754 binary64.
// Intermediate decimal prefixes can double-round or underflow before division.
export function rationalProjection({numerator,denominator},budget){
 budget?.size(numerator,denominator);
 if(denominator<=0n)throw RangeError('Invalid denominator');
 if(numerator===0n)return 0;
 const negative=numerator<0n,n=negative?-numerator:numerator;
 let exponent=n.toString(2).length-denominator.toString(2).length;
 if(exponent>=0?n<(denominator<<BigInt(exponent)):(n<<BigInt(-exponent))<denominator)exponent--;
 if(exponent>1023||exponent< -1075)throw RangeError('Projection outside finite nonzero range');
 const shift=52-Math.max(-1022,exponent);
 const shifted=(value,bits)=>budget?budget.product(value,1n<<BigInt(bits)):value<<BigInt(bits);
 const dividend=shift>=0?shifted(n,shift):n,divisor=shift>=0?denominator:shifted(denominator,-shift);
 let significand=dividend/divisor;const remainder=dividend%divisor,comparison=(budget?budget.product(2n,remainder):2n*remainder)-divisor;
 if(comparison>0n||comparison===0n&&significand%2n!==0n)significand++;
 const result=Number(significand)*2**(-shift);
 if(!Number.isFinite(result)||result===0)throw RangeError('Projection outside finite nonzero range');
 return negative?-result:result;
}

// Decimal spelling must round-trip through the plot number. This does not
// promise exact binary representation for decimals such as 0.1. Source values
// remain separate, exact retained measurements.
export function safeDecimalProjection(raw){
 return safeRationalProjection(exactRational(raw),Number(raw));
}

// The safety decision depends on mathematical identity, not source notation.
// As in the decimal policy above, the displayed decimal must round-trip, and
// integral values must also survive the underlying binary coordinate exactly.
export function safeRationalProjection(exact,number,budget){
 if(number===undefined)number=rationalProjection(exact,budget);budget?.step();
 if(!Number.isFinite(number)||exact.denominator===1n&&(!Number.isInteger(number)||BigInt(number)!==exact.numerator))throw RangeError('Explicit approximation required');
 const roundTrip=exactRational(String(number));budget?.size(roundTrip.numerator,roundTrip.denominator);
 if(roundTrip.numerator!==exact.numerator||roundTrip.denominator!==exact.denominator)throw RangeError('Explicit approximation required');
 return number;
}

export function decimalPlotProjection(raw,{decimal='.',approximate=false}={}){
 const text=String(raw??'').trim();if(!text)return null;
 const normalized=decimal===','?text.replace(',','.'):text;
 return approximate?rationalProjection(exactRational(normalized)):safeDecimalProjection(normalized);
}

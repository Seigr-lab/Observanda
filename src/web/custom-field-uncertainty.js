import {exactRational} from './measurement-rational.js';

// A number field may declare how its uncertainty is written. The value stays one
// exact spelling, so every reader, history and output keeps it verbatim with its
// significant digits; each number inside it is read in the field's own numeral
// context. A value without a stated uncertainty remains valid.
//   absolute  12.30 ± 0.05   (or +/-), in the field's unit
//   relative  12.30 ± 0.4 %
//   interval  [12.25, 12.35]
export const FIELD_UNCERTAINTY_KINDS=Object.freeze(['absolute','relative','interval']);
export const validFieldUncertainty=kind=>FIELD_UNCERTAINTY_KINDS.includes(kind);
const forms={
 absolute:/^(\S+?)\s*(?:±|\+\/-)\s*(\S+)$/u,
 relative:/^(\S+?)\s*(?:±|\+\/-)\s*(\S+?)\s*%$/u,
 interval:/^\[\s*(\S+?)\s*[,;]\s*(\S+?)\s*\]$/u
};
const compare=(a,b)=>{const left=a.numerator*b.denominator,right=b.numerator*a.denominator;return left<right?-1:left>right?1:0;};
const zero={numerator:0n,denominator:1n};
// The parts of a spelling, or null when it does not follow the declared form.
export function fieldUncertaintyParts(kind,value){
 if(!validFieldUncertainty(kind)||typeof value!=='string')return null;
 const match=forms[kind].exec(value.trim());if(!match)return null;
 return kind==='interval'?{lower:match[1],upper:match[2]}:{value:match[1],uncertainty:match[2]};
}
// Reads a value of a number field with an uncertainty declaration; throws when invalid.
export function readFieldUncertainty(kind,value,representation,radix){
 if(!/[±%\[\]]|\+\/-/u.test(value))return exactRational(value,representation,radix);
 const parts=fieldUncertaintyParts(kind,value);if(!parts)throw Error('uncertainty');
 if(kind==='interval'){
  const lower=exactRational(parts.lower,representation,radix),upper=exactRational(parts.upper,representation,radix);
  if(compare(lower,upper)>0)throw Error('interval');return lower;
 }
 const central=exactRational(parts.value,representation,radix),spread=exactRational(parts.uncertainty,representation,radix);
 if(compare(spread,zero)<0)throw Error('uncertainty');return central;
}

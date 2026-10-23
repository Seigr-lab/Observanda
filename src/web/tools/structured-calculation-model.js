// Engine identity is independent of the parser/library pin in a saved policy.
export const STRUCTURED_CALCULATION_ENGINE=Object.freeze({name:'observanda-exact-structured',version:1});
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const rational=value=>exact(value,['numerator','denominator'])&&typeof value.numerator==='string'&&/^(?:0|-?[1-9][0-9]*)$/.test(value.numerator)&&typeof value.denominator==='string'&&/^[1-9][0-9]*$/.test(value.denominator);
export function validStructuredResult(value){
 if(!exact(value,['version','codec','shape','components'])||value.version!==1||!['vector','matrix','complex'].includes(value.codec)||!Array.isArray(value.shape)||!value.shape.every(n=>Number.isSafeInteger(n)&&n>0))return false;
 if(value.codec==='matrix'?value.shape.length!==2:value.shape.length!==1||value.codec==='complex'&&value.shape[0]!==2)return false;
 const count=value.shape.reduce((a,b)=>a*b,1);return Number.isSafeInteger(count)&&count<=1048576&&Array.isArray(value.components)&&value.components.length===count&&value.components.every(rational);
}

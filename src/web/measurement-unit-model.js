// Optional declared units. Axis identities are authored, never inferred from labels.
import {exactRational} from './measurement-rational.js';
import {validNumeralContext} from './numeral-context.js';
const keys=(value,list)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===list.length&&list.every(key=>Object.hasOwn(value,key));
const axis=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_.:/-]{0,99}$/.test(value);
export const UNIT_KINDS=['difference','absolute'];
export const exactUnitScalar=(spelling='0',representation='integer',radix=10)=>({spelling,representation,radix});
export const blankUnitDefinition=()=>({version:1,kind:'difference',dimensions:[],scale:exactUnitScalar('1'),offset:exactUnitScalar('0')});
export function unitScalar(value){
 if(!keys(value,['spelling','representation','radix'])||typeof value.spelling!=='string'||value.spelling.length>8192||!validNumeralContext({version:1,representation:value.representation,radix:value.radix}))throw RangeError('Invalid exact unit scalar');
 return exactRational(value.spelling,value.representation,value.radix);
}
export function validUnitDefinition(value){
 if(!keys(value,['version','kind','dimensions','scale','offset'])||value.version!==1||!UNIT_KINDS.includes(value.kind)||!Array.isArray(value.dimensions)||value.dimensions.length>16)return false;
 if(!value.dimensions.every((d,i)=>keys(d,['axis','exponent'])&&axis(d.axis)&&Number.isInteger(d.exponent)&&d.exponent!==0&&Math.abs(d.exponent)<=32&&(i===0||value.dimensions[i-1].axis<d.axis)))return false;
 try{return unitScalar(value.scale).numerator>0n&&(value.kind==='absolute'||unitScalar(value.offset).numerator===0n)&&!!unitScalar(value.offset);}catch{return false;}
}
function definition(value){if(!validUnitDefinition(value))throw RangeError('Invalid unit definition');return value;}
export function sameUnitDimensions(a,b){return !!a&&!!b&&a.dimensions.length===b.dimensions.length&&a.dimensions.every((d,i)=>d.axis===b.dimensions[i].axis&&d.exponent===b.dimensions[i].exponent);}
export function sameUnitDefinition(a,b){if(!validUnitDefinition(a)||!validUnitDefinition(b)||a.kind!==b.kind||!sameUnitDimensions(a,b))return false;return ['scale','offset'].every(key=>{const left=unitScalar(a[key]),right=unitScalar(b[key]);return left.numerator===right.numerator&&left.denominator===right.denominator;});}
const reduce=({numerator:n,denominator:d})=>{if(d===0n)throw RangeError('Zero unit denominator');if(d<0n){n=-n;d=-d;}let a=n<0n?-n:n,b=d;while(b)[a,b]=[b,a%b];const g=a||1n;return {numerator:n/g,denominator:d/g};};
const add=(a,b)=>reduce({numerator:a.numerator*b.denominator+b.numerator*a.denominator,denominator:a.denominator*b.denominator});
const multiply=(a,b)=>reduce({numerator:a.numerator*b.numerator,denominator:a.denominator*b.denominator});
export function canonicalUnitValue(exact,unit){definition(unit);return add(multiply(exact,unitScalar(unit.scale)),unitScalar(unit.offset));}
export function fromCanonicalUnitValue(exact,unit){definition(unit);const scale=unitScalar(unit.scale),offset=unitScalar(unit.offset);return multiply(add(exact,{...offset,numerator:-offset.numerator}),{numerator:scale.denominator,denominator:scale.numerator});}
export function convertUnitValue(exact,from,to){definition(from);definition(to);if(from.kind!==to.kind||!sameUnitDimensions(from,to))throw RangeError('Incompatible declared units');return fromCanonicalUnitValue(canonicalUnitValue(exact,from),to);}
const expected=(kind,dimensions)=>({kind,dimensions:dimensions.map(d=>({...d}))});
export function unitOperationDimensions(operation,left,right=null,exponent=null){
 definition(left);if(right)definition(right);
 const same=()=>{if(!right||!sameUnitDimensions(left,right))throw RangeError('Incompatible declared dimensions');};
 const difference=()=>{if(left.kind!=='difference'||right&&right.kind!=='difference')throw RangeError('Absolute quantities cannot be multiplied or divided');};
 if(['copy','floor','ceiling'].includes(operation))return expected(left.kind,left.dimensions);
 if(['choose','compare','remainder','quotient'].includes(operation)){
  same();if(left.kind!==right.kind)throw RangeError('Absolute and difference quantities are distinct');
  if(['quotient','remainder'].includes(operation))difference();
  return expected(operation==='quotient'?'difference':left.kind,operation==='quotient'?[]:left.dimensions);
 }
 if(['add','subtract'].includes(operation)){
  same();if(operation==='add'&&left.kind==='absolute'&&right.kind==='absolute'||operation==='subtract'&&left.kind==='difference'&&right.kind==='absolute')throw RangeError('Invalid absolute quantity arithmetic');
  return expected(operation==='subtract'&&left.kind===right.kind?'difference':left.kind==='absolute'||right.kind==='absolute'?'absolute':'difference',left.dimensions);
 }
 if(['multiply','divide'].includes(operation)){
  if(!right)throw RangeError('A second declared quantity is required');difference();const dimensions=new Map(left.dimensions.map(d=>[d.axis,d.exponent]));
  for(const d of right.dimensions)dimensions.set(d.axis,(dimensions.get(d.axis)??0)+(operation==='divide'?-1:1)*d.exponent);
  const result=[...dimensions].filter(([,n])=>n!==0).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([axis,exponent])=>({axis,exponent}));
  if(result.length>16||result.some(d=>Math.abs(d.exponent)>32))throw RangeError('Declared dimension exponent exceeds its limit');return expected('difference',result);
 }
 if(operation==='power'){
  difference();if(!right||right.dimensions.length||!exponent||exponent.denominator!==1n)throw RangeError('Unit powers require a dimensionless integer');
  const result=left.dimensions.map(d=>{const power=BigInt(d.exponent)*exponent.numerator;if(power< -32n||power>32n)throw RangeError('Declared dimension exponent exceeds its limit');return {...d,exponent:Number(power)};}).filter(d=>d.exponent!==0);return expected('difference',result);
 }
 throw RangeError('Unsupported unit operation');
}
export function assertUnitOperation(operation,left,right,output,exponent=null){
 const result=unitOperationDimensions(operation,left,right,exponent);definition(output);if(output.kind!==result.kind||!sameUnitDimensions(result,output))throw RangeError('Output unit does not match the declared operation');return result;
}

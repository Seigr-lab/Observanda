// Optional declared units. Axis identities are authored, never inferred from labels.
import {validDatasetResourcePolicy} from './dataset-resource-policy.js';
import {validPolicyScalar,validatePolicyScalar,withScalarPolicy} from './measurement-scalar-policy.js';
import {exactRational} from './measurement-rational.js';
import {validNumeralContext} from './numeral-context.js';
const keys=(value,list)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===list.length&&list.every(key=>Object.hasOwn(value,key));
const axis=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_.:/-]{0,99}$/.test(value);
export const UNIT_KINDS=['difference','absolute'];
export const exactUnitScalar=(spelling='0',representation='integer',radix=10)=>({spelling,representation,radix});
export const blankUnitDefinition=()=>({version:1,kind:'difference',dimensions:[],scale:exactUnitScalar('1'),offset:exactUnitScalar('0')});
export function unitScalar(value,budget,policy){
 if(policy)return validatePolicyScalar(value,policy,{budget});
 if(!keys(value,['spelling','representation','radix'])||typeof value.spelling!=='string'||value.spelling.length>8192||!validNumeralContext({version:1,representation:value.representation,radix:value.radix}))throw RangeError('Invalid exact unit scalar');
 return exactRational(value.spelling,value.representation,value.radix,budget);
}
export function validUnitDefinition(value){
 if(!keys(value,['version','kind','dimensions','scale','offset',...(value?.version===2?['resourcePolicy']:[])])||![1,2].includes(value.version)||!UNIT_KINDS.includes(value.kind)||!Array.isArray(value.dimensions)||value.dimensions.length>16)return false;
 if(!value.dimensions.every((d,i)=>keys(d,['axis','exponent'])&&axis(d.axis)&&Number.isInteger(d.exponent)&&d.exponent!==0&&Math.abs(d.exponent)<=32&&(i===0||value.dimensions[i-1].axis<d.axis)))return false;
 if(value.version===2)return validDatasetResourcePolicy(value.resourcePolicy)&&validPolicyScalar(value.scale,value.resourcePolicy)&&validPolicyScalar(value.offset,value.resourcePolicy);
 try{return unitScalar(value.scale).numerator>0n&&(value.kind==='absolute'||unitScalar(value.offset).numerator===0n)&&!!unitScalar(value.offset);}catch{return false;}
}
function parsedDefinition(value,budget){if(!validUnitDefinition(value))throw RangeError('Invalid unit definition');const scale=unitScalar(value.scale,budget,value.resourcePolicy),offset=unitScalar(value.offset,budget,value.resourcePolicy);if(scale.numerator<=0n||value.kind==='difference'&&offset.numerator!==0n)throw RangeError('Invalid unit definition');return {scale,offset};}
export function validateUnitDefinition(value,{budget}={}){if(value?.version===2)parsedDefinition(value,budget);else if(!validUnitDefinition(value))throw RangeError('Invalid unit definition');return value;}
const definition=(value,budget)=>validateUnitDefinition(value,{budget});
export function sameUnitDimensions(a,b){return !!a&&!!b&&a.dimensions.length===b.dimensions.length&&a.dimensions.every((d,i)=>d.axis===b.dimensions[i].axis&&d.exponent===b.dimensions[i].exponent);}
export function sameUnitDefinition(a,b,budget){if(!validUnitDefinition(a)||!validUnitDefinition(b)||a.kind!==b.kind||!sameUnitDimensions(a,b))return false;const left=parsedDefinition(a,budget),right=parsedDefinition(b,budget);return ['scale','offset'].every(key=>left[key].numerator===right[key].numerator&&left[key].denominator===right[key].denominator);}
export function reduceUnitRational({numerator:n,denominator:d},budget){if(d===0n)throw RangeError('Zero unit denominator');budget?.size(n,d);if(d<0n){n=-n;d=-d;}let a=n<0n?-n:n,b=d;while(b){budget?.step();[a,b]=[b,a%b];}const g=a||1n;return {numerator:n/g,denominator:d/g};}
const product=(a,b,budget)=>budget?budget.product(a,b):a*b;
export const addUnitRational=(a,b,budget)=>reduceUnitRational({numerator:product(a.numerator,b.denominator,budget)+product(b.numerator,a.denominator,budget),denominator:product(a.denominator,b.denominator,budget)},budget);
export const multiplyUnitRational=(a,b,budget)=>reduceUnitRational({numerator:product(a.numerator,b.numerator,budget),denominator:product(a.denominator,b.denominator,budget)},budget);
export const divideUnitRational=(a,b,budget)=>multiplyUnitRational(a,{numerator:b.denominator,denominator:b.numerator},budget);
function unitOperation(unit,budget,operation){const run=b=>operation(parsedDefinition(unit,b),b);return unit.version===2?withScalarPolicy(unit.resourcePolicy,budget,run):run(budget);}
export function canonicalUnitValue(exact,unit,budget){return unitOperation(unit,budget,({scale,offset},b)=>addUnitRational(multiplyUnitRational(exact,scale,b),offset,b));}
export function fromCanonicalUnitValue(exact,unit,budget){return unitOperation(unit,budget,({scale,offset},b)=>multiplyUnitRational(addUnitRational(exact,{...offset,numerator:-offset.numerator},b),{numerator:scale.denominator,denominator:scale.numerator},b));}
export function convertUnitValue(exact,from,to,budget){if(!validUnitDefinition(from)||!validUnitDefinition(to)||from.kind!==to.kind||!sameUnitDimensions(from,to))throw RangeError('Incompatible declared units');return fromCanonicalUnitValue(canonicalUnitValue(exact,from,budget),to,budget);}
const expected=(kind,dimensions)=>({kind,dimensions:dimensions.map(d=>({...d}))});
export function unitOperationDimensions(operation,left,right=null,exponent=null,budget){
 definition(left,budget);if(right)definition(right,budget);
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
export function assertUnitOperation(operation,left,right,output,exponent=null,budget){
 const result=unitOperationDimensions(operation,left,right,exponent,budget);definition(output,budget);if(output.kind!==result.kind||!sameUnitDimensions(result,output))throw RangeError('Output unit does not match the declared operation');return result;
}

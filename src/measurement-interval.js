// Exact closed-set enclosures; repeated operands do not imply correlation.
import {ArithmeticBudget,ExactNumber,exactExpression} from './tools/exact-arithmetic.js';
import {exactRational} from './web/measurement-rational.js';
import {validNumeralContext} from './web/numeral-context.js';
import {validUnitDefinition,unitScalar,assertUnitOperation,sameUnitDimensions} from './web/measurement-unit-model.js';
export class IntervalError extends Error{constructor(message,code='MEASUREMENT_INTERVAL_INVALID'){super(message);this.code=code;}}
const rational=value=>({numerator:value.n,denominator:value.d});
function number(value,budget){
 if(!value||typeof value.numerator!=='bigint'||typeof value.denominator!=='bigint'||value.denominator<=0n)throw new IntervalError('A finite exact interval endpoint is required.');
 return new ExactNumber(value.numerator,value.denominator,budget);
}
function calculate(operation,values,budget){
 const variables=Object.fromEntries(values.map((value,index)=>['v'+index,number(value,budget)]));
 return rational(exactExpression({type:'FunctionNode',name:operation,args:values.map((_,index)=>({type:'SymbolNode',name:'v'+index}))},variables,budget));
}
const compare=(a,b,budget)=>{const difference=calculate('subtract',[a,b],budget);return difference.numerator<0n?-1:difference.numerator>0n?1:0;};
function bounds(value,budget){
 if(!value||Object.keys(value).length!==2||!Object.hasOwn(value,'lower')||!Object.hasOwn(value,'upper'))throw new IntervalError('Two exact closed interval bounds are required.');
 const lower=rational(number(value.lower,budget)),upper=rational(number(value.upper,budget));if(compare(lower,upper,budget)>0)throw new IntervalError('The lower interval bound exceeds its upper bound.');return {lower,upper};
}
export function parseIntervalBounds(values,context,{budget=new ArithmeticBudget()}={}){
 if(!Array.isArray(values)||values.length!==2||!values.every(value=>typeof value==='string')||!validNumeralContext(context))throw new IntervalError('Two scalar interval bounds with a declared numeral context are required.');
 const [lower,upper]=values.map(value=>exactRational(value,context.representation,context.radix,budget));return bounds({lower,upper},budget);
}
function canonical(value,unit,budget){
 if(!validUnitDefinition(unit))throw new IntervalError('A valid declared interval unit is required.');
 const scale=unitScalar(unit.scale,budget),offset=unitScalar(unit.offset,budget);return calculate('add',[calculate('multiply',[value,scale],budget),offset],budget);
}
function fromCanonical(value,unit,budget){
 if(!validUnitDefinition(unit))throw new IntervalError('A valid declared interval unit is required.');
 return calculate('divide',[calculate('subtract',[value,unitScalar(unit.offset)],budget),unitScalar(unit.scale)],budget);
}
const map=(value,operation)=>({lower:operation(value.lower),upper:operation(value.upper)});
export function convertIntervalBounds(value,from,to,{budget=new ArithmeticBudget()}={}){
 if(!validUnitDefinition(from)||!validUnitDefinition(to)||from.kind!==to.kind||!sameUnitDimensions(from,to))throw new IntervalError('Interval units must have compatible declared dimensions and quantity kinds.');
 return bounds(map(bounds(value,budget),endpoint=>fromCanonical(canonical(endpoint,from,budget),to,budget)),budget);
}
export function calculateIntervalBounds(operation,left,right,{leftUnit=null,rightUnit=null,outputUnit=null,budget=new ArithmeticBudget()}={}){
 if(!['add','subtract','multiply','divide'].includes(operation))throw new IntervalError('Unsupported interval enclosure operation.');
 let a=bounds(left,budget),b=bounds(right,budget);const typed=[leftUnit,rightUnit,outputUnit];
 if(typed.some(Boolean)){
  if(!typed.every(Boolean))throw new IntervalError('Declared and undeclared interval units cannot be mixed.');
  assertUnitOperation(operation,leftUnit,rightUnit,outputUnit);a=map(a,value=>canonical(value,leftUnit,budget));b=map(b,value=>canonical(value,rightUnit,budget));
 }
 let result;
 if(operation==='add')result={lower:calculate('add',[a.lower,b.lower],budget),upper:calculate('add',[a.upper,b.upper],budget)};
 else if(operation==='subtract')result={lower:calculate('subtract',[a.lower,b.upper],budget),upper:calculate('subtract',[a.upper,b.lower],budget)};
 else{
  if(operation==='divide'&&b.lower.numerator<=0n&&b.upper.numerator>=0n)throw new IntervalError('An interval divisor containing zero has no finite enclosure.');
  const corners=[];for(const x of [a.lower,a.upper])for(const y of [b.lower,b.upper])corners.push(calculate(operation,[x,y],budget));
  result={lower:corners.reduce((a,b)=>compare(a,b,budget)<=0?a:b),upper:corners.reduce((a,b)=>compare(a,b,budget)>=0?a:b)};
 }
 if(outputUnit)result=map(result,value=>fromCanonical(value,outputUnit,budget));return bounds(result,budget);
}
// Stored domain components use the existing exact-scalar admission limit.
// Refuse a result that could not subsequently reopen; never trim or round it.
export function intervalComponents(value,{budget=new ArithmeticBudget()}={}){
 const checked=bounds(value,budget);return [checked.lower,checked.upper].map(endpoint=>{const text=String(endpoint.numerator)+'/'+String(endpoint.denominator);if(text.length>8192)throw new IntervalError('Exact interval component exceeds the retained scalar capacity.','MEASUREMENT_DOMAIN_COMPONENT_LIMIT');return text;});
}

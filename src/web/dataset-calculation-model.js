import {exactRational,measurementRef,validQuantity} from './measurement-model.js';
import {validConstantType,constantExact} from './calculation-operands.js';
import {KEY_SEMANTICS} from './measurement-keys.js';
import {validNumeralContext} from './numeral-context.js';
import {formatExactResult} from './measurement-format.js';
export {rationalText} from './measurement-format.js';
const keys=(o,list)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>list.includes(k));
const text=(v,max)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
export const CALCULATION_OPERATIONS=['copy','add','subtract','multiply','divide','choose','quotient','remainder','floor','ceiling','power'];
export const calculationOperations=(version=3)=>version===3?CALCULATION_OPERATIONS:CALCULATION_OPERATIONS.slice(0,6);
export const calculationUnary=operation=>['copy','floor','ceiling'].includes(operation);
export const CALCULATION_COMPARISONS=['eq','ne','lt','lte','gt','gte'];
export const validOperand=(o,count,version=1)=>keys(o,['column'])&&Number.isInteger(o.column)&&o.column>=0&&o.column<count||keys(o,['constant','unit','representation','radix',...(version===3?['quantity']:[])])&&text(o.constant,8192)&&text(o.unit,100)&&validConstantType(o)&&(o.quantity===undefined||validQuantity(o.quantity,o.unit));
export function validCondition(c,count,version=1){
 let nodes=0;const check=(value,depth)=>{
  if(++nodes>64||depth>8)return false;
  if(version===3&&['and','or'].includes(value?.operator))return keys(value,['operator','conditions'])&&Array.isArray(value.conditions)&&value.conditions.length>=2&&value.conditions.length<=16&&value.conditions.every(v=>check(v,depth+1));
  if(version===3&&value?.operator==='not')return keys(value,['operator','condition'])&&check(value.condition,depth+1);
  return keys(value,['left','right','operator'])&&validOperand(value.left,count,version)&&validOperand(value.right,count,version)&&CALCULATION_COMPARISONS.includes(value.operator);
 };return check(c,0);
}
export function* conditionOperands(condition){
 if(!condition)return;
 if(condition.operator==='not')yield* conditionOperands(condition.condition);
 else if(['and','or'].includes(condition.operator)){for(const child of condition.conditions)yield* conditionOperands(child);}
 else{yield condition.left;yield condition.right;}
}
export function* calculationQuantities(calculation){
 for(const condition of [calculation.where,...calculation.joins.map(j=>j.where)])for(const operand of conditionOperands(condition))if(operand.quantity)yield operand.quantity;
 for(const step of calculation.steps){if(step.quantity)yield step.quantity;for(const operand of [step.left,step.right,...conditionOperands(step.condition)])if(operand?.quantity)yield operand.quantity;}
}
export const validCalculationProjection=v=>Array.isArray(v)&&v.length>0&&v.length<=256&&new Set(v).size===v.length&&v.every(i=>Number.isSafeInteger(i)&&i>=0);
export function validCalculation(v){
 if(!keys(v,['version','source','view','joins','steps','where','selectionReason','calibration','note',...(v?.version>=2?['projection']:[])])||![1,2,3].includes(v.version)||!measurementRef(v.source)||!['dataset','analysis'].includes(v.source.kind)||!['observations','distribution','transitions'].includes(v.view)||!Array.isArray(v.joins)||v.joins.length>4||!Array.isArray(v.steps)||v.steps.length>64||!text(v.selectionReason,1000)||!text(v.note,10000)||v.calibration!==null&&!measurementRef(v.calibration))return false;
 if(v.version>=2&&!validCalculationProjection(v.projection))return false;
 if(v.version>=2&&v.joins.some(j=>!validCalculationProjection(j?.projection)))return false;
 if(v.version>=2&&v.projection.length+v.joins.reduce((n,j)=>n+j.projection.length,0)+v.steps.length>256)return false;
 if(v.where!==null&&!validCondition(v.where,256,v.version))return false;
 if(v.where&&!v.selectionReason.trim())return false;
 return v.joins.every(j=>keys(j,['dataset','keys','where','unmatched',...(v.version>=2?['projection']:[])])&&measurementRef(j.dataset)&&j.dataset.kind==='dataset'&&Array.isArray(j.keys)&&j.keys.length>0&&j.keys.length<=8&&j.keys.every(k=>keys(k,['left','right','semantics'])&&Number.isInteger(k.left)&&k.left>=0&&k.left<256&&Number.isInteger(k.right)&&k.right>=0&&k.right<256&&(k.semantics===undefined||KEY_SEMANTICS.includes(k.semantics)))&&(j.where===null||validCondition(j.where,256,v.version))&&['error','keep'].includes(j.unmatched))&&v.steps.every(s=>keys(s,['name','unit','operation','left','right','condition','output',...(v.version===3?['quantity']:[])])&&text(s.name,200)&&s.name.trim()&&text(s.unit,100)&&(s.output===undefined||validNumeralContext(s.output))&&(s.quantity===undefined||validQuantity(s.quantity,s.unit))&&calculationOperations(v.version).includes(s.operation)&&validOperand(s.left,256,v.version)&&(calculationUnary(s.operation)?s.right===null:validOperand(s.right,256,v.version))&&(s.operation==='choose'?validCondition(s.condition,256,v.version):s.condition===null));
}
export function operandValue(operand,row,columns){
 if(Object.hasOwn(operand,'constant')){
  const exact=constantExact(operand);
  return {raw:operand.constant,exact,unit:operand.unit,quantity:operand.quantity,present:true,sources:[]};
 }
 const i=operand.column,c=columns[i],raw=row.cells[i];
 const present=!['absent','null'].includes(row.valueKinds?.[i])&&!c.missing.some(m=>m.value===raw);let exact=null;
 if(present&&!['text','unsupported'].includes(c.representation))exact=exactRational(raw,c.representation,c.radix);
 return {raw,exact,unit:c.unit,quantity:c.quantity,present,sources:row.cellSources?.[i]??[]};
}
export function calculationCondition(c,row,columns){
 const a=operandValue(c.left,row,columns),b=operandValue(c.right,row,columns);if(!a.present||!b.present)return null;
 let order;if(a.exact&&b.exact){if(a.unit!==b.unit)throw Error('unit');const n=a.exact.numerator*b.exact.denominator-b.exact.numerator*a.exact.denominator;order=n<0n?-1:n>0n?1:0;}
 else{if(!['eq','ne'].includes(c.operator))throw Error('numeric');order=a.raw===b.raw?0:1;}
 return {eq:order===0,ne:order!==0,lt:order<0,lte:order<=0,gt:order>0,gte:order>=0}[c.operator];
}
export function calculateStep(s,row,columns){
 const a=operandValue(s.left,row,columns),b=s.right?operandValue(s.right,row,columns):null;
 const condition=s.condition?calculationCondition(s.condition,row,columns):true;
 const selected=s.operation==='choose'?(condition?a:b):a;
 const sources=[...new Map([...(a.sources??[]),...(b?.sources??[]),...(s.condition?[...operandValue(s.condition.left,row,columns).sources,...operandValue(s.condition.right,row,columns).sources]:[])].map(v=>[JSON.stringify(v),v])).values()];
 if(condition===null||!selected.present||!['copy','choose'].includes(s.operation)&&!b.present)return {value:'',kind:'absent',sources};
 if(!selected.exact||b&&!['copy','choose'].includes(s.operation)&&!b.exact)throw Error('numeric');
 if(['copy','choose','add','subtract'].includes(s.operation)&&(a.unit!==s.unit||b&&b.unit!==s.unit))throw Error('unit');
 let n=selected.exact.numerator,d=selected.exact.denominator;
 if(s.operation==='add'||s.operation==='subtract'){n=a.exact.numerator*b.exact.denominator+(s.operation==='add'?1n:-1n)*b.exact.numerator*a.exact.denominator;d=a.exact.denominator*b.exact.denominator;}
 if(s.operation==='multiply'){n=a.exact.numerator*b.exact.numerator;d=a.exact.denominator*b.exact.denominator;}
 if(s.operation==='divide'){n=a.exact.numerator*b.exact.denominator;d=a.exact.denominator*b.exact.numerator;}
 return {value:formatExactResult({numerator:n,denominator:d},s.output),kind:'string',sources};
}

import {exactRational,measurementRef} from './measurement-model.js';
import {validConstantType,constantExact} from './calculation-operands.js';
import {KEY_SEMANTICS} from './measurement-keys.js';
import {validNumeralContext} from './numeral-context.js';
import {formatExactResult} from './measurement-format.js';
export {rationalText} from './measurement-format.js';
const keys=(o,list)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>list.includes(k));
const text=(v,max)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
export const CALCULATION_OPERATIONS=['copy','add','subtract','multiply','divide','choose'];
export const CALCULATION_COMPARISONS=['eq','ne','lt','lte','gt','gte'];
export const validOperand=(o,count)=>keys(o,['column'])&&Number.isInteger(o.column)&&o.column>=0&&o.column<count||keys(o,['constant','unit','representation','radix'])&&text(o.constant,8192)&&text(o.unit,100)&&validConstantType(o);
export const validCondition=(c,count)=>keys(c,['left','right','operator'])&&validOperand(c.left,count)&&validOperand(c.right,count)&&CALCULATION_COMPARISONS.includes(c.operator);
export function validCalculation(v){
 if(!keys(v,['version','source','view','joins','steps','where','selectionReason','calibration','note'])||v.version!==1||!measurementRef(v.source)||!['dataset','analysis'].includes(v.source.kind)||!['observations','distribution','transitions'].includes(v.view)||!Array.isArray(v.joins)||v.joins.length>4||!Array.isArray(v.steps)||v.steps.length>64||!text(v.selectionReason,1000)||!text(v.note,10000)||v.calibration!==null&&!measurementRef(v.calibration))return false;
 if(v.where!==null&&!validCondition(v.where,256))return false;
 if(v.where&&!v.selectionReason.trim())return false;
 return v.joins.every(j=>keys(j,['dataset','keys','where','unmatched'])&&measurementRef(j.dataset)&&j.dataset.kind==='dataset'&&Array.isArray(j.keys)&&j.keys.length>0&&j.keys.length<=8&&j.keys.every(k=>keys(k,['left','right','semantics'])&&Number.isInteger(k.left)&&k.left>=0&&k.left<256&&Number.isInteger(k.right)&&k.right>=0&&k.right<256&&(k.semantics===undefined||KEY_SEMANTICS.includes(k.semantics)))&&(j.where===null||validCondition(j.where,256))&&['error','keep'].includes(j.unmatched))&&v.steps.every(s=>keys(s,['name','unit','operation','left','right','condition','output'])&&text(s.name,200)&&s.name.trim()&&text(s.unit,100)&&(s.output===undefined||validNumeralContext(s.output))&&CALCULATION_OPERATIONS.includes(s.operation)&&validOperand(s.left,256)&&(s.operation==='copy'?s.right===null:validOperand(s.right,256))&&(s.operation==='choose'?validCondition(s.condition,256):s.condition===null));
}
export function operandValue(operand,row,columns){
 if(Object.hasOwn(operand,'constant')){
  const exact=constantExact(operand);
  return {raw:operand.constant,exact,unit:operand.unit,present:true,sources:[]};
 }
 const i=operand.column,c=columns[i],raw=row.cells[i];
 const present=!['absent','null'].includes(row.valueKinds?.[i])&&!c.missing.some(m=>m.value===raw);let exact=null;
 if(present&&!['text','unsupported'].includes(c.representation))exact=exactRational(raw,c.representation,c.radix);
 return {raw,exact,unit:c.unit,present,sources:row.cellSources?.[i]??[]};
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

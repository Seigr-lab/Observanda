import {isScalarRepresentation} from './web/measurement-model.js';
// Version 3 retained scalar calculations reuse the calculator's bounded exact engine.
import {ArithmeticBudget,ExactNumber,exactExpression} from './tools/exact-arithmetic.js';
import {operandValue,conditionOperands} from './web/dataset-calculation-model.js';
import {constantExact} from './web/calculation-operands.js';
import {formatExactResult} from './web/measurement-format.js';
import {canonicalUnitValue,fromCanonicalUnitValue,assertUnitOperation,unitOperationDimensions,sameUnitDefinition} from './web/measurement-unit-model.js';
const exact=value=>({numerator:value.n,denominator:value.d});
const definition=value=>value?.quantity?.unitDefinition;
function checked(value,budget){if(!value)throw Error('numeric');return exact(new ExactNumber(value.numerator,value.denominator,budget));}
function operation(name,values,budget){
 const variables=Object.fromEntries(values.map((value,i)=>['v'+i,new ExactNumber(value.numerator,value.denominator,budget)]));
 const result=exactExpression({type:'FunctionNode',name,args:values.map((_,i)=>({type:'SymbolNode',name:'v'+i}))},variables,budget);
 if(!result)throw Error('An exact integer exponent is required');return exact(result);
}
function canonical(value,budget){const input=checked(value.exact,budget);return definition(value)?checked(canonicalUnitValue(input,definition(value)),budget):input;}
function output(value,step,budget){return definition(step)?checked(fromCanonicalUnitValue(value,definition(step)),budget):value;}
function typed(...values){const declared=values.map(definition);if(declared.some(Boolean)&&!declared.every(Boolean))throw Error('Declared and undeclared quantities cannot be mixed');return declared.every(Boolean);}
export function exactCalculationCondition(condition,row,columns,budget=new ArithmeticBudget()){
 budget.step();
 if(condition.operator==='not'){const value=exactCalculationCondition(condition.condition,row,columns,budget);return value===null?null:!value;}
 if(['and','or'].includes(condition.operator)){
  let unknown=false;for(const child of condition.conditions){const value=exactCalculationCondition(child,row,columns,budget);if(value===null)unknown=true;else if(value===(condition.operator==='or'))return value;}
  return unknown?null:condition.operator==='and';
 }
 const a=operandValue(condition.left,row,columns),b=operandValue(condition.right,row,columns);if(!a.present||!b.present)return null;
 let order;
 if(a.exact&&b.exact){if(typed(a,b))unitOperationDimensions('compare',definition(a),definition(b));else if(a.unit!==b.unit)throw Error('unit');const difference=operation('subtract',[canonical(a,budget),canonical(b,budget)],budget);order=difference.numerator<0n?-1:difference.numerator>0n?1:0;}
 else{if(!!a.exact!==!!b.exact||definition(a)||definition(b)||!['eq','ne'].includes(condition.operator))throw Error('numeric');order=a.raw===b.raw?0:1;}
 return {eq:order===0,ne:order!==0,lt:order<0,lte:order<=0,gt:order>0,gte:order>=0}[condition.operator];
}
export function calculateExactStep(step,row,columns,budget=new ArithmeticBudget()){
 const a=operandValue(step.left,row,columns),b=step.right?operandValue(step.right,row,columns):null,condition=step.condition?exactCalculationCondition(step.condition,row,columns,budget):true;
 const selected=step.operation==='choose'?(condition?a:b):a;
 const sources=[...new Map([a,b,...[...conditionOperands(step.condition)].map(o=>operandValue(o,row,columns))].filter(Boolean).flatMap(o=>o.sources??[]).map(v=>[JSON.stringify(v),v])).values()];
 if(condition===null||!selected.present||!['copy','choose','floor','ceiling'].includes(step.operation)&&!b.present)return {value:'',kind:'absent',sources};
 const declared=typed(a,...(b?[b]:[]),step);let value;
 if(declared){
  const exponent=step.operation==='power'?canonical(b,budget):null;assertUnitOperation(step.operation,definition(a),definition(b),definition(step),exponent);
  if(['floor','ceiling'].includes(step.operation)&&(!sameUnitDefinition(definition(a),definition(step))||a.unit!==step.unit))throw Error('Rounding preserves the authored unit');
 }else{
  if(['copy','choose','add','subtract','floor','ceiling','remainder'].includes(step.operation)&&(a.unit!==step.unit||b&&b.unit!==step.unit))throw Error('unit');
  if(step.operation==='quotient'&&(a.unit!==b.unit||step.unit!==''))throw Error('unit');
  if(step.operation==='power'&&b.unit!=='')throw Error('A power exponent must be dimensionless');
 }
 if(['copy','choose'].includes(step.operation))value=output(canonical(selected,budget),step,budget);
 else if(['floor','ceiling'].includes(step.operation))value=operation(step.operation==='ceiling'?'ceil':'floor',[checked(a.exact,budget)],budget);
 else value=output(operation(step.operation==='power'?'pow':step.operation,[canonical(a,budget),canonical(b,budget)],budget),step,budget);
 return {value:formatExactResult(value,step.output),kind:'string',sources};
}

export function exactCalculationKey(value,column){
 const budget=new ArithmeticBudget(),operand=operandValue({column:0},{cells:[value]},[column]);if(!operand.exact)throw Error('numeric');const number=canonical(operand,budget),unit=definition(operand);
 return [number.numerator.toString(),number.denominator.toString(),unit?{kind:unit.kind,dimensions:unit.dimensions}:column.unit];
}

function operandSchema(operand,columns){
 if(Object.hasOwn(operand,'constant'))return {...operand,exact:constantExact(operand),numeric:constantExact(operand)!==null};
 const column=columns[operand.column];return {...column,numeric:isScalarRepresentation(column)};
}
export function validateExactComparison(a,b){
 if(a.representation==='domain'||b.representation==='domain')throw Error('Domain values require declared domain comparison');
 if(a.numeric!==b.numeric)throw Error('Numeric values and text symbols are distinct');
 if(definition(a)||definition(b)){typed(a,b);if(!a.numeric||!b.numeric)throw Error('Declared quantities require numeric operands');unitOperationDimensions('compare',definition(a),definition(b));}
 else if(a.numeric&&b.numeric&&a.unit!==b.unit)throw Error('unit');
}
export function validateExactCondition(condition,columns){
 if(!condition)return;if(condition.operator==='not')return validateExactCondition(condition.condition,columns);if(condition.conditions){for(const child of condition.conditions)validateExactCondition(child,columns);return;}
 const a=operandSchema(condition.left,columns),b=operandSchema(condition.right,columns);validateExactComparison(a,b);if(!['eq','ne'].includes(condition.operator)&&(!a.numeric||!b.numeric))throw Error('numeric');
}
export function validateExactStep(step,columns){
 validateExactCondition(step.condition,columns);const a=operandSchema(step.left,columns),b=step.right?operandSchema(step.right,columns):null;if(!a.numeric||b&&!b.numeric)throw Error('numeric');
 if(typed(a,...(b?[b]:[]),step)){
  if(step.operation==='power'&&!Object.hasOwn(step.right,'constant')){
   let possible=false;for(let exponent=-32;exponent<=32;exponent++){try{assertUnitOperation('power',definition(a),definition(b),definition(step),{numerator:BigInt(exponent),denominator:1n});possible=true;break;}catch{}}
   if(!possible)throw Error('Output dimensions cannot result from an integer power');
  }else assertUnitOperation(step.operation,definition(a),definition(b),definition(step),step.operation==='power'?canonical(b,new ArithmeticBudget()):null);
  if(['floor','ceiling'].includes(step.operation)&&(!sameUnitDefinition(definition(a),definition(step))||a.unit!==step.unit))throw Error('Rounding preserves the authored unit');
 }else{
  if(['copy','choose','add','subtract','floor','ceiling','remainder'].includes(step.operation)&&(a.unit!==step.unit||b&&b.unit!==step.unit))throw Error('unit');
  if(step.operation==='quotient'&&(a.unit!==b.unit||step.unit!==''))throw Error('unit');if(step.operation==='power'&&b.unit!=='')throw Error('A power exponent must be dimensionless');
 }
 if(step.operation==='power'&&Object.hasOwn(step.right,'constant')&&(definition(b)?canonical(b,new ArithmeticBudget()):checked(b.exact,new ArithmeticBudget())).denominator!==1n)throw Error('An exact integer exponent is required');
}

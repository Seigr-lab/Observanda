import {create,all} from 'mathjs';
import {calculationLibrary,validCalculationPolicy} from '../web/tools/calculation-policy.js';
import {ArithmeticBudget,exactExpression,exactRadixText,exactBaseConversion,parseExact,isExact} from './exact-arithmetic.js';
const math=create(all,{number:'BigNumber',precision:64,predictable:true});
const policyError=(code,message)=>Object.assign(Error(message),{code});
const policyMath=new Map(),roundings={'half-even':6,'half-up':4,'toward-zero':1,floor:3,ceiling:2};
export function calculationRuntime({engine=2,policy}={}){
 if(![1,2,3].includes(engine))throw Error('Unsupported calculation engine.');
 if(engine!==3){if(policy!==undefined)throw policyError('CALCULATION_POLICY_LEGACY','The historical engine does not accept a calculation policy.');return {math,budget:new ArithmeticBudget(),engine};}
 if(!validCalculationPolicy(policy))throw policyError('CALCULATION_POLICY_INVALID','Unsupported or invalid calculation policy.');
 if(policy.library.version!==calculationLibrary.version||math.version!==calculationLibrary.version)throw policyError('CALCULATION_LIBRARY_UNAVAILABLE','The retained calculation library version is unavailable.');
 const saved=structuredClone(policy),key=JSON.stringify([saved.workingDigits,saved.rounding]);let instance=policyMath.get(key);
 if(!instance){instance=create(all,{number:'BigNumber',precision:saved.workingDigits,predictable:true});instance.BigNumber.set({rounding:roundings[saved.rounding]});policyMath.set(key,instance);if(policyMath.size>4)policyMath.delete(policyMath.keys().next().value);}
 return {math:instance,budget:new ArithmeticBudget(saved.resources),engine,policy:saved};
}
const functions=new Set(['abs','sqrt','cbrt','sin','cos','tan','asin','acos','atan','atan2','sinh','cosh','tanh','log','log10','log2','exp','floor','ceil','round','min','max','mean','median','std','variance','sum','prod','hypot']);
const operators=new Set(['+','-','*','/','^','%','mod','to']);
function parsedExpression(expression,variables={},engine=2,mathContext=math){
 const math=mathContext;if(![1,2,3].includes(engine))throw Error('Unsupported calculation engine.');
 const available=engine===1?functions:new Set([...functions,'quotient','remainder']);
 if(typeof expression!=='string'||expression.length>2000)throw Error('Use an expression of at most 2,000 characters.');
 const node=math.parse(expression);let count=0;
 node.traverse(n=>{
  if(++count>250)throw Error('This expression is too complex.');
  if(!['ConstantNode','OperatorNode','FunctionNode','SymbolNode','ParenthesisNode'].includes(n.type))throw Error('Only numbers, units, functions and arithmetic are supported.');
  if(n.type==='ConstantNode'&&(typeof n.value==='string'||String(n.value).length>(engine===1?100:2000)))throw Error('Use numeric constants of at most 100 digits.');
  if(n.type==='FunctionNode'&&(!available.has(n.name)||n.args.length>200))throw Error('Function is not available: '+n.name);
  if(n.type==='OperatorNode'&&!operators.has(n.op))throw Error('Operator is not available: '+n.op);
  if(n.type==='SymbolNode'&&!Object.hasOwn(variables,n.name)&&!available.has(n.name)&&!['pi','e','tau'].includes(n.name)&&!math.Unit.isValuelessUnit(n.name))throw Error('Unknown value: '+n.name);
 });
 return node;
}
export function calculationPreview(expression){return parsedExpression(expression).toTex({parenthesis:'keep',implicit:'hide'});}
function exactDisplay(raw){
 if(raw.includes('/'))return raw;
 const negative=raw.startsWith('-'),unsigned=negative?raw.slice(1):raw,[whole,fraction='']=unsigned.split('.'),all=whole+fraction,first=all.search(/[1-9]/);
 if(first<0)return '0';const exponent=whole.length-first-1,digits=all.slice(first).replace(/0+$/,'');
 return exponent>=5||exponent< -3?(negative?'-':'')+digits[0]+(digits.length>1?'.'+digits.slice(1):'')+'e'+(exponent>=0?'+':'')+exponent:raw;
}
function evaluateCalculation(expression,{angle='rad',variables={},engine=2,policy,runtime=calculationRuntime({engine,policy}),budget=runtime.budget}={}){
 const math=runtime.math,node=parsedExpression(expression,variables,engine,math);if(engine===3)budget.step();
 if(engine>=2){const exact=exactExpression(node,variables,budget);if(exact){const raw=exactRadixText(exact,10,budget),result=exactDisplay(raw);if(result.length>20000)throw Error('The exact result exceeds the display resource budget.');return {result,numeric:exact,exact:{numerator:String(exact.n),denominator:String(exact.d)}};}}
 const scope=new Map(Object.entries(variables).map(([key,value])=>[key,isExact(value)?math.divide(math.bignumber(String(value.n)),math.bignumber(String(value.d))):math.isBigNumber(value)?(engine===3?math.bignumber(value.toString()):value):math.bignumber(value)]));
 if(angle==='deg')for(const name of ['sin','cos','tan'])scope.set(name,x=>math[name](math.isUnit(x)?x:math.multiply(x,math.divide(math.pi,180))));
 if(angle==='deg')for(const name of ['asin','acos','atan'])scope.set(name,x=>math.multiply(math[name](x),math.divide(180,math.pi)));
 if(angle==='deg')scope.set('atan2',(y,x)=>math.multiply(math.atan2(y,x),math.divide(180,math.pi)));
 if(engine===3)node.traverse(n=>{if(n.type==='OperatorNode'||n.type==='FunctionNode')budget.step();});
 const value=node.evaluate(scope);if(engine===3)budget.step();if(engine>=2&&!math.isBigNumber(value)&&!math.isUnit(value)&&typeof value!=='number')throw Error('The expression must produce a scalar number or quantity.');const result=math.format(value,{precision:engine===3?runtime.policy.displayDigits:32});
 if(/NaN|Infinity/.test(result))throw engine===3?policyError('CALCULATION_REAL_RESULT','The expression has no finite real scalar result. Complex-valued operations are not supported.'):Error('The expression has no finite result.');
 if(result.length>2000)throw Error('The result is too large to display.');
 return {result,numeric:math.isBigNumber(value)?value:null,...(engine===3?{approximation:{engine:3,...structuredClone(runtime.policy)}}:engine===2?{approximation:{workingDigits:64,displayDigits:32}}:{})};
}
export function calculateDetailed(expression,options){const {numeric,...result}=evaluateCalculation(expression,options);return result;}
export function calculate(expression,options){return calculateDetailed(expression,options).result;}
export function convertBase(digits,from,to,{engine=2,policy,runtime}={}){
 if(engine===3)return exactBaseConversion(digits,from,to,(runtime??calculationRuntime({engine,policy})).budget);
 if(policy!==undefined)throw policyError('CALCULATION_POLICY_LEGACY','The historical engine does not accept a calculation policy.');
 if(engine===2)return exactBaseConversion(digits,from,to);
 if(engine!==1)throw Error('Unsupported calculation engine.');
 if(!Number.isInteger(from)||from<2||from>36||!Number.isInteger(to)||to<2||to>36||!/^-?[0-9a-z]{1,256}$/i.test(digits))throw Error('Enter an integer and bases from 2 to 36.');
 let value=0n;for(const c of digits.replace(/^-/,'').toLowerCase()){const d=parseInt(c,36);if(d>=from)throw Error('Digit '+c+' is not valid in base '+from);value=value*BigInt(from)+BigInt(d);}
 return (digits.startsWith('-')?-value:value).toString(to);
}
export const columnName=index=>{let name='';for(index++;index>0;index=Math.floor((index-1)/26))name=String.fromCharCode(65+(index-1)%26)+name;return name;};
export function spreadsheet(cells,{engine=2,policy}={}){
 const runtime=calculationRuntime({engine,policy}),budget=runtime.budget;
 const cache=new Map(),visiting=new Set();let operations=0;
 function cell(ref){
  ref=ref.toUpperCase();if(cache.has(ref))return cache.get(ref);if(visiting.has(ref))throw Error('Circular reference at '+ref);if(++operations>20000)throw Error('Too many dependencies.');
  const match=/^([A-Z]{1,2})([1-9][0-9]{0,3})$/.exec(ref);if(!match)throw Error('Invalid cell '+ref);
  const col=[...match[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1,row=Number(match[2])-1;
  if(!cells[row]||col>=cells[row].length)throw Error('Cell '+ref+' is outside the sheet.');
  const source=cells[row][col];visiting.add(ref);let value;
  try{
   if(source.startsWith('=')){
    const variables={};let expression=source.slice(1).replace(/\b([A-Za-z]{1,2}[1-9][0-9]{0,3}):([A-Za-z]{1,2}[1-9][0-9]{0,3})\b/g,(range,a,b)=>{
     const pos=s=>{const m=/([A-Za-z]+)([0-9]+)/.exec(s);return [Number(m[2])-1,[...m[1].toUpperCase()].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1];},[r1,c1]=pos(a),[r2,c2]=pos(b);
     if(r2<r1||c2<c1||(r2-r1+1)*(c2-c1+1)>200)throw Error('Ranges must contain at most 200 cells in forward order.');
     return Array.from({length:r2-r1+1},(_,r)=>Array.from({length:c2-c1+1},(_,c)=>columnName(c+c1)+(r+r1+1))).flat().join(',');
    });
    expression=expression.replace(/\b[A-Za-z]{1,2}[1-9][0-9]{0,3}\b/g,ref=>{const v=cell(ref);if(engine===1?!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v.result):!v.numeric)throw Error('Cell '+ref+' is not numeric.');variables[ref.toUpperCase()]=engine===1?v.result:v.numeric;return ref.toUpperCase();});
    expression=expression.replace(/\b([A-Z]+)(?=\s*\()/g,n=>n.toLowerCase());value=evaluateCalculation(expression,{variables,engine,policy,runtime,budget});
   }else {const quoted=source.startsWith("'"),result=quoted?source.slice(1):source;let numeric=null;if(engine>=2&&!quoted&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(result))numeric=parseExact(result,budget);value={result,numeric};}
   cache.set(ref,value);return value;
  }finally{visiting.delete(ref);}
 }
 return cells.map((row,r)=>row.map((_,c)=>{try{const {result,numeric,...details}=cell(columnName(c)+(r+1));return {value:result,...details};}catch(e){return {error:e.message,...(e.code?{errorCode:e.code}:{})};}}));
}

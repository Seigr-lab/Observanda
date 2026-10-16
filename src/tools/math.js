import {create,all} from 'mathjs';
const math=create(all,{number:'BigNumber',precision:64,predictable:true});
const functions=new Set(['abs','sqrt','cbrt','sin','cos','tan','asin','acos','atan','atan2','sinh','cosh','tanh','log','log10','log2','exp','floor','ceil','round','min','max','mean','median','std','variance','sum','prod','hypot']);
const operators=new Set(['+','-','*','/','^','%','mod','to']);
function parsedExpression(expression,variables={}){
 if(typeof expression!=='string'||expression.length>2000)throw Error('Use an expression of at most 2,000 characters.');
 const node=math.parse(expression);let count=0;
 node.traverse(n=>{
  if(++count>250)throw Error('This expression is too complex.');
  if(!['ConstantNode','OperatorNode','FunctionNode','SymbolNode','ParenthesisNode'].includes(n.type))throw Error('Only numbers, units, functions and arithmetic are supported.');
  if(n.type==='ConstantNode'&&(typeof n.value==='string'||String(n.value).length>100))throw Error('Use numeric constants of at most 100 digits.');
  if(n.type==='FunctionNode'&&(!functions.has(n.name)||n.args.length>200))throw Error('Function is not available: '+n.name);
  if(n.type==='OperatorNode'&&!operators.has(n.op))throw Error('Operator is not available: '+n.op);
  if(n.type==='SymbolNode'&&!Object.hasOwn(variables,n.name)&&!functions.has(n.name)&&!['pi','e','tau'].includes(n.name)&&!math.Unit.isValuelessUnit(n.name))throw Error('Unknown value: '+n.name);
 });
 return node;
}
export function calculationPreview(expression){return parsedExpression(expression).toTex({parenthesis:'keep',implicit:'hide'});}
export function calculate(expression,{angle='rad',variables={}}={}){
 const node=parsedExpression(expression,variables);
 const scope=new Map(Object.entries(variables).map(([key,value])=>[key,math.bignumber(value)]));
 if(angle==='deg')for(const name of ['sin','cos','tan'])scope.set(name,x=>math[name](math.isUnit(x)?x:math.multiply(x,math.divide(math.pi,180))));
 if(angle==='deg')for(const name of ['asin','acos','atan'])scope.set(name,x=>math.multiply(math[name](x),math.divide(180,math.pi)));
 if(angle==='deg')scope.set('atan2',(y,x)=>math.multiply(math.atan2(y,x),math.divide(180,math.pi)));
 const value=node.evaluate(scope),result=math.format(value,{precision:32});
 if(/NaN|Infinity/.test(result))throw Error('The expression has no finite result.');
 if(result.length>2000)throw Error('The result is too large to display.');
 return result;
}
export function convertBase(digits,from,to){
 if(!Number.isInteger(from)||from<2||from>36||!Number.isInteger(to)||to<2||to>36||!/^-?[0-9a-z]{1,256}$/i.test(digits))throw Error('Enter an integer and bases from 2 to 36.');
 let value=0n;for(const c of digits.replace(/^-/,'').toLowerCase()){const d=parseInt(c,36);if(d>=from)throw Error('Digit '+c+' is not valid in base '+from);value=value*BigInt(from)+BigInt(d);}
 return (digits.startsWith('-')?-value:value).toString(to);
}
export const columnName=index=>{let name='';for(index++;index>0;index=Math.floor((index-1)/26))name=String.fromCharCode(65+(index-1)%26)+name;return name;};
export function spreadsheet(cells){
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
    expression=expression.replace(/\b[A-Za-z]{1,2}[1-9][0-9]{0,3}\b/g,ref=>{const v=cell(ref);if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v))throw Error('Cell '+ref+' is not numeric.');variables[ref.toUpperCase()]=v;return ref.toUpperCase();});
    expression=expression.replace(/\b([A-Z]+)(?=\s*\()/g,n=>n.toLowerCase());value=calculate(expression,{variables});
   }else value=source.startsWith("'")?source.slice(1):source;
   cache.set(ref,value);return value;
  }finally{visiting.delete(ref);}
 }
 return cells.map((row,r)=>row.map((_,c)=>{try{return {value:cell(columnName(c)+(r+1))};}catch(e){return {error:e.message};}}));
}

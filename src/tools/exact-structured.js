import {ExactNumber,isExact,exactExpression,exactOperation} from './exact-arithmetic.js';
const fail=(code='CALCULATION_STRUCTURED_UNSUPPORTED')=>{throw Object.assign(Error(code),{code});};
const shapeError=()=>fail('CALCULATION_STRUCTURED_SHAPE');
const resource=()=>fail('CALCULATION_STRUCTURED_RESOURCE');
const complex=value=>value?.codec==='complex';
const sameShape=(a,b)=>a.codec===b.codec&&a.shape.length===b.shape.length&&a.shape.every((n,i)=>n===b.shape[i]);

// A null return authorizes only the unchanged scalar pipeline. A detected
// structured construct never falls back to an approximate library operation.
export function exactStructuredExpression(node,variables,budget,{maxComponents,maxResultCharacters}){
 if(!Number.isSafeInteger(maxComponents)||maxComponents<1||!Number.isSafeInteger(maxResultCharacters)||maxResultCharacters<32)resource();
 let structured=false;
 node.traverse(n=>{budget.step();if(n.type==='ArrayNode'||n.type==='SymbolNode'&&n.name==='i'||n.type==='FunctionNode'&&['dot','matmul'].includes(n.name))structured=true;});
 if(!structured)node.traverse(n=>{if(n.type==='FunctionNode'&&n.name==='sqrt'&&n.args.length===1){const value=exactExpression(n.args[0],variables,budget);if(value?.n<0n)structured=true;}});
 if(!structured)return null;
 const reserve=count=>{if(!Number.isSafeInteger(count)||count<1||count>maxComponents)resource();};
 const make=(codec,shape,components)=>({codec,shape,components});
 const zero=()=>new ExactNumber(0n,1n,budget),one=()=>new ExactNumber(1n,1n,budget);
 const operation=(name,values)=>{const value=exactOperation(name,values,budget);if(value===null)fail();return value;};
 const asComplex=value=>{if(complex(value))return value;if(!isExact(value))shapeError();reserve(2);return make('complex',[2],[value,zero()]);};
 const negate=value=>{if(isExact(value))return operation('unaryMinus',[value]);const output=[];reserve(value.components.length);for(const component of value.components){budget.step();output.push(operation('unaryMinus',[component]));}return make(value.codec,[...value.shape],output);};
 function add(a,b,name){
  if(isExact(a)&&isExact(b))return operation(name,[a,b]);
  if(complex(a)||complex(b)){a=asComplex(a);b=asComplex(b);}
  if(isExact(a)||isExact(b)||!sameShape(a,b))shapeError();reserve(a.components.length);const output=[];
  for(let i=0;i<a.components.length;i++){budget.step();output.push(operation(name,[a.components[i],b.components[i]]));}return make(a.codec,[...a.shape],output);
 }
 function complexProduct(a,b,divide){
  a=asComplex(a);b=asComplex(b);reserve(2);const [ar,ai]=a.components,[br,bi]=b.components,mul=(x,y)=>operation('multiply',[x,y]),plus=(x,y)=>operation('add',[x,y]),minus=(x,y)=>operation('subtract',[x,y]);
  if(!divide)return make('complex',[2],[minus(mul(ar,br),mul(ai,bi)),plus(mul(ai,br),mul(ar,bi))]);
  if(br.n===0n&&bi.n===0n)fail('CALCULATION_STRUCTURED_ZERO_DIVISOR');
  const denominator=plus(mul(br,br),mul(bi,bi));return make('complex',[2],[operation('divide',[plus(mul(ar,br),mul(ai,bi)),denominator]),operation('divide',[minus(mul(ai,br),mul(ar,bi)),denominator])]);
 }
 function reduce(a,b,indices){let result=zero();for(const [i,j] of indices){budget.step();result=operation('add',[result,operation('multiply',[a.components[i],b.components[j]])]);}return result;}
 function* pairs(length,left,right){for(let k=0;k<length;k++)yield [left(k),right(k)];}
 function evaluate(n){
  budget.step();
  if(n.type==='ParenthesisNode')return evaluate(n.content);
  if(n.type==='SymbolNode'&&n.name==='i'){reserve(2);return make('complex',[2],[zero(),one()]);}
  if(n.type==='ArrayNode'){
   if(!n.items.length)shapeError();reserve(n.items.length);const items=[];for(const item of n.items)items.push(evaluate(item));
   if(items.every(isExact))return make('vector',[items.length],items);
   if(!items.every(value=>value?.codec==='vector')||!items.every(value=>value.shape[0]===items[0].shape[0]))shapeError();
   const shape=[items.length,items[0].shape[0]];reserve(shape[0]*shape[1]);const components=[];for(const row of items)for(const component of row.components){budget.step();components.push(component);}return make('matrix',shape,components);
  }
  if(n.type==='ConstantNode'||n.type==='SymbolNode'){const value=exactExpression(n,variables,budget);if(!value)fail();return value;}
  if(!['OperatorNode','FunctionNode'].includes(n.type))fail();
  const name=n.type==='OperatorNode'?n.fn:n.name;
  const required={unaryPlus:1,unaryMinus:1,add:2,subtract:2,multiply:2,divide:2,dot:2,matmul:2,sqrt:1};if(Object.hasOwn(required,name)&&n.args.length!==required[name])shapeError();
  const values=n.args.map(evaluate),[a,b]=values;
  const arity=count=>{if(values.length!==count)shapeError();};
  if(name==='unaryPlus'){arity(1);return a;}
  if(name==='unaryMinus'){arity(1);return negate(a);}
  if(name==='add'||name==='subtract'){arity(2);return add(a,b,name);}
  if(name==='multiply'||name==='divide'){
   arity(2);if(isExact(a)&&isExact(b))return operation(name,values);
   if((isExact(a)||complex(a))&&(isExact(b)||complex(b)))return complexProduct(a,b,name==='divide');shapeError();
  }
  if(name==='dot'){
   arity(2);if(a?.codec!=='vector'||b?.codec!=='vector'||a.shape[0]!==b.shape[0])shapeError();return reduce(a,b,pairs(a.shape[0],k=>k,k=>k));
  }
  if(name==='matmul'){
   arity(2);if(a?.codec!=='matrix'||b?.codec!=='matrix'||a.shape[1]!==b.shape[0])shapeError();const shape=[a.shape[0],b.shape[1]],count=shape[0]*shape[1];reserve(count);const components=[];
   for(let row=0;row<shape[0];row++)for(let col=0;col<shape[1];col++){budget.step();components.push(reduce(a,b,pairs(a.shape[1],k=>row*a.shape[1]+k,k=>k*b.shape[1]+col)));}return make('matrix',shape,components);
  }
  if(name==='sqrt'&&values.length===1&&isExact(a)&&a.n<0n){reserve(2);const positive=operation('unaryMinus',[a]),root=operation('sqrt',[positive]);return make('complex',[2],[zero(),root]);}
  if(values.some(value=>!isExact(value)))fail();return operation(name,values);
 }
 return evaluate(node);
}

function canonical(value,budget,remaining){
 budget.size(value.n,value.d);
 // Check a lower bound before allocating decimal strings; bit limits bound the
 // at-most-one-digit uncertainty of this estimate.
 const digits=n=>n===0n?1:Math.floor(((n<0n?-n:n).toString(2).length-1)*Math.LOG10E*Math.LN2)+1+(n<0n?1:0);
 if(digits(value.n)+digits(value.d)>remaining)resource();
 const result={numerator:String(value.n),denominator:String(value.d)};if(result.numerator.length+result.denominator.length>remaining)resource();return result;
}
export function exactScalarEnvelope(value,result,budget,maxResultCharacters){
 const exact=canonical(value,budget,maxResultCharacters),envelope={result,exact};if(JSON.stringify(envelope).length>maxResultCharacters)resource();budget.step();return envelope;
}
export function structuredEnvelope(value,budget,{maxComponents,maxResultCharacters}){
 if(value.components.length>maxComponents)resource();const structured={version:1,codec:value.codec,shape:[...value.shape],components:[]},parts=[];
 let characters=JSON.stringify({result:'',structured}).length;
 const charge=count=>{if(count>maxResultCharacters-characters)resource();characters+=count;};
 const put=text=>{charge(text.length);parts.push(text);};
 if(value.codec!=='complex')put('[');
 for(let i=0;i<value.components.length;i++){
  budget.step();const exact=canonical(value.components[i],budget,maxResultCharacters-characters);charge(JSON.stringify(exact).length+(i?1:0));structured.components.push(exact);
  const text=exact.denominator==='1'?exact.numerator:exact.numerator+'/'+exact.denominator;
  if(value.codec==='complex'){if(i===0)put('('+text+')');else put('+('+text+')*i');}
  else if(value.codec==='matrix'){if(i%value.shape[1]===0){if(i)put(',');put('[');}else put(',');put(text);if(i%value.shape[1]===value.shape[1]-1)put(']');}
  else{if(i)put(',');put(text);}
 }
 if(value.codec!=='complex')put(']');budget.step();return {result:parts.join(''),structured};
}

// Exact scalar arithmetic for versioned calculator and worksheet evaluation.
// Resource exhaustion is a refusal, never permission to round an exact result.
const absolute = n => n < 0n ? -n : n;
const bitLength = n => absolute(n).toString(2).length;
import {ArithmeticBudget} from '../web/exact-arithmetic-budget.js';
export {ArithmeticBudget} from '../web/exact-arithmetic-budget.js';

function gcd(a,b,budget){a=absolute(a);b=absolute(b);while(b){budget.step();[a,b]=[b,a%b];}return a;}
export class ExactNumber {
 constructor(n,d=1n,budget=new ArithmeticBudget()){
  if(d===0n)throw Error('Division by zero has no finite result.');
  budget.size(n,d);if(d<0n){n=-n;d=-d;}const g=gcd(n,d,budget);this.n=n/g;this.d=d/g;
 }
}
export function parseExact(source,budget=new ArithmeticBudget()){
 if(source instanceof ExactNumber)return source;
 if(typeof source!=='string')throw Error('Expected an exact numeric value.');
 if(source.length>budget.maxBits)throw Error('Exact input exceeds the calculation resource budget.');
 const fraction=/^([+-]?\d+)\/(\d+)$/.exec(source);
 if(fraction)return new ExactNumber(BigInt(fraction[1]),BigInt(fraction[2]),budget);
 const m=/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(source);
 if(!m)throw Error('Expected an exact numeric value.');
 const digits=(m[2]??'')+(m[3]??m[4]??''),exponent=BigInt(m[5]??'0')-BigInt((m[3]??m[4]??'').length);
 if(digits.length>budget.maxBits||absolute(exponent)>BigInt(budget.maxBits))throw Error('Exact value exceeds the calculation resource budget.');
 const n=BigInt(digits)*(m[1]==='-'?-1n:1n);
 return exponent>=0n?new ExactNumber(budget.product(n,budget.power(10n,exponent)),1n,budget):new ExactNumber(n,budget.power(10n,-exponent),budget);
}
const unsupported=Symbol('not exact scalar arithmetic');
export const isExact=value=>value instanceof ExactNumber;
export function exactExpression(node,variables={},budget=new ArithmeticBudget()){
 const make=(n,d=1n)=>new ExactNumber(n,d,budget),add=(a,b)=>{const g=gcd(a.d,b.d,budget);return make(budget.product(a.n,b.d/g)+budget.product(b.n,a.d/g),budget.product(a.d/g,b.d));},neg=a=>make(-a.n,a.d),sub=(a,b)=>add(a,neg(b));
 const mul=(a,b)=>{const g=gcd(a.n,b.d,budget),h=gcd(b.n,a.d,budget);return make(budget.product(a.n/g,b.n/h),budget.product(a.d/h,b.d/g));},div=(a,b)=>mul(a,make(b.d,b.n));
 const compare=(a,b)=>{const v=sub(a,b);return v.n<0n?-1:v.n>0n?1:0;},floor=a=>a.n/a.d-(a.n<0n&&a.n%a.d!==0n?1n:0n),ceil=a=>-floor(neg(a));
 function root(a,degree){
  if(a.n<0n&&degree%2n===0n)return unsupported;
  function integerRoot(v){if(v<2n)return v;let x=1n<<BigInt(Math.ceil(bitLength(v)/Number(degree)));while(true){budget.step();const y=((degree-1n)*x+v/(x**(degree-1n)))/degree;if(y>=x)return x;x=y;}}
  const n=integerRoot(absolute(a.n)),d=integerRoot(a.d);return n**degree===absolute(a.n)&&d**degree===a.d?make(a.n<0n?-n:n,d):unsupported;
 }
 function evaluate(n){
  budget.step();
  if(n.type==='ConstantNode')return parseExact(String(n.value),budget);
  if(n.type==='SymbolNode'){const value=variables[n.name];return value===undefined?unsupported:isExact(value)?value:typeof value==='string'?parseExact(value,budget):unsupported;}
  if(n.type==='ParenthesisNode')return evaluate(n.content);
  if(!['OperatorNode','FunctionNode'].includes(n.type))return unsupported;
  const values=n.args.map(evaluate);if(values.includes(unsupported))return unsupported;
  const [a,b]=values,name=n.type==='OperatorNode'?n.fn:n.name;
  const arity=(min,max=min)=>{if(values.length<min||values.length>max)throw Error('Unexpected number of arguments for '+name+'.');};
  switch(name){
   case 'unaryPlus':arity(1);return a;
   case 'unaryMinus':arity(1);return neg(a);
   case 'add':arity(2);return add(a,b);
   case 'subtract':arity(2);return sub(a,b);
   case 'multiply':arity(2);return mul(a,b);
   case 'divide':arity(2);return div(a,b);
   case 'pow':arity(2);if(b.d!==1n)return unsupported;return b.n<0n?make(budget.power(a.d,-b.n),budget.power(a.n,-b.n)):make(budget.power(a.n,b.n),budget.power(a.d,b.n));
   case 'mod':arity(2);if(b.n<=0n)throw Error('Modulo requires a positive divisor.');return sub(a,mul(make(floor(div(a,b))),b));
   case 'quotient':arity(2);{const q=div(a,b);return make(q.n/q.d);}
   case 'remainder':arity(2);{const q=div(a,b);return sub(a,mul(make(q.n/q.d),b));}
   case 'abs':arity(1);return make(absolute(a.n),a.d);
   case 'floor':arity(1);return make(floor(a));
   case 'ceil':arity(1);return make(ceil(a));
   case 'round':arity(1,2);{if(b&&b.d!==1n)throw Error('Rounding precision must be an integer.');const digits=b?.n??0n,scale=digits>=0n?make(budget.power(10n,digits)):make(1n,budget.power(10n,-digits)),v=mul(a,scale),r=make((2n*absolute(v.n)+v.d)/(2n*v.d)*(v.n<0n?-1n:1n));return div(r,scale);}
   case 'sqrt':arity(1);return root(a,2n);
   case 'cbrt':arity(1);return root(a,3n);
   case 'sum':arity(1,200);return values.reduce(add,make(0n));
   case 'prod':arity(1,200);return values.reduce(mul,make(1n));
   case 'min':case 'max':arity(1,200);return values.reduce((x,y)=>compare(x,y)*(name==='min'?1:-1)<=0?x:y);
   case 'mean':arity(1,200);return div(values.reduce(add,make(0n)),make(BigInt(values.length)));
   case 'median':{arity(1,200);const sorted=values.toSorted(compare),middle=Math.floor(values.length/2);return values.length%2?sorted[middle]:div(add(sorted[middle-1],sorted[middle]),make(2n));}
   case 'variance':case 'std':{arity(2,200);const mean=div(values.reduce(add,make(0n)),make(BigInt(values.length))),variance=div(values.map(v=>sub(v,mean)).map(v=>mul(v,v)).reduce(add,make(0n)),make(BigInt(values.length-1)));return name==='variance'?variance:root(variance,2n);}
   case 'hypot':arity(1,200);return root(values.map(v=>mul(v,v)).reduce(add,make(0n)),2n);
   default:return unsupported;
  }
 }
 const result=evaluate(node);return result===unsupported?null:result;
}
// Reuse the historical rational primitives without changing their interpretation.
export function exactOperation(name,values,budget=new ArithmeticBudget()){
 const variables=Object.fromEntries(values.map((value,index)=>['operand'+index,value]));
 return exactExpression({type:'FunctionNode',name,args:values.map((_,index)=>({type:'SymbolNode',name:'operand'+index}))},variables,budget);
}
// A finite radix expansion is printed exactly; recurring expansions remain a ratio
// in the requested base. Both forms can be pasted back into base conversion.
export function exactRadixText(value,radix=10,budget=new ArithmeticBudget()){
 const base=BigInt(radix);let d=value.d;
 while(d!==1n){const g=gcd(d,base,budget);if(g===1n)return value.n.toString(radix)+'/'+value.d.toString(radix);d/=g;}
 let remainder=absolute(value.n)%value.d,result=(value.n<0n?'-':'')+(absolute(value.n)/value.d).toString(radix);
 if(remainder)result+='.';
 while(remainder){budget.step();const next=budget.product(remainder,base);result+=(next/value.d).toString(radix);remainder=next%value.d;}
 return result;
}
export function exactBaseConversion(digits,from,to,budget=new ArithmeticBudget()){
 if(!Number.isInteger(from)||from<2||from>36||!Number.isInteger(to)||to<2||to>36||typeof digits!=='string'||digits.length>2000)throw Error('Enter a number or ratio and bases from 2 to 36.');
 const pattern=/^([+-]?)([0-9a-z]+)(?:\.([0-9a-z]+)|\/([0-9a-z]+))?$/i,m=pattern.exec(digits);
 if(!m)throw Error('Enter digits, a fraction or a ratio in the selected base.');
 const integer=s=>{let n=0n;for(const c of s.toLowerCase()){const digit=parseInt(c,36);if(digit>=from)throw Error('Digit '+c+' is not valid in base '+from);n=budget.product(n,BigInt(from))+BigInt(digit);budget.size(n);}return n;};
 const numerator=integer(m[2]+(m[3]??''))*(m[1]==='-'?-1n:1n),denominator=m[4]?integer(m[4]):budget.power(BigInt(from),BigInt((m[3]??'').length));
 return exactRadixText(new ExactNumber(numerator,denominator,budget),to,budget);
}

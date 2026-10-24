// Forward, unscaled DFT: exp(-2*pi*i*j*k/N), full bins in ordinary order.
// https://www.fftw.org/fftw3_doc/The-1d-Discrete-Fourier-Transform-_0028DFT_0029.html
// A radix-2 DIT traversal uses caller-owned encrypted scratch, never N-sized
// JavaScript arrays. The writer receives |X|^2/N^2, not a density or uncertainty.
import {randomUUID} from 'node:crypto';
import {DatasetResourceBudget} from './dataset-resource-budget.js';
import {validDatasetResourcePolicy} from './web/dataset-resource-policy.js';
import {validCalculationPolicy} from './web/tools/calculation-policy.js';
import {validApproximateResult} from './web/tools/approximate-calculation-model.js';
import {validCellComputation,hasApproximateComputation} from './web/measurement-computation.js';
import {validatePolicyScalar,isScalarResourceFailure} from './web/measurement-scalar-policy.js';
import {plotRational,addPlotRational,multiplyPlotRational,dividePlotRational,reducePlotRational} from './web/plot-resource-policy.js';
import {revisionText} from './web/revision-model.js';
import {SPECTRUM_METHOD,powerOfTwoCount} from './web/dataset-spectrum-model.js';
import {calculationRuntime} from './tools/math.js';
export class DatasetSpectrumError extends Error{constructor(code='DATASET_SPECTRUM_INVALID'){super(code);this.code=code;}}
const fail=(code,cause)=>{const error=new DatasetSpectrumError(code);if(cause)error.cause=cause;throw error;};
const exact=(value,names)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const bits=value=>(value<0n?-value:value).toString(2).length;
const zero=()=>({kind:'exact',numerator:0n,denominator:1n});
const isZero=value=>value.kind==='exact'&&value.numerator===0n;
const exactValue=value=>({kind:'exact',...value});
const rationalText=value=>value.numerator+'/'+value.denominator;
// Both persistent budgets charge every synchronous numerical slice. I/O and
// progress callbacks run outside those slices; no butterfly resets either cap.
function combinedBudget(resource,calculation){
 const resources=Object.fromEntries(Object.keys(resource.scalarPolicy.resources).map(key=>[key,Math.min(resource.scalarPolicy.resources[key],calculation.scalarPolicy.resources[key])])),budgets=[resource,calculation];
 return {scalarPolicy:{...resource.scalarPolicy,resources},maxBits:resources.maxBits,step(){for(const budget of budgets)budget.step();},size(...values){for(const budget of budgets)budget.size(...values);},product(a,b){this.step();if(a!==0n&&b!==0n&&bits(a)+bits(b)-1>this.maxBits)fail('DATASET_CALCULATION_RESOURCE');return a*b;},power(a,n){this.step();if(n<0n||n>BigInt(this.maxBits)||(a<0n?-a:a)>1n&&BigInt(bits(a)-1)*n>BigInt(this.maxBits))fail('DATASET_CALCULATION_RESOURCE');const result=a**n;this.size(result);return result;}};
}
export async function evaluateSpectrum({count,read,work,write}={},options={}){
 const {resourcePolicy,calculationPolicy,signal,check,progress,budget:providedBudget}=options;
 if(!powerOfTwoCount(count)||typeof read!=='function'||typeof write!=='function'||typeof work?.getMany!=='function'||typeof work?.putMany!=='function'||!validDatasetResourcePolicy(resourcePolicy)||!validCalculationPolicy(calculationPolicy)||calculationPolicy.version!==2)fail();
 if(providedBudget!==undefined&&(!(providedBudget instanceof DatasetResourceBudget)||revisionText(providedBudget.scalarPolicy)!==revisionText(resourcePolicy)))fail();
 if(calculationPolicy.resources.maxComponents<2)fail('DATASET_CALCULATION_RESOURCE');
 const resource=providedBudget??new DatasetResourceBudget(resourcePolicy),enginePolicy={...resourcePolicy,resources:{...resourcePolicy.resources,maxBits:calculationPolicy.resources.maxBits,maxOperations:calculationPolicy.resources.maxOperations,maxMilliseconds:calculationPolicy.resources.maxMilliseconds,maxScalarCharacters:Math.min(65536,calculationPolicy.resources.maxResultCharacters),maxExponent:Math.min(65536,calculationPolicy.resources.maxBits)}},engineBudget=new DatasetResourceBudget(enginePolicy),budget=combinedBudget(resource,engineBudget),runtime=calculationRuntime({engine:4,policy:calculationPolicy}),math=runtime.math,prefix='spectrum:'+randomUUID()+':',limits=budget.scalarPolicy.resources;
 let levels=0;for(let n=count;n>1;n/=2)levels++;let approximate=false,approximateInputs=false;
 const current=async()=>{signal?.throwIfAborted();await check?.();signal?.throwIfAborted();};
 const run=(operation,code='DATASET_SPECTRUM_INVALID')=>{signal?.throwIfAborted();try{return resource.run(()=>engineBudget.run(()=>operation(budget)));}catch(error){if(error instanceof DatasetSpectrumError||error.name==='AbortError'||isScalarResourceFailure(error)||error.code==='CALCULATION_LIBRARY_UNAVAILABLE')throw error;if(error.code==='CALCULATION_STRUCTURED_RESOURCE')fail('DATASET_CALCULATION_RESOURCE');fail(code,error);}};
 const io=async operation=>{await current();const value=await operation();await current();return value;};
 const report=async value=>{if(progress)await io(()=>progress(value));};
 const key=index=>prefix+index;
 // Index addressing is metadata work, not exact/rounded value arithmetic. Its
 // bounded loop is included in the same timed slice, as are scratch checks.
 const reverse=index=>{let result=0;for(let bit=0;bit<levels;bit++){result=result*2+index%2;index=Math.floor(index/2);}return result;};
 function decimalParts(spelling){
  if(!validApproximateResult({version:1,kind:'approximate-real',spelling,representation:'decimal',radix:10})||spelling.length>limits.maxScalarCharacters||spelling.length>calculationPolicy.resources.maxResultCharacters)fail('DATASET_CALCULATION_RESOURCE');
  const match=/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(spelling),exponent=Number(match[4]??0),fraction=match[3]??'',digits=(match[2]+fraction).replace(/^0+/,'')||'0',shift=exponent-fraction.length;
  if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>limits.maxExponent)fail('DATASET_CALCULATION_RESOURCE');
  // Native BigInt conversion is only used after a digit bound. Near the bit
  // boundary test the actual integer; ordinary working precision needs none.
  const within=(characters,power)=>{const decimalDigits=characters+power,upper=Math.ceil(decimalDigits*Math.log2(10));if(upper<=budget.maxBits)return;if(Math.floor((decimalDigits-1)*Math.log2(10))+1>budget.maxBits)fail('DATASET_CALCULATION_RESOURCE');const value=(characters===1&&digits==='0'?0n:BigInt(digits))*10n**BigInt(power);if(bits(value)>budget.maxBits)fail('DATASET_CALCULATION_RESOURCE');};
  if(digits!=='0')within(digits.length,Math.max(0,shift));
  if(shift<0){const lower=Math.floor((-shift)*Math.log2(10))+1;if(lower>budget.maxBits)fail('DATASET_CALCULATION_RESOURCE');const upper=Math.ceil((-shift)*Math.log2(10))+1;if(upper>budget.maxBits&&bits(10n**BigInt(-shift))>budget.maxBits)fail('DATASET_CALCULATION_RESOURCE');}
  return {negative:match[1]==='-',digits,shift};
 }
 function rounded(value){if(!math.isBigNumber(value)||!value.isFinite())fail();const spelling=value.valueOf();decimalParts(spelling);return {kind:'approximate',value,spelling};}
 function encode(value){const spelling=value.kind==='exact'?rationalText(value):value.spelling;if(spelling.length>calculationPolicy.resources.maxResultCharacters)fail('DATASET_CALCULATION_RESOURCE');return {kind:value.kind,spelling};}
 function decode(value){
  if(!exact(value,['kind','spelling'])||!['exact','approximate'].includes(value.kind)||typeof value.spelling!=='string')fail('MATERIAL_MISSING');
  if(value.kind==='exact'){const number=plotRational(value.spelling,budget);if(rationalText(number)!==value.spelling)fail('MATERIAL_MISSING');return exactValue(number);}
  decimalParts(value.spelling);budget.step();return rounded(math.bignumber(value.spelling));
 }
 function record(value){if(!exact(value,['real','imaginary']))fail('MATERIAL_MISSING');return {real:decode(value.real),imaginary:decode(value.imaginary)};}
 function big(value){if(value.kind==='approximate')return value.value;const n=math.bignumber(String(value.numerator));if(value.denominator===1n)return n;budget.step();return math.divide(n,math.bignumber(String(value.denominator)));}
 const primitive=(operation,...values)=>{const operands=values.map(big);budget.step();return rounded(math[operation](...operands));};
 function negative(value){if(isZero(value))return zero();if(value.kind==='approximate')return primitive('unaryMinus',value);budget.step();return {...value,numerator:-value.numerator};}
 function sum(a,b){
  if(isZero(b))return a;if(isZero(a))return b;if(a.kind!=='exact'||b.kind!=='exact')return primitive('add',a,b);
  if(a.denominator===b.denominator){const numerator=a.numerator+b.numerator;budget.size(numerator);return numerator===0n?zero():a.denominator===1n?exactValue({numerator,denominator:1n}):exactValue(reducePlotRational({numerator,denominator:a.denominator},budget));}
  return exactValue(addPlotRational(a,b,budget));
 }
 const difference=(a,b)=>isZero(b)?a:isZero(a)?negative(b):a.kind!=='exact'||b.kind!=='exact'?primitive('subtract',a,b):sum(a,negative(b));
 function product(a,b){
  if(isZero(a)||isZero(b))return zero();if(a.kind!=='exact'||b.kind!=='exact')return primitive('multiply',a,b);
  if(a.denominator===1n&&b.denominator===1n){const numerator=budget.product(a.numerator,b.numerator);budget.size(numerator);return exactValue({numerator,denominator:1n});}
  return exactValue(multiplyPlotRational(a,b,budget));
 }
 const quotient=(a,b)=>isZero(a)?zero():a.kind!=='exact'||b.kind!=='exact'?primitive('divide',a,b):exactValue(dividePlotRational(a,b,budget));
 function twiddle(position,length){
  const phase=exactValue({numerator:2n*BigInt(position),denominator:BigInt(length)});budget.step();const angle=math.multiply(big(phase),math.pi);budget.step();const real=rounded(math.cos(angle));budget.step();const imaginary=negative(rounded(math.sin(angle)));return {real,imaginary};
 }
 function rotated(value,position,length,rotation){
  if(position===0||isZero(value.real)&&isZero(value.imaginary))return value;
  if(position===length/4)return {real:value.imaginary,imaginary:negative(value.real)};
  return {real:difference(product(value.real,rotation.real),product(value.imaginary,rotation.imaginary)),imaginary:sum(product(value.real,rotation.imaginary),product(value.imaginary,rotation.real))};
 }
 // Convert a generated finite decimal once. Its denominator is a power of ten;
 // cancelling only factors two/five avoids general Euclid over precision digits.
 function outputRational(value){
  if(value.kind==='exact')return rationalText(value);
  const {negative:minus,digits,shift}=decimalParts(value.spelling);budget.step();let numerator=BigInt(digits),denominator=1n;if(numerator===0n)return '0/1';
  if(shift>=0)numerator=budget.product(numerator,budget.power(10n,BigInt(shift)));
  else{let twos=-shift,fives=-shift;while(twos&&numerator%2n===0n){budget.step();numerator/=2n;twos--;}while(fives&&numerator%5n===0n){budget.step();numerator/=5n;fives--;}denominator=budget.product(budget.power(2n,BigInt(twos)),budget.power(5n,BigInt(fives)));}
  budget.size(numerator,denominator);return (minus?'-':'')+numerator+'/'+denominator;
 }
 let pending=[];
 for(let index=0;index<count;index++){
  const input=await io(()=>read(index,{budget:resource,signal}));
  const entry=run(()=>{
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(name=>!['real','imaginary','resourcePolicy','computation'].includes(name))||!Object.hasOwn(input,'computation')||!validCellComputation(input.computation)||!validDatasetResourcePolicy(input.resourcePolicy))fail('DATASET_SPECTRUM_INPUT');
   const parse=value=>exactValue(validatePolicyScalar(value,input.resourcePolicy,{budget}));
   const value={real:parse(input.real),imaginary:input.imaginary===undefined?zero():parse(input.imaginary)};approximateInputs ||= hasApproximateComputation(input);return [key(reverse(index)),{real:encode(value.real),imaginary:encode(value.imaginary)}];
  },'DATASET_SPECTRUM_INPUT');pending.push(entry);
  if(pending.length===32||index===count-1){await io(()=>work.putMany(pending));pending=[];await report({phase:'input',done:index+1,total:count});}
 }
 for(let length=2,stage=1;length<=count;length*=2,stage++){
  const half=length/2;let done=0;
  for(let position=0;position<half;position++){
   let rotation=null;
   for(let start=0;start<count;){
    const pairs=[],keys=[];for(let pair=0;pair<16&&start<count;pair++,start+=length){const left=start+position,right=left+half;pairs.push([left,right]);keys.push(key(left),key(right));}
    const values=await io(()=>work.getMany(keys));if(!(values instanceof Map))fail('MATERIAL_MISSING');
    const updates=run(()=>{const output=[];for(const [left,right]of pairs){const a=record(values.get(key(left))),b=record(values.get(key(right)));if(position!==0&&position!==length/4&&!(isZero(b.real)&&isZero(b.imaginary)))rotation??=twiddle(position,length);const value=rotated(b,position,length,rotation),put=(index,real,imaginary)=>output.push([key(index),{real:encode(real),imaginary:encode(imaginary)}]);put(left,sum(a.real,value.real),sum(a.imaginary,value.imaginary));put(right,difference(a.real,value.real),difference(a.imaginary,value.imaginary));}return output;});
    await io(()=>work.putMany(updates));done+=pairs.length*2;await report({phase:'transform',stage,stages:levels,done,total:count});
   }
  }
  if(length===count)break;
 }
 const normalizer=run(()=>exactValue({numerator:budget.product(BigInt(count),BigInt(count)),denominator:1n}));
 for(let offset=0;offset<count;offset+=32){
  const keys=Array.from({length:Math.min(32,count-offset)},(_,index)=>key(offset+index)),values=await io(()=>work.getMany(keys));if(!(values instanceof Map))fail('MATERIAL_MISSING');
  for(let local=0;local<keys.length;local++){
   const bin=run(()=>{const value=record(values.get(keys[local])),power=quotient(sum(product(value.real,value.real),product(value.imaginary,value.imaginary)),normalizer),rational={},result={index:offset+local,approximate:[value.real,value.imaginary,power].some(component=>component.kind==='approximate'),approximateInputs};
    for(const [field,component]of Object.entries({...value,normalizedSquaredMagnitude:power})){const spelling=component.kind==='exact'?rationalText(component):component.spelling,rationalSpelling=outputRational(component);if(Math.max(spelling.length,rationalSpelling.length)>limits.maxScalarCharacters||Math.max(spelling.length,rationalSpelling.length)>calculationPolicy.resources.maxResultCharacters)fail('DATASET_CALCULATION_RESOURCE');result[field]={spelling,representation:component.kind==='exact'?'rational':'decimal',radix:10};rational[field]=rationalSpelling;}result.rational=rational;approximate ||= result.approximate;return result;});await io(()=>write(bin));
  }
  await report({phase:'output',done:Math.min(count,offset+keys.length),total:count});
 }
 await current();return {version:1,method:SPECTRUM_METHOD,count,engine:4,calculationPolicy:structuredClone(calculationPolicy),resourcePolicy:structuredClone(resourcePolicy),approximate,approximateInputs};
}

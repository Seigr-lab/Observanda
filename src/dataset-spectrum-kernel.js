// Forward, unscaled DFT: exp(-2*pi*i*j*k/N), full bins in ordinary order.
// https://www.fftw.org/fftw3_doc/The-1d-Discrete-Fourier-Transform-_0028DFT_0029.html
// A radix-2 DIT traversal uses caller-owned encrypted scratch, never N-sized
// JavaScript arrays. Power is |X|^2/N^2, or |X|^2/M^2 for explicitly omitted
// direct-coordinate pairs (M contributors); neither is a density or uncertainty.
import {randomUUID} from 'node:crypto';
import {DatasetResourceBudget} from './dataset-resource-budget.js';
import {NumericalExecutionBudget} from './numerical-execution-budget.js';
import {validNumericalExecutionPolicy} from './web/numerical-execution-policy.js';
import {validDatasetResourcePolicy} from './web/dataset-resource-policy.js';
import {validCalculationPolicy} from './web/tools/calculation-policy.js';
import {validApproximateResult} from './web/tools/approximate-calculation-model.js';
import {validCellComputation,hasApproximateComputation} from './web/measurement-computation.js';
import {validatePolicyScalar,isScalarResourceFailure} from './web/measurement-scalar-policy.js';
import {plotRational,addPlotRational,multiplyPlotRational,dividePlotRational,reducePlotRational} from './web/plot-resource-policy.js';
import {revisionText} from './web/revision-model.js';
import {SPECTRUM_METHOD,DIRECT_SPECTRUM_METHOD,SPECTRUM_WINDOWS,powerOfTwoCount} from './web/dataset-spectrum-model.js';
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
// The authenticated work owner pins count/source/policies independently. This
// cursor admits only committed batch boundaries, never a partially applied FFT.
const positiveCount=value=>Number.isSafeInteger(value)&&value>0;
function validV3Request(count,{method,window,frequencyCount,missing='reject',excluded='reject'}){return [SPECTRUM_METHOD,DIRECT_SPECTRUM_METHOD].includes(method)&&['reject','omit'].includes(missing)&&['reject','omit'].includes(excluded)&&SPECTRUM_WINDOWS.includes(window)&&(window==='rectangular'||count>=2)&&(method===SPECTRUM_METHOD?missing==='reject'&&excluded==='reject'&&powerOfTwoCount(count)&&(frequencyCount===undefined||frequencyCount===count):positiveCount(count)&&positiveCount(frequencyCount)&&Number.isSafeInteger(count*frequencyCount));}
export function validSpectrumExecutionCursor(value,count,options={}){
 if(options.version===3){
  if(!validV3Request(count,options))return false;if(value===null)return true;
  const direct=options.method===DIRECT_SPECTRUM_METHOD,total=direct?options.frequencyCount:count,common=['version','method','window','approximate','approximateInputs','amplitudeInputs','coordinateInputs','contributedCount','omittedMissing','omittedExcluded'];
  if(!value||value.version!==2||value.method!==options.method||value.window!==options.window||!['approximate','approximateInputs','amplitudeInputs','coordinateInputs'].every(key=>typeof value[key]==='boolean')||value.approximateInputs!==(value.amplitudeInputs||value.coordinateInputs)||!direct&&value.coordinateInputs)return false;
  const counts=['contributedCount','omittedMissing','omittedExcluded'];if(!counts.every(key=>Number.isSafeInteger(value[key])&&value[key]>=0&&value[key]<=count&&!Object.is(value[key],-0)))return false;
  const processed=value.contributedCount+value.omittedMissing+value.omittedExcluded;if(!Number.isSafeInteger(processed)||processed!==(value.phase==='input'?value.offset:count)||value.phase!=='input'&&value.contributedCount===0||value.contributedCount===0&&value.approximateInputs||(options.missing??'reject')==='reject'&&value.omittedMissing!==0||(options.excluded??'reject')==='reject'&&value.omittedExcluded!==0)return false;
  if(['input','output','complete'].includes(value.phase)){
   if(!exact(value,[...common,'phase','offset'])||!Number.isSafeInteger(value.offset)||value.offset<0||Object.is(value.offset,-0))return false;
   if(value.phase==='complete')return value.offset===total;
   return value.offset<(value.phase==='input'?count:total)&&value.offset%32===0&&(value.phase!=='input'||!value.approximate)&&(value.phase!=='input'||value.offset!==0||!value.approximateInputs)&&(value.phase!=='output'||value.offset!==0||!value.approximate);
  }
  if(value.phase!=='transform'||value.approximate)return false;
  if(direct)return exact(value,[...common,'phase','frequency','inputOffset'])&&Number.isSafeInteger(value.frequency)&&value.frequency>=0&&value.frequency<total&&!Object.is(value.frequency,-0)&&Number.isSafeInteger(value.inputOffset)&&value.inputOffset>=0&&value.inputOffset<count&&value.inputOffset%16===0&&!Object.is(value.inputOffset,-0);
  return exact(value,[...common,'phase','length','position','start'])&&powerOfTwoCount(value.length)&&value.length>=2&&value.length<=count&&Number.isSafeInteger(value.position)&&value.position>=0&&value.position<value.length/2&&!Object.is(value.position,-0)&&Number.isSafeInteger(value.start)&&value.start>=0&&value.start<count&&!Object.is(value.start,-0)&&value.start%value.length===0&&(value.position*(count/value.length)+value.start/value.length)%16===0;
 }

 if(!powerOfTwoCount(count))return false;if(value===null)return true;
 const common=['version','phase','approximate','approximateInputs'];if(!value||value.version!==1||typeof value.approximate!=='boolean'||typeof value.approximateInputs!=='boolean')return false;
 if(['input','output','complete'].includes(value.phase)){
  if(!exact(value,[...common,'offset'])||!Number.isSafeInteger(value.offset)||value.offset<0)return false;
  if(value.phase==='complete')return value.offset===count;
  return value.offset<count&&value.offset%32===0&&(value.phase!=='input'||value.approximate===false)&&(value.offset!==0||value.approximate===false)&&(value.phase!=='input'||value.offset!==0||value.approximateInputs===false);
 }
 return value.phase==='transform'&&exact(value,[...common,'length','position','start'])&&value.approximate===false&&powerOfTwoCount(value.length)&&value.length>=2&&value.length<=count&&Number.isSafeInteger(value.position)&&value.position>=0&&value.position<value.length/2&&Number.isSafeInteger(value.start)&&value.start>=0&&value.start<count&&value.start%value.length===0&&(value.position*(count/value.length)+value.start/value.length)%16===0;
}
export async function evaluateSpectrum({count,read,readFrequency,work,write}={},options={}){
 const {resourcePolicy,calculationPolicy,signal,check,progress,budget:providedBudget,executionPolicy,execution}=options;
 const v3=options.version===3,direct=v3&&options.method===DIRECT_SPECTRUM_METHOD,method=v3?options.method:SPECTRUM_METHOD,window=v3?options.window:'rectangular',missing=options.missing??'reject',excluded=options.excluded??'reject',outputCount=direct?options.frequencyCount:count,cursorOptions=v3?{version:3,method,window,frequencyCount:options.frequencyCount,missing,excluded}:{};
 if(v3&&(!execution||!validV3Request(count,cursorOptions)||direct&&typeof readFrequency!=='function'))fail();
 if(!(v3?validV3Request(count,cursorOptions):powerOfTwoCount(count))||typeof read!=='function'||typeof write!=='function'||!execution&&(typeof work?.getMany!=='function'||typeof work?.putMany!=='function')||!validDatasetResourcePolicy(resourcePolicy)||!validCalculationPolicy(calculationPolicy)||calculationPolicy.version!==2)fail();
 if(execution!==undefined&&(!execution||typeof execution.slice!=='function'||!validNumericalExecutionPolicy(executionPolicy)||!validSpectrumExecutionCursor(execution.cursor??null,count,cursorOptions)||providedBudget!==undefined||executionPolicy.slice.maxOperations>calculationPolicy.resources.maxOperations||executionPolicy.slice.maxActiveMilliseconds>calculationPolicy.resources.maxMilliseconds)||execution===undefined&&executionPolicy!==undefined)fail();
 if(providedBudget!==undefined&&(!(providedBudget instanceof DatasetResourceBudget)||revisionText(providedBudget.scalarPolicy)!==revisionText(resourcePolicy)))fail();
 if(calculationPolicy.resources.maxComponents<2)fail('DATASET_CALCULATION_RESOURCE');
 const enginePolicy={...resourcePolicy,resources:{...resourcePolicy.resources,maxBits:calculationPolicy.resources.maxBits,maxOperations:calculationPolicy.resources.maxOperations,maxMilliseconds:calculationPolicy.resources.maxMilliseconds,maxScalarCharacters:Math.min(65536,calculationPolicy.resources.maxResultCharacters),maxExponent:Math.min(65536,calculationPolicy.resources.maxBits)}},runtime=calculationRuntime({engine:4,policy:calculationPolicy}),math=runtime.math,prefix=execution?'spectrum:':'spectrum:'+randomUUID()+':';
 let resource=providedBudget??new DatasetResourceBudget(resourcePolicy),engineBudget=new DatasetResourceBudget(enginePolicy),budget=combinedBudget(resource,engineBudget);const limits=budget.scalarPolicy.resources;
 let levels=0;for(let n=count;n>1;n/=2)levels++;let approximate=false,approximateInputs=false,amplitudeInputs=false,coordinateInputs=false,contributedCount=0,omittedMissing=0,omittedExcluded=0;
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
 // Periodic windows and coordinate phases share the same typed arithmetic.
 // Rational cycles are reduced before pi is introduced; quarter turns are exact.
 function phaseRotation(cycles,cosineOnly=false){
  budget.step();const denominator=cycles.denominator;let numerator=cycles.numerator%denominator;if(numerator<0n)numerator+=denominator;
  const four=budget.product(4n,numerator);if(four%denominator===0n){const quadrant=Number(four/denominator),one=exactValue({numerator:1n,denominator:1n}),minus=exactValue({numerator:-1n,denominator:1n});return [{real:one,imaginary:zero()},{real:zero(),imaginary:minus},{real:minus,imaginary:zero()},{real:zero(),imaginary:one}][quadrant];}
  const phase=exactValue({numerator:budget.product(2n,numerator),denominator});budget.step();const angle=math.multiply(big(phase),math.pi);budget.step();const real=rounded(math.cos(angle));if(cosineOnly)return {real,imaginary:zero()};budget.step();return {real,imaginary:negative(rounded(math.sin(angle)))};
 }
 function windowWeight(index){
  const ratio=(numerator,denominator=1n)=>exactValue({numerator,denominator});if(window==='rectangular')return ratio(1n);
  const cosine=phaseRotation(ratio(BigInt(index),BigInt(count)),true).real;
  if(window==='hann-periodic')return difference(ratio(1n,2n),product(ratio(1n,2n),cosine));
  if(window==='hamming-periodic')return difference(ratio(27n,50n),product(ratio(23n,50n),cosine));
  return sum(difference(ratio(21n,50n),product(ratio(1n,2n),cosine)),product(ratio(2n,25n),phaseRotation(ratio(budget.product(2n,BigInt(index)),BigInt(count)),true).real));
 }
 const encodeComplex=value=>({real:encode(value.real),imaginary:encode(value.imaginary)});
 // Omissions retain their original ordinal. They are never numeric zero inputs,
 // and each checked marker still consumes numerical execution work.
 function skipReason(value,code='DATASET_SPECTRUM_INPUT'){
  budget.step();if(!direct||!exact(value,['skip','reason'])||value.skip!==true||!['excluded','missing-signal','missing-coordinate','missing-both'].includes(value.reason))fail(code);
  if((value.reason==='excluded'?excluded:missing)!=='omit')fail(code==='MATERIAL_MISSING'?code:'DATASET_SPECTRUM_MISSING');return value.reason;
 }
 function inputEntry3(input,index){
  if(input&&Object.hasOwn(input,'skip')){const reason=skipReason(input);if(reason==='excluded')omittedExcluded++;else omittedMissing++;return [key('input:'+index),{skip:true,reason}];}
  const names=['real','imaginary','resourcePolicy','computation',...(direct?['coordinate','coordinateComputation']:[])];
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(name=>!names.includes(name))||!Object.hasOwn(input,'computation')||!validCellComputation(input.computation)||!validDatasetResourcePolicy(input.resourcePolicy)||direct&&(!Object.hasOwn(input,'coordinateComputation')||!validCellComputation(input.coordinateComputation)))fail('DATASET_SPECTRUM_INPUT');
  const parse=value=>exactValue(validatePolicyScalar(value,input.resourcePolicy,{budget}));let value={real:parse(input.real),imaginary:input.imaginary===undefined?zero():parse(input.imaginary)};
  amplitudeInputs ||= hasApproximateComputation(input);contributedCount++;
  if(!(isZero(value.real)&&isZero(value.imaginary))){const weight=windowWeight(index);value={real:product(value.real,weight),imaginary:product(value.imaginary,weight)};}
  if(direct){const coordinate=exactValue(validatePolicyScalar(input.coordinate,resourcePolicy,{budget}));coordinateInputs ||= hasApproximateComputation({computation:input.coordinateComputation});approximateInputs=amplitudeInputs||coordinateInputs;return [key('input:'+index),{value:encodeComplex(value),coordinate:encode(coordinate)}];}
  approximateInputs=amplitudeInputs;return [key(reverse(index)),encodeComplex(value)];
 }
 function exactRecord(value){const result=decode(value);if(result.kind!=='exact')fail('MATERIAL_MISSING');return result;}
 function rotateCycles(value,cycles){
  if(isZero(value.real)&&isZero(value.imaginary))return value;const rotation=phaseRotation(cycles);
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
 function inputEntry(input,index){
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(name=>!['real','imaginary','resourcePolicy','computation'].includes(name))||!Object.hasOwn(input,'computation')||!validCellComputation(input.computation)||!validDatasetResourcePolicy(input.resourcePolicy))fail('DATASET_SPECTRUM_INPUT');
   const parse=value=>exactValue(validatePolicyScalar(value,input.resourcePolicy,{budget}));
   const value={real:parse(input.real),imaginary:input.imaginary===undefined?zero():parse(input.imaginary)};approximateInputs ||= hasApproximateComputation(input);return [key(reverse(index)),{real:encode(value.real),imaginary:encode(value.imaginary)}];

 }
 function butterfly(a,b,position,length,rotation){const value=rotated(b,position,length,rotation);return [{real:encode(sum(a.real,value.real)),imaginary:encode(sum(a.imaginary,value.imaginary))},{real:encode(difference(a.real,value.real)),imaginary:encode(difference(a.imaginary,value.imaginary))}];}
 function outputBin(raw,index,normalizer){
  const value=record(raw),power=quotient(sum(product(value.real,value.real),product(value.imaginary,value.imaginary)),normalizer),rational={},result={index,...(v3?{inputCount:count,contributedCount,omittedMissing,omittedExcluded}:{}),approximate:[value.real,value.imaginary,power].some(component=>component.kind==='approximate'),approximateInputs};
  for(const [field,component]of Object.entries({...value,normalizedSquaredMagnitude:power})){const spelling=component.kind==='exact'?rationalText(component):component.spelling,rationalSpelling=outputRational(component);if(Math.max(spelling.length,rationalSpelling.length)>limits.maxScalarCharacters||Math.max(spelling.length,rationalSpelling.length)>calculationPolicy.resources.maxResultCharacters)fail('DATASET_CALCULATION_RESOURCE');result[field]={spelling,representation:component.kind==='exact'?'rational':'decimal',radix:10};rational[field]=rationalSpelling;}result.rational=rational;approximate ||= result.approximate;return result;
 }
 const summary=()=>({version:v3?3:execution?2:1,method,count,...(v3?{outputCount,window,missing,excluded,contributedCount,omittedMissing,omittedExcluded}:{}),engine:4,calculationPolicy:structuredClone(calculationPolicy),resourcePolicy:structuredClone(resourcePolicy),...(execution?{executionPolicy:structuredClone(executionPolicy)}:{}),approximate,approximateInputs});
 if(execution){
  let cursor=execution.cursor??null;if(cursor){approximate=cursor.approximate;approximateInputs=cursor.approximateInputs;if(v3){amplitudeInputs=cursor.amplitudeInputs;coordinateInputs=cursor.coordinateInputs;contributedCount=cursor.contributedCount;omittedMissing=cursor.omittedMissing;omittedExcluded=cursor.omittedExcluded;}}
  const flags=()=>v3?{version:2,method,window,approximate,approximateInputs,amplitudeInputs,coordinateInputs,contributedCount,omittedMissing,omittedExcluded}:{version:1,approximate,approximateInputs};
  while(cursor?.phase!=='complete'){
   await current();const before=cursor?structuredClone(cursor):null,position=before??{...flags(),phase:'input',offset:0};let expected,reported;
   const next=await execution.slice(before,async scope=>{
    if(!(scope?.budget instanceof NumericalExecutionBudget)||revisionText(scope.budget.policy)!==revisionText(executionPolicy)||typeof scope.work?.getMany!=='function'||typeof scope.work?.putMany!=='function')fail();
    resource=scope.budget.scalarBudget(resourcePolicy);engineBudget=new DatasetResourceBudget(enginePolicy);budget=combinedBudget(resource,engineBudget);work=scope.work;
    if(position.phase==='input'){
     const end=Math.min(count,position.offset+32),entries=[];for(let index=position.offset;index<end;index++){const value=await io(()=>read(index,{budget:resource,signal}));entries.push(run(()=>(v3?inputEntry3:inputEntry)(value,index),'DATASET_SPECTRUM_INPUT'));}if(v3&&end===count&&contributedCount===0)fail('DATASET_SPECTRUM_MISSING');await io(()=>work.putMany(entries));
     expected=end<count?{...flags(),phase:'input',offset:end}:direct?{...flags(),phase:'transform',frequency:0,inputOffset:0}:count===1?{...flags(),phase:'output',offset:0}:{...flags(),phase:'transform',length:2,position:0,start:0};reported={phase:'input',done:end,total:count};
    }else if(position.phase==='transform'&&direct){
     let frequency,value;
     if(position.inputOffset===0){const supplied=await io(()=>readFrequency(position.frequency,{budget:resource,signal}));frequency=run(()=>{if(!exact(supplied,['scalar','computation'])||supplied.computation!==null)fail('DATASET_SPECTRUM_INPUT');return exactValue(validatePolicyScalar(supplied.scalar,resourcePolicy,{budget}));},'DATASET_SPECTRUM_INPUT');value={real:zero(),imaginary:zero()};}
     else{const stored=await io(()=>work.getMany([key('direct:sum')]));run(()=>{if(!(stored instanceof Map))fail('MATERIAL_MISSING');const partial=stored.get(key('direct:sum'));if(!exact(partial,['frequency','inputOffset','phaseFrequency','value'])||partial.frequency!==position.frequency||partial.inputOffset!==position.inputOffset)fail('MATERIAL_MISSING');frequency=exactRecord(partial.phaseFrequency);value=record(partial.value);});}
     const end=Math.min(count,position.inputOffset+16),keys=Array.from({length:end-position.inputOffset},(_,i)=>key('input:'+(position.inputOffset+i))),stored=await io(()=>work.getMany(keys));
     const update=run(()=>{if(!(stored instanceof Map))fail('MATERIAL_MISSING');for(const name of keys){const input=stored.get(name);if(input&&Object.hasOwn(input,'skip')){skipReason(input,'MATERIAL_MISSING');continue;}if(!exact(input,['value','coordinate']))fail('MATERIAL_MISSING');const sample=record(input.value),coordinate=exactRecord(input.coordinate),cycles=product(frequency,coordinate),rotated=rotateCycles(sample,cycles);value={real:sum(value.real,rotated.real),imaginary:sum(value.imaginary,rotated.imaginary)};}return end===count?[key(position.frequency),{value:encodeComplex(value),frequency:encode(frequency)}]:[key('direct:sum'),{frequency:position.frequency,inputOffset:end,phaseFrequency:encode(frequency),value:encodeComplex(value)}];});await io(()=>work.putMany([update]));
     expected=end<count?{...flags(),phase:'transform',frequency:position.frequency,inputOffset:end}:position.frequency+1<outputCount?{...flags(),phase:'transform',frequency:position.frequency+1,inputOffset:0}:{...flags(),phase:'output',offset:0};reported={phase:'transform',frequency:position.frequency,frequencies:outputCount,done:position.frequency*count+end,total:outputCount*count};
    }else if(position.phase==='transform'){
     const length=position.length,half=length/2,pairs=[],keys=[];let at=position.position,start=position.start;
     while(pairs.length<16&&at<half){const left=start+at,right=left+half;pairs.push({left,right,position:at});keys.push(key(left),key(right));start+=length;if(start===count){start=0;at++;}}
     const values=await io(()=>work.getMany(keys));if(!(values instanceof Map))fail('MATERIAL_MISSING');
     const updates=run(()=>{const entries=[];let rotation=null,rotationAt=-1;for(const pair of pairs){const a=record(values.get(key(pair.left))),b=record(values.get(key(pair.right)));if(rotationAt!==pair.position){rotationAt=pair.position;rotation=null;}if(pair.position!==0&&pair.position!==length/4&&!(isZero(b.real)&&isZero(b.imaginary)))rotation??=twiddle(pair.position,length);const result=butterfly(a,b,pair.position,length,rotation);entries.push([key(pair.left),result[0]],[key(pair.right),result[1]]);}return entries;});await io(()=>work.putMany(updates));
     expected=at<half?{...flags(),phase:'transform',length,position:at,start}:length===count?{...flags(),phase:'output',offset:0}:{...flags(),phase:'transform',length:length*2,position:0,start:0};reported={phase:'transform',stage:Math.log2(length),stages:levels,done:at<half?2*(at*(count/length)+start/length):count,total:count};
    }else if(position.phase==='output'){
     const end=Math.min(outputCount,position.offset+32),keys=Array.from({length:end-position.offset},(_,i)=>key(position.offset+i)),values=await io(()=>work.getMany(keys));if(!(values instanceof Map))fail('MATERIAL_MISSING');const normalizer=run(()=>exactValue({numerator:budget.product(BigInt(v3?contributedCount:count),BigInt(v3?contributedCount:count)),denominator:1n}));
     for(let local=0;local<keys.length;local++){const bin=run(()=>{const stored=values.get(keys[local]);if(!direct)return outputBin(stored,position.offset+local,normalizer);if(!exact(stored,['value','frequency']))fail('MATERIAL_MISSING');const frequency=exactRecord(stored.frequency),bin=outputBin(stored.value,position.offset+local,normalizer);bin.frequency={spelling:rationalText(frequency),representation:'rational',radix:10};bin.approximateInputs=amplitudeInputs||!isZero(frequency)&&coordinateInputs;return bin;});await io(()=>write(bin,{budget:resource,work}));}
     expected={...flags(),phase:end===outputCount?'complete':'output',offset:end};reported={phase:'output',done:end,total:outputCount};
    }else fail();
    if(!validSpectrumExecutionCursor(expected,count,cursorOptions))fail('MATERIAL_MISSING');return expected;
   });
   if(!expected||!validSpectrumExecutionCursor(next,count,cursorOptions)||revisionText(next)!==revisionText(expected))fail('MATERIAL_MISSING');cursor=structuredClone(next);await report(reported);
  }
  await current();return summary();
 }
 let pending=[];
 for(let index=0;index<count;index++){
  const input=await io(()=>read(index,{budget:resource,signal})),entry=run(()=>inputEntry(input,index),'DATASET_SPECTRUM_INPUT');pending.push(entry);
  if(pending.length===32||index===count-1){await io(()=>work.putMany(pending));pending=[];await report({phase:'input',done:index+1,total:count});}
 }
 for(let length=2,stage=1;length<=count;length*=2,stage++){
  const half=length/2;let done=0;
  for(let position=0;position<half;position++){
   let rotation=null;
   for(let start=0;start<count;){
    const pairs=[],keys=[];for(let pair=0;pair<16&&start<count;pair++,start+=length){const left=start+position,right=left+half;pairs.push([left,right]);keys.push(key(left),key(right));}
    const values=await io(()=>work.getMany(keys));if(!(values instanceof Map))fail('MATERIAL_MISSING');
    const updates=run(()=>{const output=[];for(const [left,right]of pairs){const a=record(values.get(key(left))),b=record(values.get(key(right)));if(position!==0&&position!==length/4&&!(isZero(b.real)&&isZero(b.imaginary)))rotation??=twiddle(position,length);const result=butterfly(a,b,position,length,rotation);output.push([key(left),result[0]],[key(right),result[1]]);}return output;});
    await io(()=>work.putMany(updates));done+=pairs.length*2;await report({phase:'transform',stage,stages:levels,done,total:count});
   }
  }
  if(length===count)break;
 }
 const normalizer=run(()=>exactValue({numerator:budget.product(BigInt(count),BigInt(count)),denominator:1n}));
 for(let offset=0;offset<count;offset+=32){
  const keys=Array.from({length:Math.min(32,count-offset)},(_,index)=>key(offset+index)),values=await io(()=>work.getMany(keys));if(!(values instanceof Map))fail('MATERIAL_MISSING');
  for(let local=0;local<keys.length;local++){
   const bin=run(()=>outputBin(values.get(keys[local]),offset+local,normalizer));await io(()=>write(bin));
  }
  await report({phase:'output',done:Math.min(count,offset+keys.length),total:count});
 }
 await current();return summary();
}

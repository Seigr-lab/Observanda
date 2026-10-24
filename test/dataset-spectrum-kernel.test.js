import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateSpectrum} from '../src/dataset-spectrum-kernel.js';
import {DatasetResourceBudget} from '../src/dataset-resource-budget.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {defaultStructuredCalculationPolicy} from '../src/web/tools/calculation-policy.js';
import {validatePolicyScalar} from '../src/web/measurement-scalar-policy.js';
const policy=resources=>({...defaultDatasetResourcePolicy(),resources:{...defaultDatasetResourcePolicy().resources,...resources}});
const calculation=overrides=>({...defaultStructuredCalculationPolicy(),workingDigits:32,displayDigits:4,...overrides});
const scalar=(spelling,representation='rational',radix=10)=>({spelling:String(spelling),representation,radix});
const input=(real,imaginary,own=policy(),computation=null)=>({real:scalar(String(real)+'/1'),...(imaginary===undefined?{}:{imaginary:scalar(String(imaginary)+'/1')}),resourcePolicy:own,computation});
const number=value=>{const parsed=validatePolicyScalar(value,policy());return Number(parsed.numerator)/Number(parsed.denominator);};
function fixture(inputs,{get,put,read,write}={}){
 const stored=new Map(),batches=[],bins=[],reads=[];
 const work={getMany:async keys=>{assert.ok(keys.length>=1&&keys.length<=32);assert.equal(new Set(keys).size,keys.length);batches.push(['get',keys.length]);const values=new Map([...keys].reverse().filter(key=>stored.has(key)).map(key=>[key,structuredClone(stored.get(key))]));await get?.(values,keys);return values;},putMany:async entries=>{assert.ok(entries.length>=1&&entries.length<=32);assert.equal(new Set(entries.map(([key])=>key)).size,entries.length);batches.push(['put',entries.length]);await put?.(entries);for(const [key,value]of entries)stored.set(key,structuredClone(value));}};
 const args={count:inputs.length,work,read:async(index,context)=>{reads.push(index);await read?.(index,context);return structuredClone(inputs[index]);},write:async value=>{await write?.(value);bins.push(structuredClone(value));}};
 return {args,stored,batches,bins,reads,run:options=>evaluateSpectrum(args,{resourcePolicy:policy(),calculationPolicy:calculation(),...options})};
}
test('impulse and DC emit every exact unscaled bin and normalized squared magnitude',async()=>{
 for(const count of [1,2,8,64]){
  const f=fixture(Array.from({length:count},(_,i)=>input(i===0?1:0))),summary=await f.run();assert.equal(summary.approximate,false);assert.equal(summary.approximateInputs,false);assert.deepEqual(f.reads,Array.from({length:count},(_,i)=>i));assert.deepEqual(f.bins.map(bin=>bin.index),f.reads);
  for(const bin of f.bins){assert.deepEqual(bin.real,scalar('1/1'));assert.deepEqual(bin.imaginary,scalar('0/1'));assert.deepEqual(bin.normalizedSquaredMagnitude,scalar('1/'+BigInt(count)**2n));assert.equal(bin.approximate,false);}
  assert.equal(f.stored.size,count);assert.ok(f.batches.every(([,size])=>size<=32));
 }
 const dc=fixture(Array.from({length:8},()=>input(3)));await dc.run();assert.equal(dc.bins[0].real.spelling,'24/1');assert.equal(dc.bins[0].normalizedSquaredMagnitude.spelling,'9/1');for(const bin of dc.bins.slice(1)){assert.equal(bin.real.spelling,'0/1');assert.equal(bin.imaginary.spelling,'0/1');assert.equal(bin.approximate,false);}
});
test('exact complex quarter-turn tone uses the forward negative exponent with full unshifted bins',async()=>{
 const tone=[[1,0],[0,1],[-1,0],[0,-1]],f=fixture(Array.from({length:8},(_,i)=>input(...tone[i%4])));await f.run();
 for(const bin of f.bins){assert.equal(bin.real.spelling,bin.index===2?'8/1':'0/1');assert.equal(bin.imaginary.spelling,'0/1');assert.equal(bin.normalizedSquaredMagnitude.spelling,bin.index===2?'1/1':'0/1');assert.equal(bin.approximate,false);}
 const negative=fixture(tone.map(([real,imaginary])=>input(real,-imaginary)));await negative.run();assert.equal(negative.bins[3].real.spelling,'4/1');assert.equal(negative.bins[1].real.spelling,'0/1');
});
test('generic complex bins agree with a small independent direct DFT oracle and retain full computational decimals',async()=>{
 const samples=[[1,2],[3,-1],[2,1],[0,0],[-1,2],[4,0],[1,-3],[2,1]],f=fixture(samples.map(value=>input(...value))),saved=calculation(),summary=await f.run({calculationPolicy:saved});assert.equal(summary.approximate,true);assert.deepEqual(summary.calculationPolicy,saved);
 let power=0;for(const bin of f.bins){let real=0,imaginary=0;for(let j=0;j<samples.length;j++){const angle=-2*Math.PI*j*bin.index/samples.length,[a,b]=samples[j];real+=a*Math.cos(angle)-b*Math.sin(angle);imaginary+=a*Math.sin(angle)+b*Math.cos(angle);}assert.ok(Math.abs(number(bin.real)-real)<1e-11);assert.ok(Math.abs(number(bin.imaginary)-imaginary)<1e-11);const normalized=(real*real+imaginary*imaginary)/(samples.length*samples.length);assert.ok(Math.abs(number(bin.normalizedSquaredMagnitude)-normalized)<1e-11);power+=number(bin.normalizedSquaredMagnitude);}
 assert.ok(Math.abs(power-samples.reduce((sum,[a,b])=>sum+a*a+b*b,0)/samples.length)<1e-11);assert.ok(f.bins.some(bin=>bin.real.representation==='decimal'&&bin.real.spelling.length>20));assert.ok(f.bins.filter(bin=>bin.index%2===0).every(bin=>!bin.approximate));
 const shorter=fixture(samples.map(value=>input(...value)));await shorter.run({calculationPolicy:calculation({workingDigits:16})});assert.notEqual(f.bins[1].real.spelling,shorter.bins[1].real.spelling);assert.deepEqual(f.bins[0].real,shorter.bins[0].real);
});
test('source radix and input approximation stay separate from newly rounded numerical operations',async()=>{
 const own=policy(),half={real:scalar('0.3','radix-fraction',6),resourcePolicy:own,computation:null},f=fixture([half]);await f.run();assert.deepEqual(f.bins[0].real,scalar('1/2'));assert.deepEqual(f.bins[0].normalizedSquaredMagnitude,scalar('1/4'));
 const approximate={version:1,kind:'approximate-inputs'},values=Array.from({length:4},(_,i)=>input(1,undefined,own,i===0?approximate:null)),prior=structuredClone(values),derived=fixture(values),summary=await derived.run();assert.equal(summary.approximate,false);assert.equal(summary.approximateInputs,true);assert.ok(derived.bins.every(bin=>!bin.approximate&&bin.approximateInputs));assert.deepEqual(values,prior);
 const long=fixture([{real:scalar('0'.repeat(5000)+'2','decimal'),resourcePolicy:own,computation:null}]);await long.run();assert.equal(long.bins[0].real.spelling,'2/1');assert.equal(long.bins[0].normalizedSquaredMagnitude.spelling,'4/1');
});
test('invalid counts, omitted/missing components and corrupt scratch records refuse without padding',async()=>{
 for(const count of [0,3,6,-1,1.5,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1]){const f=fixture([input(1)]);f.args.count=count;await assert.rejects(f.run(),{code:'DATASET_SPECTRUM_INVALID'});assert.equal(f.reads.length,0);assert.equal(f.stored.size,0);}
 for(const malformed of [null,{real:null,resourcePolicy:policy(),computation:null},{real:scalar('NaN','decimal'),resourcePolicy:policy(),computation:null},{...input(1),imaginary:null},{real:scalar('1/1'),resourcePolicy:policy()}]){const f=fixture([malformed]);await assert.rejects(f.run(),{code:'DATASET_SPECTRUM_INPUT'});assert.equal(f.bins.length,0);}
 const absent=fixture([input(1),input(2)],{get:(values,keys)=>values.delete(keys[0])});await assert.rejects(absent.run(),{code:'MATERIAL_MISSING'});assert.equal(absent.bins.length,0);
 const corrupt=fixture([input(1)],{get:values=>{const first=values.values().next().value;first.real.spelling='2/2';}});await assert.rejects(corrupt.run(),{code:'MATERIAL_MISSING'});
});
test('source, common and calculation policies remain cumulative and resource refusal never authorizes rounding',async()=>{
 const huge=fixture([input(1n<<70n,undefined,policy({maxBits:64}))]);await assert.rejects(huge.run(),{code:'DATASET_CALCULATION_RESOURCE'});
 const own=policy({maxOperations:2000}),consumed=new DatasetResourceBudget(own);consumed.run(()=>{for(let i=0;i<1998;i++)consumed.step();});await assert.rejects(fixture([input(1)]).run({resourcePolicy:own,budget:consumed}),{code:'DATASET_CALCULATION_RESOURCE'});
 const base=calculation();for(const resources of [{...base.resources,maxComponents:1},{...base.resources,maxOperations:1}])await assert.rejects(fixture([input(1)]).run({calculationPolicy:{...base,resources}}),{code:'DATASET_CALCULATION_RESOURCE'});
 const low={...base,resources:{...base.resources,maxOperations:100}};await fixture([input(1)]).run({calculationPolicy:low});await assert.rejects(fixture(Array.from({length:8},(_,i)=>input(i+1))).run({calculationPolicy:low}),{code:'DATASET_CALCULATION_RESOURCE'});
 await assert.rejects(fixture([input(1)]).run({budget:new DatasetResourceBudget(policy({maxBits:128}))}),{code:'DATASET_SPECTRUM_INVALID'});
});
test('awaited source/scratch/output I/O does not spend CPU time and cancellation/access identity remains intact',async()=>{
 const pause=()=>new Promise(resolve=>setTimeout(resolve,75)),own=policy({maxMilliseconds:50}),base=calculation(),f=fixture([input(1,undefined,own)],{read:pause,get:pause,put:pause,write:pause});const started=performance.now();await f.run({resourcePolicy:own,calculationPolicy:{...base,resources:{...base.resources,maxMilliseconds:50}}});assert.ok(performance.now()-started>250);
 const controller=new AbortController(),cancelled=fixture(Array.from({length:8},()=>input(1)),{read:index=>{if(index===2)controller.abort();}});await assert.rejects(cancelled.run({signal:controller.signal}),{name:'AbortError'});assert.deepEqual(cancelled.reads,[0,1,2]);assert.equal(cancelled.bins.length,0);
 const denied=Object.assign(Error('Denied'),{code:'ACCESS_LOCKED'}),locked=fixture([input(1)]);await assert.rejects(locked.run({check:()=>{throw denied;}}),error=>error===denied);assert.equal(locked.reads.length,0);
 const phases=[],progress=fixture([input(1),input(0)]);await progress.run({progress:value=>phases.push(value)});assert.deepEqual([...new Set(phases.map(value=>value.phase))],['input','transform','output']);assert.ok(phases.every(value=>Number.isSafeInteger(value.done)&&value.done<=value.total));
});


test('generated canonical rational projection preserves every computational digit and uses the same bounds',async()=>{
 const own=policy(),f=fixture(Array.from({length:16},(_,i)=>input((i*73+19)%257-128))),saved=defaultStructuredCalculationPolicy();await f.run({calculationPolicy:saved});
 for(const bin of f.bins)for(const field of ['real','imaginary','normalizedSquaredMagnitude']){
  const number=validatePolicyScalar(bin[field],own),canonical=validatePolicyScalar(scalar(bin.rational[field]),own);assert.deepEqual(canonical,number);assert.equal(bin.rational[field],canonical.numerator+'/'+canonical.denominator);
 }
 assert.ok(f.bins.some(bin=>bin.approximate&&bin.real.spelling.length>saved.displayDigits));
 for(const constrained of [policy({maxBits:64}),policy({maxScalarCharacters:16})])await assert.rejects(fixture(Array.from({length:8},(_,i)=>input(i===1?1:0,undefined,constrained))).run({resourcePolicy:constrained,calculationPolicy:saved}),{code:'DATASET_CALCULATION_RESOURCE'});
 const low=saved.resources;await assert.rejects(fixture([{real:scalar('1'.repeat(40),'integer'),resourcePolicy:own,computation:null}]).run({calculationPolicy:{...saved,resources:{...low,maxResultCharacters:32}}}),{code:'DATASET_CALCULATION_RESOURCE'});
 const corrupt=fixture(Array.from({length:8},(_,i)=>input(i===1?1:0)),{get:values=>{const value=[...values.values()].find(v=>v.real.kind==='approximate');if(value)value.real.spelling='1e65536';}});await assert.rejects(corrupt.run(),{code:'DATASET_CALCULATION_RESOURCE'});
});

test('dense 16 and 256 samples complete under unchanged defaults, all bins agree with a direct DFT',async()=>{
 for(const count of [16,256]){
  const own=policy(),budget=new DatasetResourceBudget(own),samples=Array.from({length:count},(_,i)=>(i*73+19)%257-128),f=fixture(samples.map(value=>input(value))),summary=await f.run({resourcePolicy:own,calculationPolicy:defaultStructuredCalculationPolicy(),budget});assert.equal(f.bins.length,count);assert.equal(summary.approximate,true);assert.ok(budget.operations<=own.resources.maxOperations);let energy=0;
  for(const bin of f.bins){let real=0,imaginary=0;for(let i=0;i<count;i++){const angle=-2*Math.PI*i*bin.index/count;real+=samples[i]*Math.cos(angle);imaginary+=samples[i]*Math.sin(angle);}assert.ok(Math.abs(number(bin.real)-real)<1e-8);assert.ok(Math.abs(number(bin.imaginary)-imaginary)<1e-8);assert.ok(Math.abs(number(bin.normalizedSquaredMagnitude)-(real*real+imaginary*imaginary)/(count*count))<1e-7);energy+=number(bin.normalizedSquaredMagnitude);}
  assert.ok(Math.abs(energy-samples.reduce((sum,value)=>sum+value*value,0)/count)<1e-8);assert.ok(f.batches.every(([,size])=>size<=32));
 }
});

test('dense 1024 sample refusal reports the unchanged cumulative operation limit before any output',async()=>{
 const own=policy(),budget=new DatasetResourceBudget(own),count=1024,f=fixture(Array.from({length:count},(_,i)=>input((i*73+19)%257-128))),progress=[];
 await assert.rejects(f.run({resourcePolicy:own,calculationPolicy:defaultStructuredCalculationPolicy(),budget,progress:value=>progress.push(value)}),{code:'DATASET_CALCULATION_RESOURCE'});assert.equal(budget.operations,own.resources.maxOperations+1);assert.equal(f.reads.length,count);assert.equal(f.bins.length,0);assert.equal(progress.at(-1).phase,'transform');assert.ok(f.batches.every(([,size])=>size<=32));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateSpectrum,validSpectrumExecutionCursor} from '../src/dataset-spectrum-kernel.js';
import {randomUUID} from 'node:crypto';
import {NumericalExecutionBudget,createNumericalExecutionState,reserveNumericalExecution,settleNumericalExecution,recoverNumericalExecution} from '../src/numerical-execution-budget.js';
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


const executionPolicy=(total=1000000,slice=50000)=>({version:1,scope:'numerical-job',total:{maxOperations:total,maxActiveMilliseconds:30000},slice:{maxOperations:slice,maxActiveMilliseconds:2500}});
function resumableFixture(inputs,{execution:authored=executionPolicy(),fault,write,parseSource=false}={}){
 const records=new Map(),reads=[],batches=[],commits=[];let cursor=null,ledger=createNumericalExecutionState('b'.repeat(64),authored),failed=false,currentOptions={};
 const clone=value=>value===undefined?undefined:structuredClone(value);
 const execution={get cursor(){return clone(cursor);},async slice(before,callback){
  assert.deepEqual(before,cursor);const operations=Math.min(authored.slice.maxOperations,authored.total.maxOperations-ledger.consumed.operations),activeMilliseconds=Math.min(authored.slice.maxActiveMilliseconds,Math.floor(authored.total.maxActiveMilliseconds-ledger.consumed.activeMilliseconds));if(operations<1||activeMilliseconds<1)throw Object.assign(Error('No remaining execution allowance'),{code:'DATASET_CALCULATION_RESOURCE'});
  ledger=reserveNumericalExecution(ledger,{id:randomUUID(),operations,activeMilliseconds});const budget=new NumericalExecutionBudget(ledger,{signal:currentOptions.signal}),staged=new Map();
  const value=key=>staged.has(key)?staged.get(key):records.get(key),work={get:async key=>clone(value(key)),put:async(key,item)=>{staged.set(key,clone(item));assert.ok(staged.size<=32);},getMany:async keys=>{assert.ok(keys.length<=32);assert.equal(new Set(keys).size,keys.length);batches.push(['get',keys.length]);return new Map([...keys].reverse().filter(key=>value(key)!==undefined).map(key=>[key,clone(value(key))]));},putMany:async entries=>{assert.ok(entries.length<=32);assert.equal(new Set(entries.map(([key])=>key)).size,entries.length);batches.push(['put',entries.length]);for(const[key,item]of entries)staged.set(key,clone(item));assert.ok(staged.size<=32);}};
  try{const next=await callback({budget,work});if(!failed&&fault?.(before,next,staged)){failed=true;throw Object.assign(Error('Lost process after work before checkpoint'),{simulatedCrash:true});}const settled=settleNumericalExecution(ledger,budget.finish());for(const[key,item]of staged){if(key.startsWith('output:'))assert.equal(records.has(key),false,'A committed output cannot be emitted twice');records.set(key,item);}ledger=settled;cursor=clone(next);commits.push({cursor:clone(cursor),usage:clone(ledger.consumed),staged:staged.size});return clone(next);}
  catch(error){if(!error.simulatedCrash)ledger=settleNumericalExecution(ledger,budget.finish());throw error;}
 }};
 const args={count:inputs.length,read:async(index,{budget})=>{reads.push(index);if(parseSource)budget.run(()=>validatePolicyScalar(inputs[index].real,inputs[index].resourcePolicy,{budget}));return clone(inputs[index]);},write:async(bin,context)=>{assert.ok(context.budget instanceof DatasetResourceBudget);await write?.(bin,context);await context.work.put('output:'+bin.index,bin);}};
 return {records,reads,batches,commits,args,execution,get cursor(){return clone(cursor);},get ledger(){return clone(ledger);},get bins(){return Array.from({length:inputs.length},(_,index)=>records.get('output:'+index)).filter(Boolean);},recover(){ledger=recoverNumericalExecution(clone(ledger));return clone(ledger);},async run(options={}){currentOptions=options;return evaluateSpectrum(args,{resourcePolicy:policy(),calculationPolicy:defaultStructuredCalculationPolicy(),executionPolicy:authored,execution,...options});}};
}

test('resumable v2 uses the same arithmetic and produces every v1 scalar and exactness flag',async()=>{
 for(const count of [1,4,16,256]){const values=Array.from({length:count},(_,i)=>input((i*73+19)%257-128,undefined,policy(),i===count-1?{version:1,kind:'approximate-inputs'}:null)),old=fixture(values),current=resumableFixture(values,{parseSource:true});await old.run({calculationPolicy:defaultStructuredCalculationPolicy()});const summary=await current.run();assert.deepEqual(current.bins,old.bins);assert.equal(summary.version,2);assert.deepEqual(summary.executionPolicy,executionPolicy());assert.equal(summary.approximateInputs,true);assert.equal(summary.count,count);assert.equal(current.cursor.phase,'complete');assert.equal(current.ledger.reservation,null);assert.ok(current.ledger.consumed.operations>0);const used=current.ledger.consumed,committed=current.commits.length;assert.deepEqual(await current.run(),summary);assert.equal(current.commits.length,committed);assert.deepEqual(current.ledger.consumed,used);}
 const values=[[1,2],[3,-1],[2,1],[0,0],[-1,2],[4,0],[1,-3],[2,1]].map(([real,imaginary])=>input(real,imaginary)),old=fixture(values),current=resumableFixture(values);await old.run({calculationPolicy:defaultStructuredCalculationPolicy()});await current.run();assert.deepEqual(current.bins,old.bins);
});

test('v2 dense 1024 and independent 4096 growth complete within authored job limits with all-bin DFT and Parseval checks',async()=>{
 for(const count of [1024,4096]){
  const samples=Array.from({length:count},(_,i)=>(i*73+19)%257-128),f=resumableFixture(samples.map(value=>input(value))),summary=await f.run();assert.equal(f.bins.length,count);assert.equal(summary.approximate,true);assert.ok(f.ledger.consumed.operations>50000);assert.ok(f.ledger.consumed.operations<=1000000);assert.ok(f.ledger.consumed.activeMilliseconds<=30000);assert.equal(f.commits.length,count/32*(Math.log2(count)+2));let energy=0,maxError=0;
  for(const bin of f.bins){let real=0,imaginary=0;for(let i=0;i<count;i++){const angle=-2*Math.PI*i*bin.index/count;real+=samples[i]*Math.cos(angle);imaginary+=samples[i]*Math.sin(angle);}const a=number(bin.real),b=number(bin.imaginary);maxError=Math.max(maxError,Math.abs(a-real),Math.abs(b-imaginary));assert.ok(Math.abs(a-real)<1e-6);assert.ok(Math.abs(b-imaginary)<1e-6);const squared=number(bin.normalizedSquaredMagnitude);assert.ok(Math.abs(squared-(real*real+imaginary*imaginary)/(count*count))<1e-6);energy+=squared;}
  assert.ok(Math.abs(energy-samples.reduce((sum,value)=>sum+value*value,0)/count)<1e-8);assert.ok(f.commits.every(item=>item.staged<=32));assert.ok(f.batches.every(([,size])=>size<=32));process.stdout.write('# spectrum v2 '+JSON.stringify({count,operations:f.ledger.consumed.operations,activeMilliseconds:f.ledger.consumed.activeMilliseconds,slices:f.commits.length,maxError})+'\n');
 }
});

test('interruption in input, butterfly and output phases resumes only the last committed cursor without replenishing work',async()=>{
 const values=Array.from({length:64},(_,i)=>input((i*73+19)%257-128,undefined,policy(),i===63?{version:1,kind:'approximate-inputs'}:null)),baseline=resumableFixture(values);const expected=await baseline.run();
 for(const interrupted of ['input','transform','output']){
  const f=resumableFixture(values,{fault:before=>interrupted==='input'?before?.phase==='input'&&before.offset===32:interrupted==='transform'?before?.phase==='transform'&&before.length===8&&before.position===2:before?.phase==='output'&&before.offset===32});await assert.rejects(f.run(),error=>error.simulatedCrash===true);const before=f.cursor,spent=f.ledger.consumed,reserved=f.ledger.reservation,outputCount=f.bins.length,reads=f.reads.length;assert.ok(reserved);f.recover();assert.equal(f.ledger.consumed.operations,spent.operations+reserved.operations);assert.equal(f.ledger.consumed.activeMilliseconds,spent.activeMilliseconds+reserved.activeMilliseconds);assert.deepEqual(f.cursor,before);assert.equal(f.bins.length,outputCount);const summary=await f.run();assert.deepEqual(summary,expected);assert.deepEqual(f.bins,baseline.bins);assert.ok(f.ledger.consumed.operations>baseline.ledger.consumed.operations);assert.equal(new Set(f.bins.map(bin=>bin.index)).size,64);if(interrupted!=='input')assert.equal(f.reads.length,reads);else assert.equal(f.reads.length,reads+32);
 }
});

test('v2 whole-job, local slice and source limits refuse rather than restarting allowances',async()=>{
 const dense=Array.from({length:1024},(_,i)=>input((i*73+19)%257-128)),limited=resumableFixture(dense,{execution:executionPolicy(50000,5000)});await assert.rejects(limited.run(),{code:'DATASET_CALCULATION_RESOURCE'});assert.ok(limited.ledger.consumed.operations<=50000);const spent=limited.ledger.consumed.operations;await assert.rejects(limited.run(),{code:'DATASET_CALCULATION_RESOURCE'});assert.ok(limited.ledger.consumed.operations>=spent);assert.equal(limited.cursor.phase,'transform');
 const small=resumableFixture([input(3)],{execution:executionPolicy(100,1)});await assert.rejects(small.run(),{code:'DATASET_CALCULATION_RESOURCE'});assert.equal(small.cursor,null);assert.equal(small.ledger.consumed.operations,1);await assert.rejects(small.run(),{code:'DATASET_CALCULATION_RESOURCE'});assert.equal(small.ledger.consumed.operations,2);
 const restricted=policy({maxBits:64}),source=resumableFixture([input(1n<<70n,undefined,restricted)]);await assert.rejects(source.run(),{code:'DATASET_CALCULATION_RESOURCE'});assert.equal(source.bins.length,0);assert.equal(source.cursor,null);
});

test('v2 cancellation commits no partial batch and resumes with actual-use accounting',async()=>{
 const controller=new AbortController(),reason=Object.assign(Error('Stop selected output'),{code:'TEST_CANCEL'}),values=Array.from({length:64},(_,i)=>input(i+1));let cancelled=false;
 const f=resumableFixture(values,{write:bin=>{if(bin.index===33&&!cancelled){cancelled=true;controller.abort(reason);}}});await assert.rejects(f.run({signal:controller.signal}),error=>error===reason);assert.equal(f.bins.length,32);assert.equal(f.cursor.phase,'output');assert.equal(f.cursor.offset,32);assert.equal(f.ledger.reservation,null);const spent=f.ledger.consumed.operations;await f.run();assert.equal(f.bins.length,64);assert.ok(f.ledger.consumed.operations>spent);assert.equal(new Set(f.bins.map(bin=>bin.index)).size,64);
});

test('v2 cursor admission refuses skipped or malformed batch boundaries and mismatched scope policies',async()=>{
 const flags={version:1,approximate:false,approximateInputs:false};assert.equal(validSpectrumExecutionCursor(null,64),true);for(const cursor of [{...flags,phase:'input',offset:0},{...flags,phase:'input',offset:32},{...flags,phase:'transform',length:8,position:2,start:0},{...flags,phase:'output',offset:32},{...flags,phase:'complete',offset:64}])assert.equal(validSpectrumExecutionCursor(cursor,64),true);
 for(const cursor of [{...flags,phase:'input',offset:1},{...flags,phase:'input',offset:0,approximateInputs:true},{...flags,phase:'transform',length:3,position:0,start:0},{...flags,phase:'transform',length:8,position:1,start:0},{...flags,phase:'output',offset:64},{...flags,phase:'complete',offset:63},{...flags,phase:'input',offset:0,extra:1}])assert.equal(validSpectrumExecutionCursor(cursor,64),false);
 const f=resumableFixture([input(1)]);await assert.rejects(f.run({budget:new DatasetResourceBudget(policy())}),{code:'DATASET_SPECTRUM_INVALID'});const tooLarge=executionPolicy();tooLarge.slice.maxActiveMilliseconds=5000;await assert.rejects(f.run({executionPolicy:tooLarge}),{code:'DATASET_SPECTRUM_INVALID'});await assert.rejects(f.run({execution:{cursor:null,slice:async(_before,callback)=>callback({budget:new NumericalExecutionBudget(reserveNumericalExecution(createNumericalExecutionState('b'.repeat(64),executionPolicy(50000)),{id:randomUUID(),operations:50000,activeMilliseconds:2500})),work:{getMany(){},putMany(){}}})}}),{code:'DATASET_SPECTRUM_INVALID'});
});

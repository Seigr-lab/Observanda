import test from 'node:test';
import assert from 'node:assert/strict';
import {validateQuantileProbability,quantileSelection,interpolateQuantile} from '../src/dataset-quantile.js';
import {PagedMedian} from '../src/paged-median.js';
import {DatasetResourceBudget} from '../src/dataset-resource-budget.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {compareRationalText} from '../src/web/measurement-reduction.js';
const policy=resources=>({...defaultDatasetResourcePolicy(),resources:{...defaultDatasetResourcePolicy().resources,...resources}});
const scalar=(spelling,representation='rational',radix=10)=>({spelling,representation,radix});
const source=ordinal=>({ordinal,member:ordinal*2,page:Math.floor(ordinal/7),row:ordinal%7});
const quantile=(values,p,own=policy())=>{const selection=quantileSelection(values.length,p,own);return selection?interpolateQuantile(values[selection.lower],values[selection.upper],selection,{policy:own}):null;};
function adapter(probabilities,own=policy()){
 return {plan(key,count){const context=quantileSelection(count,probabilities[key],own);return {ranks:[...new Set([context.lower,context.upper])],context};},reduce(key,count,plan,selected){
  const lower=selected[0],upper=selected.at(-1);return {value:interpolateQuantile(lower.value,upper.value,plan.context,{policy:own}),detail:{version:1,method:'linear-n-minus-one-v1',lower:{rank:lower.rank,member:lower.source.member},upper:{rank:upper.rank,member:upper.source.member},weight:plan.context.weight}};
 }};
}
function fixture(options={}){
 const files=new Map(),state=new Map(),writes=[],settings={blockSize:4,pageBytes:512,read:async name=>files.get(name),write:async(name,text)=>{writes.push({name,bytes:Buffer.byteLength(text),rows:JSON.parse(text).length});files.set(name,text);},remove:async names=>names.forEach(name=>files.delete(name)),state:{read:async key=>state.get(key),write:async(key,value)=>state.set(key,value)},compareValues:compareRationalText,...options};
 return {files,state,writes,settings,sorter:new PagedMedian(settings)};
}
test('exact probability retains its declared context and rejects unsupported or out-of-range values even for no observations',()=>{
 for(const p of [scalar('1/2'),scalar('0.5','decimal'),scalar('0.3','radix-fraction',6)]){const before=structuredClone(p);assert.deepEqual(validateQuantileProbability(p,policy()),{numerator:1n,denominator:2n});assert.equal(quantileSelection(0,p,policy()),null);assert.deepEqual(p,before);}
 for(const p of [scalar('-1/100'),scalar('101/100'),scalar('NaN','decimal'),scalar('0.6','radix-fraction',6),scalar('1/2','binary64'),scalar('1/2','rational',6),{...scalar('1/2'),unexpected:true},scalar({format:'dataset-cell'})])assert.throws(()=>quantileSelection(0,p,policy()),{code:'DATASET_AGGREGATION'});
 for(const n of [-1,1.5,Infinity,NaN,Number.MAX_SAFE_INTEGER+1,'2'])assert.throws(()=>quantileSelection(n,scalar('1/2'),policy()),{code:'DATASET_AGGREGATION'});
});
test('linear n-minus-one ranks and interpolation are exact at endpoints, singleton and interior probabilities',()=>{
 const values=['-5/1','1/3','9/1','20/1'];
 assert.equal(quantile(values,scalar('0/1')),'-5/1');assert.equal(quantile(values,scalar('1/1')),'20/1');assert.equal(quantile(values,scalar('1/2')),'14/3');assert.equal(quantile(values,scalar('1/3')),'1/3');assert.equal(quantile(values,scalar('1/4')),'-1/1');
 assert.deepEqual(quantileSelection(1,scalar('3/5'),policy()),{lower:0,upper:0,weight:scalar('0/1')});assert.equal(quantile(['007/3'],scalar('3/5')),'7/3');assert.equal(quantile([],scalar('1/2')),null);
 assert.deepEqual(quantileSelection(Number.MAX_SAFE_INTEGER,scalar('1/2'),policy()),{lower:4503599627370495,upper:4503599627370495,weight:scalar('0/1')});
 for(const selection of [{lower:0,upper:0,weight:scalar('1/2')},{lower:0,upper:1,weight:scalar('0/1')},{lower:0,upper:1,weight:scalar('1/1')},{lower:0,upper:2,weight:scalar('1/2')}])assert.throws(()=>interpolateQuantile('0/1','1/1',selection,{policy:policy()}),{code:'DATASET_AGGREGATION'});
 assert.throws(()=>interpolateQuantile('0/1','1/1',{lower:0,upper:0,weight:scalar('0/1')},{policy:policy()}),{code:'DATASET_AGGREGATION'});
});
test('probability, exact rank arithmetic, interpolation and receipt spelling obey owner and caller limits',()=>{
 assert.throws(()=>quantileSelection(0,scalar('0'.repeat(17)+'1/2'),policy({maxScalarCharacters:16})),{code:'DATASET_CALCULATION_RESOURCE'});
 assert.throws(()=>quantileSelection(1,scalar('1e-100','decimal'),policy({maxExponent:10})),{code:'DATASET_CALCULATION_RESOURCE'});
 assert.throws(()=>quantileSelection(3,scalar('1/2'),policy({maxOperations:1})),{code:'DATASET_CALCULATION_RESOURCE'});
 assert.throws(()=>quantileSelection(2,scalar('1e-15','decimal'),policy({maxScalarCharacters:16})),{code:'DATASET_CALCULATION_RESOURCE'});
 const expired=new DatasetResourceBudget(policy());expired.remaining=-1;assert.throws(()=>quantileSelection(3,scalar('1/2'),policy(),{budget:expired}),{code:'DATASET_CALCULATION_RESOURCE'});
 assert.throws(()=>quantileSelection(3,scalar('1/2'),policy(),{budget:new DatasetResourceBudget(policy({maxOperations:1}))}),{code:'DATASET_CALCULATION_RESOURCE'});
 assert.throws(()=>interpolateQuantile((1n<<70n)+'/1','1/1',{lower:0,upper:1,weight:scalar('1/2')},{policy:policy({maxBits:64})}),{code:'DATASET_CALCULATION_RESOURCE'});
 assert.throws(()=>quantileSelection(Number.MAX_SAFE_INTEGER,scalar('4611686018427387905/9223372036854775807'),policy({maxBits:64})),{code:'DATASET_CALCULATION_RESOURCE'});
});
test('long exact probability produces a long exact retained weight without rounding',()=>{
 const own=policy({maxScalarCharacters:20000,maxOperations:200000}),p=scalar('1/'+'1'+'0'.repeat(9000)+'1'),selection=quantileSelection(2,p,own);
 assert.equal(selection.weight.spelling,p.spelling);assert.equal(interpolateQuantile('0/1','1/1',selection,{policy:own}),p.spelling);
 assert.throws(()=>quantileSelection(0,p,policy()),{code:'DATASET_CALCULATION_RESOURCE'});
});
test('rank selection preserves exact values and source ordinal ties across merged pages and resumed checkpoints',async()=>{
 const probabilities=[scalar('1/2'),scalar('1/4')],f=fixture({selection:adapter(probabilities)}),expected=[[],[]];
 for(let i=0;i<31;i++){const group=i%2,ordinal=30-i,value=(i%5)+'/3',item={value,source:source(ordinal)};expected[group].push(item);f.sorter.add(group,value,item.source);await f.sorter.flush();if(i===12){await f.sorter.flush(true);const checkpoint=f.sorter.checkpoint();assert.equal(checkpoint.version,2);assert.equal(checkpoint.mode,'rank-selection');f.sorter=new PagedMedian(f.settings);f.sorter.restore(checkpoint);}}
 assert.throws(()=>f.sorter.value(0),{code:'MATERIAL_MISSING'});await f.sorter.finish();
 for(let group=0;group<2;group++){const items=expected[group].sort((a,b)=>compareRationalText(a.value,b.value)||a.source.ordinal-b.source.ordinal),selection=quantileSelection(items.length,probabilities[group],policy());assert.equal(await f.sorter.value(group),quantile(items.map(item=>item.value),probabilities[group]));assert.deepEqual(await f.sorter.detail(group),{version:1,method:'linear-n-minus-one-v1',lower:{rank:selection.lower,member:items[selection.lower].source.member},upper:{rank:selection.upper,member:items[selection.upper].source.member},weight:selection.weight});}
 assert.equal(f.sorter.counts.size,0);assert.equal(f.sorter.medians.size,0);assert.equal(f.sorter.details.size,0);assert.ok(f.writes.every(page=>page.rows<=4&&page.bytes<=512));
 const checkpoint=f.sorter.checkpoint();assert.throws(()=>new PagedMedian({...f.settings,selection:null}).restore(checkpoint),{code:'MATERIAL_MISSING'});assert.throws(()=>new PagedMedian(f.settings).restore({...checkpoint,version:1}),{code:'MATERIAL_MISSING'});assert.throws(()=>new PagedMedian(f.settings).restore({...checkpoint,mode:'other'}),{code:'MATERIAL_MISSING'});
});
test('a completed selection checkpoint reauthenticates its run before restoring access to receipts',async()=>{
 const f=fixture({selection:adapter([scalar('1/2')])});for(let i=0;i<9;i++){f.sorter.add(0,i+'/1',source(i));await f.sorter.flush();}await f.sorter.finish();const expected=await f.sorter.detail(0),checkpoint=f.sorter.checkpoint();
 const resumed=new PagedMedian(f.settings);resumed.restore(checkpoint);assert.throws(()=>resumed.value(0),{code:'MATERIAL_MISSING'});assert.throws(()=>resumed.detail(0),{code:'MATERIAL_MISSING'});await resumed.finish();assert.equal(await resumed.value(0),'4/1');assert.deepEqual(await resumed.detail(0),expected);
 const altered=new PagedMedian(f.settings);altered.restore(resumed.checkpoint());const run=altered.levels[0],name=run.id+'-'+(run.pages-1)+'.json',rows=JSON.parse(f.files.get(name));rows.at(-1)[2].member++;f.files.set(name,JSON.stringify(rows));await assert.rejects(altered.finish(),{code:'MATERIAL_MISSING'});assert.throws(()=>altered.value(0),{code:'MATERIAL_MISSING'});
});
test('selection consumes and authenticates the final page even when probability selects the first value',async()=>{
 const f=fixture({selection:adapter([scalar('0/1')])});for(let i=0;i<8;i++){f.sorter.add(0,i+'/1',source(i));await f.sorter.flush();}await f.sorter.flush(true);
 const run=f.sorter.levels.find(Boolean),last=run.id+'-'+(run.pages-1)+'.json',rows=JSON.parse(f.files.get(last));rows.at(-1)[1]='999/1';f.files.set(last,JSON.stringify(rows));
 await assert.rejects(f.sorter.finish(),{code:'MATERIAL_MISSING'});assert.throws(()=>f.sorter.value(0),{code:'MATERIAL_MISSING'});assert.throws(()=>f.sorter.detail(0),{code:'MATERIAL_MISSING'});
});
test('selection checks observed group counts and refuses invalid rank plans and ambiguous source ties',async()=>{
 for(const changed of [3,5]){const f=fixture({selection:adapter([scalar('1/2')])});for(let i=0;i<4;i++)f.sorter.add(0,i+'/1',source(i));await f.sorter.flush(true);f.state.set('count:0',changed);await assert.rejects(f.sorter.finish(),{code:'MATERIAL_MISSING'});}
 for(const ranks of [[],[1,0],[0,0],[0,1,2],[-1],[4],[0.5]]){const f=fixture({selection:{plan:()=>({ranks}),reduce:()=>({value:'0/1',detail:null})}});for(let i=0;i<4;i++)f.sorter.add(0,i+'/1',source(i));await assert.rejects(f.sorter.finish(),{code:'INVALID'});}
 const f=fixture({selection:adapter([scalar('1/2')])});f.sorter.add(0,'1/1',source(0));f.sorter.add(0,'1/1',source(0));await assert.rejects(f.sorter.finish(),{code:'MATERIAL_MISSING'});
 for(const bad of [{...source(0),ordinal:-1},{...source(0),row:1.5},{member:0,ordinal:0},null])assert.throws(()=>f.sorter.add(0,'1/1',bad),{code:'INVALID'});
});
test('selection hooks recheck access and cancellation after storage, leaving results unavailable',async()=>{
 const controller=new AbortController(),f=fixture({selection:adapter([scalar('1/2')]),signal:controller.signal});f.sorter.add(0,'1/1',source(0));await f.sorter.flush(true);
 const original=f.sorter.read;f.sorter.read=async name=>{const value=await original(name);controller.abort();return value;};await assert.rejects(f.sorter.finish(),{name:'AbortError'});assert.throws(()=>f.sorter.value(0),{code:'MATERIAL_MISSING'});
 let checks=0;const denied=fixture({selection:adapter([scalar('1/2')]),check:async()=>{if(++checks===3)throw Object.assign(Error('withdrawn'),{code:'ACCESS_DENIED'});}});denied.sorter.add(0,'1/1',source(0));await assert.rejects(denied.sorter.finish(),{code:'ACCESS_DENIED'});assert.equal(checks,3);
});
test('selection page bytes bound long canonical values independently of record count',async()=>{
 const own=policy({maxScalarCharacters:12000,maxOperations:200000}),denominator=10n**2000n,low=(denominator-1n)+'/'+denominator,high=(denominator+1n)+'/'+denominator,f=fixture({blockSize:128,pageBytes:32768,selection:adapter([scalar('1/2')],own)});
 for(let i=0;i<32;i++){f.sorter.add(0,i%2?low:high,source(i));await f.sorter.flush();}await f.sorter.finish();assert.equal(await f.sorter.value(0),'1/1');assert.ok(f.writes.every(page=>page.bytes<=32768));assert.ok(f.sorter.peakBuffer<10);
});
test('in-memory selection and no observations keep detail lookup explicit',async()=>{
 const f=fixture({state:null,selection:adapter([scalar('2/3')])});await f.sorter.finish();assert.throws(()=>f.sorter.value(0),{code:'MATERIAL_MISSING'});f.sorter.add(0,'7/3',source(10));await f.sorter.finish();assert.equal(f.sorter.value(0),'7/3');assert.deepEqual(f.sorter.detail(0),{version:1,method:'linear-n-minus-one-v1',lower:{rank:0,member:20},upper:{rank:0,member:20},weight:scalar('0/1')});
});

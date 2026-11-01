import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatasetWindowReader} from '../src/dataset-window-reader.js';
import {calculateWindow,graphWindowCell} from '../src/dataset-window-operations.js';
import {DatasetResourceBudget} from '../src/dataset-resource-budget.js';
import {defaultWindow} from '../src/web/dataset-window-model.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {OperationalDiagnostics,withDiagnostics,diagnostic} from '../src/operational-diagnostics.js';

const policy=()=>{const value=defaultDatasetResourcePolicy();value.resources.maxMilliseconds=30000;return value;};
const column={...defaultColumn({label:'Observed'}),representation:'rational',missing:[{value:'NA',meaning:'Missing'}]};
const node=(width=128,options={})=>({operation:'count',column:0,window:{...defaultWindow(),start:0,end:width-1,boundary:'partial',...options}});
function fixture(count,{legacy=false}={}){
 const source={kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},binding={source},rows=Array.from({length:count},(_,i)=>({id:'row'+i,excluded:null,cells:[String(i)+'/1'],valueKinds:['string'],cellComputations:[null]})),pageSize=legacy?17:64,doc={content:{datasetFormat:legacy?2:3,rowCount:count}};let admitted=0,denied=false,pages=0;
 const materials={read:async()=>{admitted++;if(denied)throw Object.assign(Error('Locked'),{code:'ACCESS_LOCKED'});return doc;},datasetPageCount:()=>Math.ceil(count/pageSize),retainedDatasetPage:async(_,index)=>{pages++;return {rows:rows.slice(index*pageSize,(index+1)*pageSize)};}};
 return {rows,binding,materials,reader:new DatasetWindowReader(materials),location:index=>({kind:'dataset',page:Math.floor(index/pageSize),row:index%pageSize,id:rows[index].id,excluded:rows[index].excluded}),stats:()=>({admitted,pages}),deny:()=>denied=true};
}
async function evaluate(f,n,position=0,settings={}){return graphWindowCell(f.materials,n,f.binding,f.location(position),settings.column??column,settings.policy??policy(),{windowReader:f.reader,...settings});}
for(const legacy of [false,true])test('count summaries preserve exact windows, partial boundaries and per-cell computation across '+(legacy?'variable':'fixed')+' pages',async()=>{
 const f=fixture(259,{legacy}),tracked={...column,computation:{version:2,kind:'per-cell'}};f.rows[5].cells[0]='NA';f.rows[73].excluded='Reviewed';f.rows[90].cellComputations[0]={version:1,kind:'approximate-inputs'};
 for(const n of [node(128,{missing:'skip',excluded:'skip'}),node(128,{missing:'propagate',excluded:'include'}),node(128,{missing:'skip',start:-63,end:64})])for(const position of [0,64,130,258]){
  const reader=await f.reader.open(n,f.binding,f.location(position)),interpreted=await calculateWindow(n,tracked,{...reader,countSummaries:null},policy(),{cellComputation:true}),summarized=await evaluate(f,n,position,{column:tracked,cellComputation:true});assert.deepEqual(summarized,interpreted);
 }
 assert.deepEqual(await evaluate(f,node(128,{missing:'skip',excluded:'skip'}),0,{column:tracked,cellComputation:true}),{value:'126',kind:'string',computation:{version:1,kind:'approximate-inputs'}});
 f.deny();await assert.rejects(evaluate(f,node()),{code:'ACCESS_LOCKED'});
});
test('reused summaries preserve malformed-member and logical budget refusal precedence',async()=>{
 for(const index of [0,5,63,64,127])for(const invalid of ['computation','alignment','missing']){
  const f=fixture(128),tracked={...column,computation:{version:2,kind:'per-cell'}};
  if(invalid==='computation')f.rows[index].cellComputations[0]={invalid:true};else if(invalid==='alignment')f.rows[index].cellCoordinateAlignments=[{invalid:true}];else f.rows[index].cells[0]='NA';
  const n=node(128,{missing:'error'}),expected=invalid==='computation'?'DATASET_CELL_COMPUTATION':invalid==='alignment'?'MATERIAL_MISSING':'DATASET_WINDOW_VALUE';
  for(const limit of [1000,2*(index+1)-1,2*(index+1)]){const p=policy();p.resources.maxOperations=limit;await assert.rejects(evaluate(f,n,0,{column:tracked,cellComputation:true,alignment:true,policy:p}),{code:limit<2*(index+1)?'DATASET_CALCULATION_RESOURCE':expected});}
 }
});
test('propagation never suppresses a later invalid cell and schema/policy keys do not mix summaries',async()=>{
 const f=fixture(128);f.rows[0].cells[0]='NA';f.rows[127].cellComputations[0]={invalid:true};
 assert.deepEqual(await evaluate(f,node()),{value:'',kind:'absent'});
 await assert.rejects(evaluate(f,node(),0,{cellComputation:true}),{code:'DATASET_CELL_COMPUTATION'});
 const valid=fixture(128);valid.rows[0].cells[0]='NA';assert.equal((await evaluate(valid,node(128,{missing:'skip'}))).value,'127');assert.equal((await evaluate(valid,node())).kind,'absent');assert.equal((await evaluate(valid,node(),0,{column:{...column,missing:[]}})).value,'128');
});
test('count summary logical charges retain both visit steps at exact policy boundaries',async()=>{
 for(const width of [63,64,65,128,192])for(const delta of [-1,0]){const f=fixture(256),p=policy();p.resources.maxOperations=width*2+delta;if(delta<0)await assert.rejects(evaluate(f,node(width),0,{policy:p}),{code:'DATASET_CALCULATION_RESOURCE'});else assert.equal((await evaluate(f,node(width),0,{policy:p})).value,String(width));}
 const budget=new DatasetResourceBudget(policy());budget.run(()=>budget.chargeSteps(127));assert.equal(budget.operations,128);assert.throws(()=>budget.chargeSteps(0),RangeError);
});
test('overlapping windows reuse bounded summaries while reauthorizing every output',async t=>{
 const f=fixture(4096),recorder=new OperationalDiagnostics(),n=node(1024),start=performance.now();
 await withDiagnostics(recorder,async()=>{for(let position=0;position<3073;position++)assert.equal((await evaluate(f,n,position)).value,'1024');diagnostic('request');});
 const counters=recorder.recent.find(value=>value.event==='request');assert.equal(counters.windowCountSummaryMembers,4096);assert.equal(f.stats().admitted,3073);assert.ok(f.reader.countSummaries.pages.size<=128);assert.ok(f.reader.countSummaries.pages.bytes<=256*1024);t.diagnostic(JSON.stringify({outputs:3073,width:1024,summaryMembers:counters.windowCountSummaryMembers,elapsedMs:Math.round(performance.now()-start),...f.stats()}));
});
test('one evaluation scheduler lets a timer cancel consecutive cached single-member windows',async()=>{
 const f=fixture(20000),controller=new AbortController();let completed=0;const timer=setTimeout(()=>controller.abort(),25);
 try{await assert.rejects((async()=>{for(let position=0;position<20000;position++){await evaluate(f,node(1),position,{signal:controller.signal});completed++;}})(),{name:'AbortError'});assert.ok(completed<20000);}finally{clearTimeout(timer);}
});

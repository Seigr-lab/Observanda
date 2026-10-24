import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatasetAggregation,inspectAggregation,verifyAggregationPolicy} from '../src/dataset-aggregation.js';
import {validateAggregationReceipts} from '../src/dataset-aggregation-quantiles.js';
import {MaterialSequence} from '../src/material-sequence.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {defaultStructuredCalculationPolicy} from '../src/web/tools/calculation-policy.js';
import {blankUnitDefinition} from '../src/web/measurement-unit-model.js';
import {validAggregation} from '../src/web/dataset-aggregation-model.js';
const source={kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},recordId=randomUUID();
const policy=()=>{const value=defaultDatasetResourcePolicy();Object.assign(value.resources,{maxScalarCharacters:65536,maxOperations:1000000,maxMilliseconds:30000});return value;};
const scalar=spelling=>({spelling,representation:'rational',radix:10});
const correlation=()=>({column:1,pairedColumn:2,operation:'correlation',method:'pearson-centered-pairs-v1',pairing:'complete-rows-v1',calculationPolicy:{...defaultStructuredCalculationPolicy(),workingDigits:32,displayDigits:4},name:'Pearson'});
const recipe=()=>({version:6,source,keys:[0],values:[correlation()],missing:'skip',note:'Explicit complete same-row Pearson pairs.',resourcePolicy:policy()});
const perCell={version:2,kind:'per-cell'},approximateInputs={version:1,kind:'approximate-inputs'};
function memory(){const values=new Map();return {values,saved:null,get:async key=>structuredClone(values.get(key)),put:async(key,value)=>values.set(key,structuredClone(value)),removeMany:async keys=>keys.forEach(key=>values.delete(key)),save:async function(value){this.saved=structuredClone(value);}};}
function fixture(rows){const data=new Map(),workspace={readMetadata:async key=>data.get(key)??null,writeMetadata:async(key,text)=>data.set(key,text)},columns=[defaultColumn({label:'Group'}),...['X','Y'].map(label=>({...defaultColumn({label}),representation:'integer'}))],doc={kind:'dataset',content:{columns,rowCount:rows.length}},materials={workspace,sequences:new MaterialSequence(workspace),assertOwner:async()=>{},read:async()=>doc,datasetColumn:async(doc,index)=>doc.content.columns[index],datasetPageCount:()=>1,retainedDatasetPage:async(doc,page,{columns:indices})=>({rows:(doc.rows??rows).map(row=>({...row,cells:indices.map(i=>row.cells[i]),valueKinds:indices.map(i=>row.valueKinds?.[i]??'string'),...(row.cellComputations?{cellComputations:indices.map(i=>row.cellComputations[i])}:{}),columnIndices:indices}))}),references:async function*(){yield source;}};return {materials,columns,doc,rows,engine:new DatasetAggregation(materials)};}
async function collect(f,a,{work=memory(),...options}={}){const schema=await f.engine.schema(a),result=[];for await(const row of f.engine.rows({aggregation:a},schema,{work,...options}))result.push(row);return {schema,header:result[0],rows:result.slice(1),work};}
const members=f=>async rows=>{const builder=f.materials.sequences.builder('aggregation-members',fn=>fn());for await(const row of rows)await builder.append(row);return builder.finish();};
const input=(group,pairs)=>pairs.map(([x,y])=>({cells:[group,String(x),String(y)]}));

test('recipe6 mixes exact and rounded Pearson cells, old paired statistics and quantiles in one centered state',async t=>{
 const f=fixture([...input('exact',[[1,3],[2,5],[3,7]]),...input('rounded',[[1,1],[2,2],[3,4]]),...input('negative',[[1,7],[2,5],[3,3]])]),a=recipe();a.values.push({column:1,pairedColumn:2,operation:'covariance',method:'centered-pairs-v1',pairing:'complete-rows-v1',normalization:'sample',name:'Covariance'},{column:1,pairedColumn:2,operation:'linear-fit',method:'ordinary-least-squares-intercept-v1',pairing:'complete-rows-v1',coefficient:'slope',name:'Slope'},{column:1,operation:'quantile',name:'Median',method:'linear-n-minus-one-v1',probability:scalar('1/2')});
 const result=await collect(f,a,{retainMembers:members(f)});assert.deepEqual(result.schema.columns[1].computation,perCell);assert.equal(result.schema.columns[1].unit,'');assert.deepEqual(result.rows[0].cells,['exact','1/1','2/1','2/1','2/1']);assert.deepEqual(result.rows[2].cells,['negative','-1/1','-2/1','-2/1','2/1']);
 assert.equal(result.rows[0].cellComputations[1],null);assert.equal(result.rows[2].cellComputations[1],null);assert.deepEqual(result.rows[1].cellComputations[1],{version:2,kind:'approximate',method:correlation().method,engine:4,policy:correlation().calculationPolicy});
 const receipt=result.rows[1].aggregation[0].pairedStatistic;assert.equal(receipt.evaluation.approximate,true);assert.ok(receipt.evaluation.computation.spelling.startsWith('0.9819805060619657'));assert.ok(receipt.evaluation.computation.spelling.length>correlation().calculationPolicy.displayDigits);assert.equal(result.rows[0].aggregation[0].pairedStatistic.evaluation.computation,null);
 const bounded=structuredClone(a),oversize=structuredClone(result.rows[1]);bounded.values[0].calculationPolicy.resources.maxResultCharacters=32;oversize.aggregation[0].pairedStatistic.evaluation.policy=structuredClone(bounded.values[0].calculationPolicy);assert.throws(()=>validateAggregationReceipts(bounded,oversize),{code:'MATERIAL_MISSING'});
 const state=(await result.work.get('group:1')).pairs;assert.deepEqual(Object.keys(state),['1:2']);assert.equal(state['1:2'].version,2);assert.equal(state['1:2'].Cyy,'14/3');
 const doc={kind:'dataset',content:{aggregation:a,aggregationMembersIndex:result.header.aggregationMembersIndex}},detail=await inspectAggregation(f.materials,{doc,row:result.rows[1]},{kind:'cell',page:0,row:1,column:1});assert.deepEqual(detail.calculationPolicy,correlation().calculationPolicy);assert.equal(detail.members[0].computation,null);assert.equal(detail.members[0].pairedComputation,null);assert.equal(detail.members[0].source.selector.row,3);assert.equal(detail.members[0].pairedSource.selector.column,2);
 const original=f.engine.rows;t.mock.method(f.engine,'rows',function(command,schema,options){return original.call(this,command,schema,{...options,work:memory()});});
 const preview=await f.engine.preview({recordId,title:'Preview',aggregation:a});assert.deepEqual(preview.formats[1].computation,perCell);assert.equal(preview.rows[0].cellComputations[1],null);assert.equal(preview.rows[1].cellComputations[1].kind,'approximate');
});

test('every absence status and pair missing/exclusion precedence carries explicit exact null, never a fabricated zero',async()=>{
 const f=fixture([...input('single',[[4,9]]),...input('x',[[2,4],[2,8]]),...input('y',[[2,4],[3,4]]),...input('both',[[2,4],[2,4]]),{cells:['empty','','9']},{cells:['empty','999',''],excluded:'Rejected pair'}]),a=recipe(),result=await collect(f,a);
 assert.deepEqual(result.rows.map(row=>row.aggregation[0].pairedStatistic.status),['insufficient-pairs','zero-x-spread','zero-y-spread','zero-both-spread','no-pairs']);for(const row of result.rows){assert.equal(row.cells[1],'');assert.equal(row.valueKinds[1],'absent');assert.equal(row.cellComputations[1],null);assert.equal(row.aggregation[0].pairedStatistic.evaluation,null);validateAggregationReceipts(a,row);}
 assert.deepEqual(result.rows.at(-1).aggregation[0],{included:0,excluded:1,missing:1,total:2,pairedStatistic:{version:2,method:correlation().method,pairing:'complete-rows-v1',status:'no-pairs',evaluation:null}});await assert.rejects(collect(f,{...a,missing:'error'}),{code:'DATASET_AGGREGATION_MISSING'});
 const damaged=structuredClone(result.rows[0]);damaged.aggregation[0].pairedStatistic.evaluation={engine:4,policy:correlation().calculationPolicy,approximate:false,computation:null};assert.throws(()=>validateAggregationReceipts(a,damaged),{code:'MATERIAL_MISSING'});
});

test('actual per-cell inputs propagate through pairing and reductions while historical recipes refuse the capability',async()=>{
 const rows=[...input('exact',[[1,3],[2,5],[3,7]]),...input('approx',[[1,3],[2,5],[3,7]])];for(const row of rows)row.cellComputations=[undefined,row.cells[0]==='approx'?approximateInputs:null,undefined];const f=fixture(rows),a=recipe();f.columns[1].computation=perCell;a.values.push({column:1,operation:'mean',name:'Mean'});
 const result=await collect(f,a,{retainMembers:members(f)});assert.deepEqual(result.schema.columns[2].computation,perCell);assert.deepEqual(result.rows[0].cellComputations.slice(1),[null,null]);assert.deepEqual(result.rows[1].cellComputations.slice(1),[approximateInputs,approximateInputs]);assert.equal(result.rows[1].aggregation[0].pairedStatistic.evaluation.approximate,false);
 const doc={kind:'dataset',content:{aggregation:a,aggregationMembersIndex:result.header.aggregationMembersIndex}},detail=await inspectAggregation(f.materials,{doc,row:result.rows[1]},{kind:'cell',page:0,row:1,column:1});assert.deepEqual(detail.members[0].computation,approximateInputs);assert.equal(detail.members[0].pairedComputation,null);
 for(const version of [1,2,3,4,5]){const old={...a,version,values:[{column:1,operation:'count',name:'Count'}]};if(version<3)delete old.resourcePolicy;await assert.rejects(f.engine.schema(old),{code:'DATASET_CELL_COMPUTATION'});assert.equal(validAggregation({...old,values:[correlation()]}),false);}
 delete rows[0].cellComputations;await assert.rejects(collect(f,a),{code:'DATASET_CELL_COMPUTATION'});
});

test('checkpoint128 resumes Cyy and actual-input metadata; count, PSD and missing computation tamper refuse',async()=>{
 const f=fixture(input('bulk',Array.from({length:129},(_,i)=>[i,2*i+1]))),a=recipe(),work=memory(),controller=new AbortController();await assert.rejects(collect(f,a,{work,signal:controller.signal,progress:async p=>{if(p.done===128)controller.abort();}}),{name:'AbortError'});assert.equal(work.saved.order,128);assert.equal((await work.get('group:0')).pairs['1:2'].n,128);
 const result=await collect(f,a,{work});assert.equal(result.rows[0].cells[1],'1/1');assert.equal(result.rows[0].cellComputations[1],null);const original=await work.get('group:0');
 for(const change of [group=>group.pairs['1:2'].n--,group=>group.pairs['1:2'].Cyy='0/1',group=>delete group.keyApproximateInputs,group=>delete group.cellComputations]){const bad=structuredClone(original);change(bad);await work.put('group:0',bad);await assert.rejects(collect(f,a,{work}),{code:'MATERIAL_MISSING'});}await work.put('group:0',original);
});

test('source-coordinate unit differences cancel and complete replay binds actual computation and receipt',async t=>{
 const f=fixture(input('a',[[1,1],[2,2],[3,4]])),a=recipe();for(const [i,axis]of [[1,'time'],[2,'length']]){f.columns[i].unit=axis;f.columns[i].quantity={origin:'measured',conversion:null,calibration:null,unitDefinition:{...blankUnitDefinition(),version:2,kind:'absolute',resourcePolicy:policy(),dimensions:[{axis,exponent:1}],scale:scalar(i+'/1'),offset:scalar((i*100)+'/1')}};}
 const result=await collect(f,a,{retainMembers:members(f)});assert.deepEqual(result.schema.columns[1].quantity.unitDefinition.dimensions,[]);assert.equal(result.schema.columns[1].quantity.unitDefinition.scale.spelling,'1/1');assert.equal(result.schema.columns[1].quantity.unitDefinition.offset.spelling,'0');
 const original=DatasetAggregation.prototype.rows;t.mock.method(DatasetAggregation.prototype,'rows',function(command,schema,options){return original.call(this,command,schema,{...options,work:memory()});});
 const doc={kind:'dataset',content:{columns:result.schema.columns,rowCount:1,aggregation:a,algorithm:'observanda-retained-aggregation',algorithmVersion:4,aggregationMembersIndex:result.header.aggregationMembersIndex},rows:result.rows};await verifyAggregationPolicy(f.materials,doc);const computation=doc.rows[0].cellComputations[1];doc.rows[0].cellComputations[1]=null;await assert.rejects(verifyAggregationPolicy(f.materials,doc),{code:'MATERIAL_MISSING'});doc.rows[0].cellComputations[1]=computation;
 const receipt=doc.rows[0].aggregation[0].pairedStatistic;receipt.evaluation.policy.workingDigits--;await assert.rejects(verifyAggregationPolicy(f.materials,doc),{code:'MATERIAL_MISSING'});
});

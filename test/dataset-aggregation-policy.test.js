import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatasetAggregation,aggregationSourceKey} from '../src/dataset-aggregation.js';
import {validAggregation} from '../src/web/dataset-aggregation-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {MaterialSequence} from '../src/material-sequence.js';
import {retainDatasetCell} from '../src/dataset-cell-storage.js';
const policy=()=>{const p=defaultDatasetResourcePolicy();Object.assign(p.resources,{maxScalarCharacters:12000,maxOperations:200000,maxExponent:12000});return p;};
const column=(name,representation='integer',resourcePolicy)=>({...defaultColumn({label:name}),representation,...(resourcePolicy?{resourcePolicy}:{})});
const ref={kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},recipe=(resourcePolicy=policy())=>({version:3,resourcePolicy,source:ref,keys:[0],keySemantics:['numeric'],values:['sum','mean','median','min','max','count'].map(operation=>({column:1,operation,name:operation})),missing:'skip',note:'Exact original observations.'});
const memory=()=>{const values=new Map();return {get:async key=>structuredClone(values.get(key)),put:async(key,value)=>values.set(key,structuredClone(value)),removeMany:async keys=>keys.forEach(key=>values.delete(key))};};
function fixture(columns,rows){const data=new Map(),workspace={readMetadata:async key=>data.get(key)??null,writeMetadata:async(key,text)=>data.set(key,text)},doc={kind:'dataset',content:{columns,rowCount:rows.length}};
 const materials={workspace,sequences:new MaterialSequence(workspace),assertOwner:async()=>{},read:async()=>doc,datasetColumn:async(doc,index)=>columns[index],datasetPageCount:()=>1,retainedDatasetPage:async(doc,page,{columns:indices})=>({rows:rows.map(row=>({...row,cells:indices.map(i=>row.cells[i]),valueKinds:indices.map(i=>row.valueKinds?.[i]??'string'),columnIndices:indices}))})};return {materials,engine:new DatasetAggregation(materials)};}
async function all(engine,a){const schema=await engine.schema(a),result=[];for await(const row of engine.rows({aggregation:a},schema,{work:memory()}))if(!row.columns)result.push(row);return result;}
test('aggregation v3 groups equivalent exact keys while adjacent integers and source spellings stay distinct',async()=>{
 const p=policy(),a=recipe(p),rows=[['1/3','9007199254740993'],['2/6','9007199254740994'],['9007199254740993/1','3'],['9007199254740994/1','4']].map(cells=>({cells})),original=structuredClone(rows),f=fixture([column('Key','rational',p),column('Value','integer',p)],rows);
 assert.equal(validAggregation(a),true);assert.equal(validAggregation({...a,version:2}),false);assert.ok(!validAggregation({...a,resourcePolicy:undefined}));
 const output=await all(f.engine,a);assert.equal(output.length,3);assert.deepEqual(output[0].cells,['1/3','18014398509481987/1','18014398509481987/2','18014398509481987/2','9007199254740993/1','9007199254740994/1','2']);assert.notEqual(output[1].locator.key,output[2].locator.key);assert.deepEqual(rows,original);
 assert.ok(output.every(row=>row.locator.key.length===71));assert.deepEqual(output[0].aggregation[0],{included:2,excluded:0,missing:0,total:2});
 const columns=[column('Key','rational',p)];assert.equal(await aggregationSourceKey(f.materials,{cells:['1/3']},columns,a),await aggregationSourceKey(f.materials,{cells:['2/6']},columns,a));
});
test('selected long scalars obey both saved source and consumer policies and count/lexical operations retain complete cells',async()=>{
 const owner=policy(),a=recipe(),f=fixture([column('Key','text'),column('Value','integer',owner)],[]),long='0'.repeat(9000)+'1',cell=(await retainDatasetCell(f.materials,{kind:'string',value:long},fn=>fn())).value;
 const rows=[{cells:[cell,cell]},{cells:[cell,cell]}],columns=[column('Key','text'),column('Value','integer',owner)],selected=fixture(columns,rows);selected.materials.sequences=f.materials.sequences;
 const count={...a,keys:[0],keySemantics:['lexical'],values:[{column:1,operation:'count',name:'Count'}]};
 for(const version of [1,2,3]){const command={...count,version};if(version<3)delete command.resourcePolicy;const output=await all(selected.engine,command);assert.equal(output.length,1);assert.deepEqual(output[0].cells,[cell,'2']);}
 const numeric={...count,keySemantics:['lexical'],values:[{column:1,operation:'sum',name:'Sum'}]},small=structuredClone(owner);small.resources.maxScalarCharacters=8192;
 await assert.rejects(all(selected.engine,{...numeric,resourcePolicy:small}),{code:'DATASET_CALCULATION_RESOURCE'});assert.equal((await all(selected.engine,numeric))[0].cells[1],'2/1');
 for(const version of [1,2]){const legacy={...numeric,version};delete legacy.resourcePolicy;await assert.rejects(selected.engine.schema(legacy),{code:'DATASET_SCALAR_POLICY_VERSION'});}
 columns[1].resourcePolicy=small;await assert.rejects(all(selected.engine,numeric),{code:'DATASET_CALCULATION_RESOURCE'});
 const controller=new AbortController();controller.abort();await assert.rejects(aggregationSourceKey(selected.materials,{cells:['1']},[column('Key','integer',owner)],a,{signal:controller.signal}),{name:'AbortError'});
});
test('aggregation reducer intermediates, median comparisons and output obey the saved bit and spelling bounds',async()=>{
 const small=policy();small.resources.maxBits=64;const a=recipe(small),f=fixture([column('Key'),column('Value')],[{cells:['1',String(1n<<63n)]},{cells:['1',String(1n<<63n)]}]);
 await assert.rejects(all(f.engine,{...a,values:[{column:1,operation:'sum',name:'Sum'}]}),{code:'DATASET_CALCULATION_RESOURCE'});
 const outputPolicy=policy();outputPolicy.resources.maxScalarCharacters=16;const large=fixture([column('Key'),column('Value','decimal')],[{cells:['1','1e30']}]);await assert.rejects(all(large.engine,{...recipe(outputPolicy),values:[{column:1,operation:'sum',name:'Sum'}]}),{code:'DATASET_CALCULATION_RESOURCE'});
 const cancellation=fixture([column('Key'),column('Value')],[{cells:['1','1']}]),controller=new AbortController(),schema=await cancellation.engine.schema(a),iterator=cancellation.engine.rows({aggregation:a},schema,{work:memory(),signal:controller.signal});controller.abort();await assert.rejects(iterator.next(),{name:'AbortError'});
});

test('policy aggregation retains exact declared output units and refuses summing absolute quantities',async()=>{
 const {blankUnitDefinition}=await import('../src/web/measurement-unit-model.js'),{retainScalarDefinitions}=await import('../src/measurement-scalar-storage.js'),p=policy(),definition={...blankUnitDefinition(),version:2,resourcePolicy:p,scale:{spelling:'0'.repeat(9000)+'1',representation:'integer',radix:10}},value=column('Reading','integer',p),f=fixture([column('Key'),value],[{cells:['1','2']}]);
 value.quantity={...value.quantity,unitDefinition:await retainScalarDefinitions(f.materials,definition,fn=>fn())};const a=recipe(p),schema=await f.engine.schema(a);
 assert.deepEqual(schema.columns[1].quantity.unitDefinition,value.quantity.unitDefinition);assert.deepEqual(schema.columns[1].resourcePolicy,p);assert.equal(schema.columns.at(-1).quantity.unitDefinition,undefined);assert.equal(schema.columns.at(-1).unit,'');
 const small=structuredClone(p);small.resources.maxScalarCharacters=8192;await assert.rejects(f.engine.schema({...a,resourcePolicy:small}),{code:'DATASET_CALCULATION_RESOURCE'});
 value.quantity.unitDefinition.kind='absolute';value.quantity.unitDefinition.offset={spelling:'273.15',representation:'decimal',radix:10};await assert.rejects(f.engine.schema(a),{code:'DATASET_AGGREGATION'});
 const means=await f.engine.schema({...a,values:a.values.filter(v=>v.operation!=='sum')});assert.equal(means.columns[1].quantity.unitDefinition.kind,'absolute');
});

test('canonical numeric grouping keys obey the consumer spelling budget after exponent expansion',async()=>{
 const owner=policy(),consumer=policy(),f=fixture([column('Key','decimal',owner)],[]),row={cells:['1e9000']},a=recipe(consumer);consumer.resources.maxScalarCharacters=8192;
 await assert.rejects(aggregationSourceKey(f.materials,row,[column('Key','decimal',owner)],a),{code:'DATASET_CALCULATION_RESOURCE'});
 consumer.resources.maxScalarCharacters=12000;const key=await aggregationSourceKey(f.materials,row,[column('Key','decimal',owner)],a,{signature:true});assert.equal(key.key.length,71);assert.ok(key.text.includes('1'+'0'.repeat(9000)));assert.equal(row.cells[0],'1e9000');
});

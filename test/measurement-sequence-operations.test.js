import test from 'node:test';
import assert from 'node:assert/strict';
import {MaterialSequence} from '../src/material-sequence.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {blankQuantity} from '../src/web/measurement-model.js';
import {blankUnitDefinition,exactUnitScalar} from '../src/web/measurement-unit-model.js';
import {retainSequenceValue,sequenceValuePage,verifySequenceValue} from '../src/measurement-sequence-storage.js';
import {validateDomainValue} from '../src/measurement-domain-storage.js';
import {DatasetResourceBudget} from '../src/dataset-resource-budget.js';
import {sequenceOperationColumn,calculateSequenceNode} from '../src/measurement-sequence-operations.js';
const policy=()=>({...defaultDatasetResourcePolicy(),resources:{...defaultDatasetResourcePolicy().resources,maxOperations:1000000}});
function fixture(kind='numeric'){
 const files=new Map(),workspace={readMetadata:async key=>files.get(key)??null,writeMetadata:async(key,text)=>files.set(key,text)},materials={sequences:new MaterialSequence(workspace)},definition={version:4,codec:'observanda.sequence',codecVersion:1,namespace:'test.operations.signal',element:kind==='numeric'?{kind,representation:'radix-fraction',radix:6}:{kind},resourcePolicy:policy()},column={...defaultColumn({label:'Observed sequence'}),representation:'domain',domain:definition,quantity:blankQuantity()};
 return {files,materials,column,async cell(items){return {kind:'string',value:await retainSequenceValue(materials,{kind:'string',value:JSON.stringify(items)},definition,fn=>fn())};}};
}
const node=(kind,fields={})=>({kind:'domain-sequence',operation:{kind,...fields}});
test('sequence graph adapters retain original-radix elements, missing values and empty structural outputs',async()=>{
 const f=fixture(),cell=await f.cell(['10','0.1',null,'001.0']),columns=[f.column],options={policy:policy()};
 const selected=await calculateSequenceNode(f.materials,node('index',{index:0}),[cell],columns,options),schema=await sequenceOperationColumn(node('index',{index:0}),columns,options);assert.deepEqual(selected,{kind:'string',value:'10'});assert.equal(schema.representation,'radix-fraction');assert.equal(schema.radix,6);assert.equal(schema.resourcePolicy.resources.maxOperations,1000000);
 assert.deepEqual(await calculateSequenceNode(f.materials,node('index',{index:2}),[cell],columns,options),{kind:'null',value:''});assert.deepEqual(await calculateSequenceNode(f.materials,node('length'),[cell],columns,options),{kind:'string',value:'4'});
 for(const [operation,expected]of [[node('reverse'),['001.0',null,'0.1','10']],[node('slice',{start:1,count:2}),['0.1',null]],[node('slice',{start:4,count:0}),[]]]){const result=await calculateSequenceNode(f.materials,operation,[cell],columns,options);assert.equal(result.value.definition.namespace,f.column.domain.namespace);assert.deepEqual((await sequenceValuePage(f.materials,result.value,{resolve:true})).items.map(x=>x.spelling),expected);await verifySequenceValue(f.materials,result.value);}
 await assert.rejects(calculateSequenceNode(f.materials,node('index',{index:4}),[cell],columns,options),{code:'MEASUREMENT_SEQUENCE_INDEX'});assert.deepEqual(await calculateSequenceNode(f.materials,node('reverse'),[{kind:'absent',value:''}],columns,options),{kind:'absent',value:''});
});
test('symbol index remains a native symbol and concatenate rejects incompatible element spaces or units',async()=>{
 const f=fixture('symbol'),cell=await f.cell(['','0010',null]),options={policy:policy()},result=await calculateSequenceNode(f.materials,node('index',{index:0}),[cell],[f.column],options);assert.equal(result.value.original,'');assert.equal(result.value.definition.codec,'observanda.symbol');assert.equal(result.value.definition.namespace,f.column.domain.namespace);validateDomainValue(f.materials,result.value);
 const second=await f.cell(['tail']),joined=await calculateSequenceNode(f.materials,node('concatenate'),[cell,second],[f.column,f.column],options);assert.deepEqual((await sequenceValuePage(f.materials,joined.value)).items.map(x=>x.spelling),['','0010',null,'tail']);const other={...f.column,domain:{...f.column.domain,namespace:'another.space'}};await assert.rejects(sequenceOperationColumn(node('concatenate'),[f.column,other],options),{code:'MEASUREMENT_SEQUENCE_INCOMPATIBLE'});
 const n=fixture(),unit=blankUnitDefinition(),a={...n.column,unit:'one label',quantity:{...blankQuantity(),unitDefinition:unit}},b={...a,unit:'another label'};await sequenceOperationColumn(node('concatenate'),[a,b],options);await assert.rejects(sequenceOperationColumn(node('concatenate'),[a,{...b,quantity:{...b.quantity,unitDefinition:{...unit,scale:exactUnitScalar('2')}}}],options),{code:'MEASUREMENT_SEQUENCE_UNITS'});await assert.rejects(sequenceOperationColumn(node('reverse'),[{...f.column,unit:'V'}],options),{code:'MEASUREMENT_SEQUENCE_UNITS'});
});
test('sequence execution refuses exhausted cumulative budgets and revoked access before returning output',async()=>{
 const f=fixture(),cell=await f.cell(['1','2']),limited={...policy(),resources:{...policy().resources,maxOperations:20}},budget=new DatasetResourceBudget(limited);budget.run(()=>budget.step(20));await assert.rejects(calculateSequenceNode(f.materials,node('reverse'),[cell],[f.column],{policy:limited,budget}),{code:'DATASET_CALCULATION_RESOURCE'});
 const error=Object.assign(Error('Unavailable'),{code:'RECORD_OWNER_DENIED'});await assert.rejects(calculateSequenceNode(f.materials,node('reverse'),[cell],[f.column],{policy:policy(),check:()=>{throw error;}}),value=>value===error);
});

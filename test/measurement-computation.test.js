import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {validComputation,derivedComputation,computationLabel} from '../src/web/measurement-computation.js';
import {schemaReferences,validMeasurement,blankQuantity} from '../src/web/measurement-model.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {DatasetCalculations} from '../src/dataset-calculations.js';
import {DatasetAggregation} from '../src/dataset-aggregation.js';
import {CalculationGraphs} from '../src/calculation-graphs.js';
import {Measurements} from '../src/measurements.js';
const ref=kind=>({kind,id:id(),revision:'a'.repeat(64)});
const recipe=ref('analysis'),computation={version:1,kind:'approximate',recipe};
const column=(name,approximate=false)=>({...defaultColumn({label:name}),representation:'decimal',...(approximate?{computation}:{}),quantity:blankQuantity()});
const materials=columns=>({read:async()=>({content:{columns}}),datasetColumn:async(_doc,i)=>columns[i],datasetColumns:async()=>columns,checkReference:async()=>{},sequences:{}});

test('approximation is a separate declaration with a pinned recipe, not uncertainty or exact encoding',()=>{
 assert.equal(validComputation(computation),true);assert.deepEqual(schemaReferences(column('Result',true)),[recipe]);
 assert.equal(validComputation({...computation,recipe:ref('artifact')}),false);assert.equal(validComputation({...computation,precision:64}),false);
 assert.equal(validComputation({version:1,kind:'approximate'}),false);assert.equal(validComputation({version:1,kind:'approximate-inputs'}),true);
 assert.deepEqual(derivedComputation(column('Exact'),column('Result',true)),{computation:{version:1,kind:'approximate-inputs'}});assert.deepEqual(derivedComputation(column('Exact')),{});
 assert.equal(computationLabel(column('Result',true)),'Approximate computation');assert.equal(computationLabel(derivedComputation(column('Result',true))),'Computed from approximate inputs');
 const measurement={version:1,value:{spelling:'1.414',representation:'decimal',radix:10,unit:'',presence:'value'},quantity:blankQuantity(),time:column('').time,sources:[{ref:ref('dataset'),selector:{kind:'cell',page:0,row:0,column:0}}],references:{decoder:null,schema:null},decoderVersion:'',integrity:'not-checked',completion:'complete',note:'',computation};
 assert.equal(validMeasurement(measurement),true);assert.equal(validMeasurement({...measurement,computation:{version:1,kind:'exact'}}),false);
});

test('grouped values and exact counts retain approximate inputs without an accumulating recipe list',async()=>{
 const columns=[column('Group',true),column('Value')],engine=new DatasetAggregation(materials(columns)),source=ref('dataset');
 const result=await engine.schema({version:3,source,keys:[0],keySemantics:['numeric'],values:[{column:1,operation:'sum',name:'Total'},{column:1,operation:'count',name:'Count'}],missing:'skip',note:'',resourcePolicy:defaultDatasetResourcePolicy()});
 assert.deepEqual(result.columns[0].computation,computation);for(const column of result.columns.slice(1))assert.deepEqual(column.computation,{version:1,kind:'approximate-inputs'});
 assert.deepEqual(result.columns[2].quantity,{origin:'derived',conversion:null,calibration:null});
});

test('comparison-derived values retain approximation even though their decimal encoding has an exact rational identity',async()=>{
 const dataset=ref('dataset'),columns=[column('Value',true)],store=materials(columns);store.read=async reference=>reference.kind==='analysis'?{content:{comparison:{sources:[{dataset,columns:{value:0}}]}}}:{content:{columns}};
 const projected=await new DatasetCalculations(store).schema(ref('analysis'),'distribution',{version:3});assert.deepEqual(projected[0].computation,{version:1,kind:'approximate-inputs'});
});

test('graph compilation preserves approximate provenance through arithmetic and windows while constants remain exact',async()=>{
 const source=ref('dataset'),columns=[column('Result',true)],store=materials(columns),binding={id:id(),source,view:'observations',match:null};
 const nodes=[{id:id(),kind:'column',binding:{id:binding.id,position:0},column:0},{id:id(),kind:'constant',value:{constant:'1',representation:'integer',radix:10,unit:''}}];
 nodes.push({id:id(),kind:'scalar',operation:'add',left:{id:nodes[0].id,position:0},right:{id:nodes[1].id,position:1},condition:null,unit:''});
 nodes.push({id:id(),kind:'window',binding:{id:binding.id,position:0},column:0,operation:'mean',window:{version:1,order:'retained',start:0,end:0,boundary:'absent',missing:'propagate',excluded:'propagate'}});
 const sequence=(kind,values)=>({kind,count:values.length,values});store.sequences={validate:()=>{},item:async(d,i)=>d.values[i],items:async function*(d){yield* d.values;}};
 const content={tool:'Observanda calculation graph',graphVersion:8,policy:defaultDatasetResourcePolicy(),graphBindingsIndex:sequence('calculation-bindings',[binding]),graphNodesIndex:sequence('calculation-nodes',nodes),graphOutputsIndex:sequence('calculation-outputs',[{id:id(),name:'Output',node:{id:nodes[2].id,position:2}}]),where:null,selectionReason:''};
 const values=new Map(),work={put:async(k,v)=>values.set(k,v),get:async k=>values.get(k),add:async k=>{if(values.has(k))return false;values.set(k,true);return true;}};
 await new CalculationGraphs(store).compile({kind:'analysis',content},work);
 assert.deepEqual(values.get('node:0').column.computation,computation);assert.equal(values.get('node:1').column.computation,undefined);
 for(const i of [2,3])assert.deepEqual(values.get('node:'+i).column.computation,{version:1,kind:'approximate-inputs'});
});

test('measurement authoring derives and verifies approximation from its pinned source',async()=>{
 const source={ref:ref('dataset'),selector:{kind:'cell',page:0,row:0,column:0}},col=column('Result',true),store=materials([col]);
 store.workspace={withLock:async run=>run()};store.assertOwner=async()=>{};store.current=async()=>null;store.commit=async command=>command;
 const engine=new Measurements(store);engine.cell=async()=>({column:col,value:{spelling:'1.414',representation:'decimal',radix:10,unit:'',presence:'value'},quantity:blankQuantity(),time:col.time});
 const seed=await engine.seed(source),measurement={version:1,...seed,references:{decoder:null,schema:null},decoderVersion:'',integrity:'not-checked',completion:'complete',note:''};
 const {computation:omitted,...stripped}=measurement;await assert.rejects(engine.validate(stripped),{code:'MEASUREMENT_INVALID'});
 const saved=await engine.save({recordId:id(),title:'Approximate observation',measurement:stripped});assert.deepEqual(saved.content.measurement.computation,{version:1,kind:'approximate-inputs'});assert.deepEqual(saved.content.inputs,[source.ref]);
});


test('record references remain valid measurement sources without a material content object',async()=>{
 const store={read:async()=>({id:id(),title:'Retained record'})},engine=new Measurements(store),source={ref:ref('record'),selector:{kind:'whole'}},seed=await engine.seed(source);
 const value={version:1,...seed,references:{decoder:null,schema:null},decoderVersion:'',integrity:'not-checked',completion:'partial',note:''};
 await engine.validate(value);assert.equal(seed.computation,undefined);
});

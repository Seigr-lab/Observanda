import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {registerHooks} from 'node:module';
import {MaterialSequence} from '../src/material-sequence.js';
import {CalculationGraphs} from '../src/calculation-graphs.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {defaultStructuredCalculationPolicy} from '../src/web/tools/calculation-policy.js';
import {calculateWindow} from '../src/dataset-window-operations.js';
import {defaultWindow} from '../src/web/dataset-window-model.js';
import {graphCellComputation} from '../src/graph-cell-computation.js';
const policy=defaultDatasetResourcePolicy(),marker={version:2,kind:'per-cell'},rounded={version:2,kind:'approximate',method:'pearson-centered-pairs-v1',engine:4,policy:defaultStructuredCalculationPolicy()},inherited={version:1,kind:'approximate-inputs'};
const work=()=>{const rows=new Map();return {get:async key=>structuredClone(rows.get(key)),put:async(key,value)=>rows.set(key,structuredClone(value)),remove:async key=>rows.delete(key),add:async(key,value=true)=>{if(rows.has(key))return false;rows.set(key,structuredClone(value));return true;},has:async key=>rows.has(key)};};
async function fixture(){
 const files=new Map(),workspace={readMetadata:async key=>files.get(key)??null,writeMetadata:async(key,value)=>files.set(key,value)},sequences=new MaterialSequence(workspace),source={kind:'dataset',id:randomUUID(),revision:'1'.repeat(64)},graph={kind:'analysis',id:randomUUID(),revision:'2'.repeat(64)};
 const columns=['Left','Right','Condition'].map((name,i)=>({...defaultColumn({label:name}),representation:i===2?'integer':'rational',resourcePolicy:policy,computation:marker}));
 const sourceRows=[['1/2','1/1','0'],['1/2','1/1','1'],['1/2','1/1','1']].map((cells,index)=>({id:randomUUID(),order:index+1,excluded:null,cells,valueKinds:['string','string','string'],cellComputations:index===0?[rounded,null,null]:index===1?[rounded,inherited,null]:[null,null,inherited]}));
 const sourceDoc={...source,content:{columns}},binding={id:randomUUID(),source,view:'observations',match:null},nodes=[];const address=position=>({id:nodes[position].id,position}),add=node=>{nodes.push({id:randomUUID(),...node});return address(nodes.length-1);};
 const left=add({kind:'column',binding:{id:binding.id,position:0},column:0}),right=add({kind:'column',binding:{id:binding.id,position:0},column:1}),condition=add({kind:'column',binding:{id:binding.id,position:0},column:2}),zero=add({kind:'constant',value:{constant:'0',unit:'',representation:'integer',radix:10,quantity:undefined}}),predicate=add({kind:'comparison',left:condition,right:zero,operator:'gt'}),copy=add({kind:'scalar',operation:'copy',left,right:null,condition:null,unit:'',quantity:undefined,output:undefined}),choose=add({kind:'scalar',operation:'choose',left,right,condition:predicate,unit:'',quantity:undefined,output:undefined}),sum=add({kind:'scalar',operation:'add',left,right,condition:null,unit:'',quantity:undefined,output:undefined});
 const sequence=async(kind,items)=>{const builder=sequences.builder(kind,fn=>fn());for(const item of items)await builder.append(item);return builder.finish();},doc={...graph,content:{tool:'Observanda calculation graph',graphVersion:14,policy,graphBindingsIndex:await sequence('calculation-bindings',[binding]),graphNodesIndex:await sequence('calculation-nodes',nodes),graphOutputsIndex:await sequence('calculation-outputs',[left,copy,choose,sum].map((node,index)=>({id:randomUUID(),name:'Output '+index,node}))),where:null,selectionReason:''}};
 const materials={workspace,sequences,read:async ref=>{if(ref.id===source.id)return sourceDoc;if(ref.id===graph.id)return doc;throw Error('Unexpected reference');},checkReference:async()=>{},datasetColumn:async(document,index)=>document.content.columns[index],datasetPageCount:()=>1,retainedSchemaPage:async(document,{offset=0,limit=16}={})=>({items:document.content.columns.slice(offset,offset+limit),total:columns.length}),retainedDatasetPage:async(document,page,{columns:selection,metadataOnly}={})=>({rows:sourceRows.map(row=>metadataOnly||!selection?structuredClone(row):{...structuredClone(row),cells:selection.map(i=>row.cells[i]),valueKinds:selection.map(i=>row.valueKinds[i]),cellComputations:selection.map(i=>row.cellComputations?.[i])})})};
 const key='graphCell_'+randomUUID().replaceAll('-','');globalThis[key]=create=>create(work());const hooks=registerHooks({resolve(specifier,context,next){return specifier==='./scratch-iterator.js'&&context.parentURL?.includes('cell-pure=')?{url:'cell-pure:'+key,shortCircuit:true}:next(specifier,context);},load(url,context,next){return url==='cell-pure:'+key?{format:'module',shortCircuit:true,source:'export const scratchIterator=create=>globalThis['+JSON.stringify(key)+'](create);'}:next(url,context);}});
 try{const {GraphCalculations}=await import('../src/calculation-graph-evaluation.js?cell-pure='+key);return {materials,columns,sourceRows,doc,nodes,graphs:new CalculationGraphs(materials),engine:new GraphCalculations(materials),command:{calculation:{version:17,graph}},close(){delete globalThis[key];}};}finally{hooks.deregister();}
}
async function values(f,options={}){const rows=[];for await(const row of f.engine.rows(f.command,f.doc,options)){if(row.columnCount!==undefined)continue;const cells=[];for await(const cell of row.cells())cells.push(cell);rows.push(cells);}return rows;}
test('graph14 actual source, copy, chosen branch and arithmetic provenance stay distinct',async()=>{
 const f=await fixture();try{const cache=work();await f.graphs.compile(f.doc,cache);assert.deepEqual((await cache.get('node:6')).column.computation,marker);const rows=await values(f);
 assert.deepEqual(rows.map(row=>row.map(cell=>cell.value)),[['1/2','1/2','1/1','3/2'],['1/2','1/2','1/2','3/2'],['1/2','1/2','1/2','3/2']]);
 assert.deepEqual(rows.map(row=>row[0].computation),[rounded,rounded,null]);assert.deepEqual(rows.map(row=>row[1].computation),[inherited,inherited,null]);assert.deepEqual(rows.map(row=>row[2].computation),[null,inherited,inherited]);assert.deepEqual(rows.map(row=>row[3].computation),[inherited,inherited,null]);assert.ok(rows.flat().every(cell=>Object.hasOwn(cell,'computation')));
 f.engine.validate=async()=>f.doc;const preview=await f.engine.previewScoped(f.command);assert.deepEqual(preview.formats[2].computation,marker);assert.deepEqual(preview.rows[0].cellComputations[2],null);
 }finally{f.close();}
});
test('historical graphs refuse per-cell columns even for simple source selection; missing metadata refuses',async()=>{
 const f=await fixture();try{for(const graphVersion of [1,5,7,10,13])await assert.rejects(f.graphs.compile({...f.doc,content:{...f.doc.content,graphVersion}},work()),{code:'DATASET_CALCULATION'});delete f.sourceRows[1].cellComputations[0];await assert.rejects(values(f),{code:'DATASET_CELL_COMPUTATION'});}finally{f.close();}
});
test('graph14 exact missing/excluded outputs are explicit and cancellation retains its identity',async()=>{
 const f=await fixture();try{f.sourceRows[1].excluded='Explicit exclusion';const result=await values(f);assert.ok(result[1].every(cell=>cell.kind==='absent'&&cell.computation===null));const controller=new AbortController();controller.abort();await assert.rejects(values(f,{signal:controller.signal}),{name:'AbortError'});}finally{f.close();}
});
test('generic copy/shape reuse and condition-sensitive selection preserve actual cell computation',()=>{
 const exact={kind:'string',value:'1',computation:null},approx={...exact,computation:rounded},condition={...exact,value:'0'};
 for(const kind of ['domain-reshape','domain-permute'])assert.deepEqual(graphCellComputation({kind},exact,[approx],{}),{computation:rounded});assert.deepEqual(graphCellComputation({kind:'domain',operation:'choose'},exact,[approx,exact,condition],{}),{computation:null});assert.deepEqual(graphCellComputation({kind:'domain',operation:'extract'},exact,[approx],{}),{computation:inherited});assert.deepEqual(graphCellComputation({kind:'coordinate-transform'},exact,[exact,{computation:inherited}],{}),{computation:inherited});
});
test('bounded windows preserve selected lag provenance and derive from all consumed numeric values',async()=>{
 const column={...defaultColumn({label:'Mixed'}),representation:'rational',resourcePolicy:policy,computation:marker},cells=[{value:'1/2',kind:'string',computation:rounded},{value:'1/1',kind:'string',computation:null}],reader={anchor:0,total:2,at:async i=>cells[i]},node={operation:'sum',window:{...defaultWindow(),start:0,end:1}};
 const sum=await calculateWindow(node,column,reader,policy);assert.equal(sum.value,'3/2');assert.deepEqual(sum.computation,inherited);
 const minimum=await calculateWindow({...node,operation:'min'},column,reader,policy);assert.equal(minimum.value,'1/2');assert.deepEqual(minimum.computation,inherited);
 const lag=await calculateWindow({operation:'lag',window:{...defaultWindow(),start:0,end:0}},column,{...reader,total:1,at:async()=>cells[1]},policy);assert.equal(lag.value,'1/1');assert.equal(lag.computation,null);
 cells[0]={...cells[0],excluded:'Skipped'};const skip=await calculateWindow({...node,window:{...node.window,excluded:'skip'}},column,reader,policy);assert.equal(skip.value,'1/1');assert.equal(skip.computation,null);delete cells[1].computation;await assert.rejects(calculateWindow(node,column,reader,policy),{code:'DATASET_CELL_COMPUTATION'});
});

import {datasetPlotSelection,verifySelectedPlot} from '../src/dataset-plot-selection.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatasetCalculations} from '../src/dataset-calculations.js';
import {DatasetAggregation} from '../src/dataset-aggregation.js';
import {AnalysisComparisons} from '../src/analysis-comparisons.js';
import {analysisObservations} from '../src/analysis-observations.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {blankAnalysisSource,validAnalysisSource} from '../src/web/analysis-model.js';
import {validCalculation,calculateStep} from '../src/web/dataset-calculation-model.js';
import {loadDatasetColumnWindow} from '../src/web/dataset-column-picker.js';
const ref=()=>({kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)});
const column=(name,representation='integer')=>({...defaultColumn({label:name}),representation});
function fixture(){
 const reference=ref(),doc={kind:'dataset',content:{schemaIndex:{count:10000},rowCount:2}},reads=[],definitions=new Map([[9000,column('Group','text')],[2,column('Value')],[9999,column('Last')]]),raw=[new Map([[9000,'A'],[2,'2'],[9999,'4']]),new Map([[9000,'A'],[2,'4'],[9999,'8']])];
 const materials={async read(r){assert.equal(r.id,reference.id);return doc;},async assertOwner(){},datasetPageCount:()=>1,
  async datasetColumns(){assert.fail('whole schema read');},
  async datasetColumn(d,index){assert.equal(d,doc);assert.ok(definitions.has(index));reads.push(['column',index]);return definitions.get(index);},
  async retainedDatasetPage(d,page,{columns}={}){assert.equal(d,doc);assert.equal(page,0);assert.ok(Array.isArray(columns));assert.ok(columns.length<=3);reads.push(['page',columns]);return {columnIndices:columns,rows:raw.map((values,i)=>({id:'row-'+i,order:i+1,cells:columns.map(index=>values.get(index)??''),valueKinds:columns.map(()=> 'string'),columnIndices:columns,excluded:null}))};},
  async *iterateDataset(r,options){yield* (await this.retainedDatasetPage(await this.read(r),0,options)).rows;}};
 return {materials,reference,doc,reads,raw,definitions};
}
test('aggregation reads only declared wide columns and keeps exact group values',async()=>{
 const f=fixture(),aggregation={version:1,source:f.reference,keys:[9000],values:[{column:2,operation:'sum',name:'Total'}],missing:'skip',note:''},command={recordId:randomUUID(),title:'Selected groups',aggregation},service=new DatasetAggregation(f.materials),schema=await service.validate(command),state=new Map(),work={get:async key=>state.get(key),put:async(key,value)=>state.set(key,value),removeMany:async keys=>keys.forEach(k=>state.delete(k))};
 assert.deepEqual(schema.indices,[9000,2]);const rows=[];for await(const row of service.rows(command,schema,{work,total:2}))rows.push(row);
 assert.deepEqual(rows[1].cells,['A','6/1']);assert.deepEqual(rows[1].aggregation,[{included:2,excluded:0,missing:0,total:2}]);assert.deepEqual(f.reads.filter(r=>r[0]==='page'),[['page',[9000,2]]]);
 f.raw[0].set(2,{format:'dataset-cell',version:1,characters:20000});await assert.rejects(async()=>{for await(const row of service.rows(command,schema,{work:{get:async()=>undefined,put:async()=>{}},total:2}))void row;},{code:'DATASET_CELL_SCALAR_REQUIRED'});
});
test('comparison observes selected source coordinates and refuses descriptor coercion',async()=>{
 const f=fixture(),source=blankAnalysisSource(f.reference);source.columns.value=2;source.columns.condition=9000;assert.equal(validAnalysisSource(source),true);
 const observations=[];for await(const item of analysisObservations(f.materials,{sources:[source]}))observations.push(item);
 assert.equal(observations[0].condition,'A');assert.equal(observations[0].locator.selector.column,2);assert.deepEqual(observations[1].exact,{numerator:'4',denominator:'1'});
 const comparison={sources:[source],expected:{source:0,dataset:f.reference,key:9000,actualKey:9000,value:2,rationale:'Exact retained readings'}};
 const result=await new AnalysisComparisons(f.materials).verifyExpected(comparison,{});assert.equal(result.correct,2);assert.equal(result.unmatched,0);
 f.raw[0].set(2,{format:'dataset-cell',version:1,characters:20000});await assert.rejects(async()=>{for await(const item of analysisObservations(f.materials,{sources:[source]}))void item;},{code:'DATASET_CELL_SCALAR_REQUIRED'});
});
test('versioned calculation projections preserve order and original cell locators',async()=>{
 const f=fixture(),calculation={version:2,source:f.reference,projection:[9999,2],view:'observations',joins:[],steps:[],where:null,selectionReason:'',calibration:null,note:''},service=new DatasetCalculations(f.materials),command={recordId:randomUUID(),title:'Selected readings',calculation};
 assert.equal(validCalculation(calculation),true);assert.equal(validCalculation({...calculation,projection:[2,2]}),false);assert.equal(validCalculation({...calculation,version:1}),false);
 const {projection,...legacy}=calculation;assert.equal(validCalculation({...legacy,version:1}),true);
 const schema=await service.validate(command);assert.deepEqual(schema.map(c=>c.name),['Last','Value']);const rows=[];for await(const row of service.sourceRows(f.reference,'observations',{columns:calculation.projection}))rows.push(row);
 assert.deepEqual(rows[0].cells,['4','2']);assert.equal(rows[0].columnIndices,undefined);assert.deepEqual(rows[0].cellSources.map(s=>s[0].selector.column),[9999,2]);
 const sum=calculateStep({name:'Sum',unit:'',operation:'add',left:{column:0},right:{column:1},condition:null},rows[0],schema);assert.equal(sum.value,'6/1');assert.deepEqual(sum.sources.map(s=>s.selector.column),[9999,2]);
 f.raw[0].set(2,{format:'dataset-cell',version:1,characters:20000});await assert.rejects(async()=>{for await(const row of service.sourceRows(f.reference,'observations',{columns:[2]}))void row;},{code:'DATASET_CELL_SCALAR_REQUIRED'});
});
test('column picker requests one schema window and only selected off-window definitions',async()=>{
 const calls=[],page=await loadDatasetColumnWindow(async(operation,data)=>{calls.push({operation,...data});return data.columns?{columns:data.columns.map(i=>column(String(i)))}:{columns:Array.from({length:16},(_,i)=>column(String(i+32))),offset:32,total:10000,next:48};},ref(),{offset:32,selected:[9999,35,9000]});
 assert.equal(calls.length,2);assert.deepEqual(calls[1].columns,[9999,9000]);assert.equal(page.items.length,18);assert.equal(page.total,10000);assert.deepEqual(page.items.slice(-2).map(i=>i.index),[9999,9000]);
});

test('wide plot selection retains absolute mapping and rejects substituted v7 denominators',async()=>{
 const f=fixture();f.doc.content.datasetFormat=3;f.definitions.get(9000).unit='group';
 const mapping={x:2,xKind:'number',group:9000,values:[{column:9999,error:null}],operation:'raw',kind:'line',order:'source'},selected=await datasetPlotSelection(f.materials,f.doc,mapping);
 assert.deepEqual(selected.indices,[2,9000,9999]);assert.deepEqual(selected.mapping,{...mapping,x:0,group:1,values:[{column:2,error:null}]});assert.equal(mapping.values[0].column,9999);
 const content={tool:'Observanda table mapping',version:'7',inputs:[f.reference],mapping,parameters:JSON.stringify(mapping),denominator:{format:3,dataset:f.reference,columnIndices:selected.indices,rows:2,included:2,excludedCount:0,missing:selected.columns.map((c,i)=>({column:selected.indices[i],name:c.name,count:0}))}};
 await verifySelectedPlot(f.materials,{content});
 for(const alter of [c=>{c.denominator.columnIndices[0]=9999;},c=>{c.denominator.missing[0].column=9999;},c=>{c.denominator.missing[0].name='Substituted';},c=>{c.denominator.included=3;},c=>{c.mapping.x=9999;},c=>{c.mapping.xKind='invalid';c.parameters=JSON.stringify(c.mapping);},c=>{c.mapping.numericPolicy='truncate';c.parameters=JSON.stringify(c.mapping);},c=>{c.mapping.values[0].error=9000;c.parameters=JSON.stringify(c.mapping);},c=>{c.denominator.dataset={...f.reference,revision:'b'.repeat(64)};}]){const changed=structuredClone(content);alter(changed);await assert.rejects(()=>verifySelectedPlot(f.materials,{content:changed}),{code:'CATALOGUE_DAMAGED'});}
});

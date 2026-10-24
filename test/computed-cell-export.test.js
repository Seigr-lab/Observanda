import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {retainedTable,retainedTableBlocks} from '../src/retained-tables.js';
import {retainedTableHTML} from '../src/publication-retained-tables.js';
import {retainedTableView} from '../src/web/retained-table-model.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {defaultStructuredCalculationPolicy} from '../src/web/tools/calculation-policy.js';
const ref={kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function fixture(){
 const policy=defaultStructuredCalculationPolicy(),computation={version:2,kind:'approximate',method:'pearson-centered-pairs-v1',engine:4,policy},column={...defaultColumn({label:'Correlation'}),representation:'rational',computation:{version:2,kind:'per-cell'}},metric={operation:'correlation',method:'pearson-centered-pairs-v1',pairing:'complete-rows-v1',calculationPolicy:policy},rows=[{cells:['1/1'],valueKinds:['string'],cellComputations:[null]},{cells:['7071067811865475/10000000000000000'],valueKinds:['string'],cellComputations:[computation]},{cells:[''],valueKinds:['absent'],cellComputations:[null]}];
 const doc={content:{rowCount:3,aggregation:{version:6,source:{...ref,id:randomUUID()},keys:[],values:[metric],note:'Private research note'}}};
 return {doc,read:async()=>doc,datasetColumns:async()=>[column],retainedSchemaPage:async()=>({items:[column],total:1}),datasetPageCount:()=>1,retainedDatasetPage:async()=>({columnIndices:[0],rows})};
}
test('mixed public tables distinguish exact, approximate and unavailable values without disclosing source identifiers',async()=>{
 const materials=fixture(),table=await retainedTable(materials,{ref,version:3,selection:{columns:'all',offset:0,count:null,includeExcluded:false}});let block;for await(const item of retainedTableBlocks(materials,{ref,table}))block=item.table;
 let exported='';for await(const part of retainedTableHTML(materials,{source:ref,table}))exported+=part;
 for(const html of [retainedTableView(block,esc),exported]){assert.match(html,/Pearson/i);assert.match(html,/Nearest, ties to even/);assert.match(html,new RegExp('1/1<small[^>]*>Exact computational value'));assert.match(html,new RegExp('7071067811865475/10000000000000000<small[^>]*>Approximate Pearson'));assert.match(html,new RegExp('<td>Absent</td>'));for(const privateValue of [ref.id,ref.revision,materials.doc.content.aggregation.source.id,'Private research note'])assert.ok(!html.includes(privateValue));}
 await assert.rejects(retainedTable(materials,{ref,version:2,selection:{columns:[0],offset:0,count:3,includeExcluded:false}}),{code:'DATASET_TABLE'});
});

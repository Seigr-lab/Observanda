import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {retainedTable,retainedTableBlocks} from '../src/retained-tables.js';
import {retainedTableHTML} from '../src/publication-retained-tables.js';
import {retainedTableView,validRetainedTable} from '../src/web/retained-table-model.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
const ref={kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function fixture(probability){
 const columns=[defaultColumn({label:'Group'}),{...defaultColumn({label:'Selected quantile'}),representation:'rational'}],row={cells:['A','5/2'],valueKinds:['string','string']};
 const aggregation={version:4,source:{...ref,id:randomUUID()},keys:[0],values:[{column:1,operation:'quantile',name:'Selected quantile',method:'linear-n-minus-one-v1',probability}],resourcePolicy:defaultDatasetResourcePolicy(),missing:'skip',note:''};
 return {aggregation,read:async()=>({content:{rowCount:1,aggregation}}),datasetColumns:async()=>columns,async *iterateDataset(){yield row;},retainedSchemaPage:async(_,options)=>({items:columns.slice(options.offset,options.offset+options.limit),total:columns.length}),datasetPageCount:()=>1,retainedDatasetPage:async(_,page,{columns:indices})=>({columnIndices:indices,rows:[{cells:indices.map(i=>row.cells[i]),valueKinds:indices.map(i=>row.valueKinds[i])}]})};
}
test('retained table formats attach probability and method to the selected quantile column only',async()=>{
 const materials=fixture({spelling:'1/4',representation:'rational',radix:10});
 for(const version of [1,2]){const table=await retainedTable(materials,{ref,version,selection:{columns:[0,1],offset:0,count:1,includeExcluded:false}});assert.equal(validRetainedTable(table),true);assert.equal(table.headers[0],'Group');assert.match(table.headers[1],/probability 1\/4 \(rational, base 10\)/);assert.match(table.headers[1],/linear interpolation/);assert.equal(table.rows[0].cells[1],'5/2');}
 const table=await retainedTable(materials,{ref,version:3,selection:{columns:[1],offset:0,count:null,includeExcluded:false}});let block;for await(const item of retainedTableBlocks(materials,{ref,table}))block=item.table;
 assert.deepEqual(block.formats[0].quantile,{method:materials.aggregation.values[0].method,probability:materials.aggregation.values[0].probability});assert.match(retainedTableView(block,esc),/probability 1\/4/);
 materials.aggregation.version=3;materials.aggregation.values[0]={column:1,operation:'median',name:'Selected quantile'};for await(const item of retainedTableBlocks(materials,{ref,table}))assert.equal(item.table.formats[0].quantile,undefined);
});
test('public quantile export streams complete retained probability and excludes private locators',async()=>{
 const spelling='0.25'+'0'.repeat(5000),privateRef={format:'dataset-cell',characters:spelling.length,privateId:'private-retained-probability'},materials=fixture({spelling:privateRef,representation:'decimal',radix:10}),windows=[];
 materials.readDatasetCell=async(value,{offset,limit})=>{assert.deepEqual(value,privateRef);windows.push({offset,limit});const text=spelling.slice(offset,offset+limit);return {text,offset,total:spelling.length,next:offset+text.length<spelling.length?offset+text.length:null};};
 const table=await retainedTable(materials,{ref,version:3,selection:{columns:'all',offset:0,count:null,includeExcluded:false}});let html='';for await(const part of retainedTableHTML(materials,{source:ref,table}))html+=part;
 assert.ok(html.includes(spelling+' (decimal, base 10)'));assert.match(html,/<td>5\/2<\/td>/);assert.equal((html.match(/Quantile probability/g)??[]).length,1);assert.doesNotMatch(html,/private-retained-probability|resourcePolicy/);assert.ok(!html.includes(materials.aggregation.source.id));assert.equal(windows.length,2);assert.ok(windows.every(window=>window.limit<=4096));
 let block;for await(const item of retainedTableBlocks(materials,{ref,table}))block=item.table;assert.match(retainedTableView(block,esc),/retained scalar/);
});

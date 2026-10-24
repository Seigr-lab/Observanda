import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {retainedTable,retainedTableBlocks} from '../src/retained-tables.js';
import {retainedTableHTML} from '../src/publication-retained-tables.js';
import {retainedTableView,validRetainedTable} from '../src/web/retained-table-model.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
const ref={kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function fixture(){
 const common={column:1,pairedColumn:2,pairing:'complete-rows-v1'};
 const values=[...['sample','population'].map(normalization=>({...common,operation:'covariance',method:'centered-pairs-v1',normalization,name:normalization+' covariance'})),...['slope','intercept'].map(coefficient=>({...common,operation:'linear-fit',method:'ordinary-least-squares-intercept-v1',coefficient,name:'Fit '+coefficient})),{column:1,operation:'quantile',method:'linear-n-minus-one-v1',probability:{spelling:'1/2',representation:'rational',radix:10},name:'Median quantile'}];
 const columns=[defaultColumn({label:'Group'}),...values.map(value=>({...defaultColumn({label:value.name}),representation:'rational'}))];
 const rows=[{cells:['A','2/1','4/3','2/1','1/1','2/1'],valueKinds:Array(6).fill('string')},{cells:['One pair','','0/1','','','5/1'],valueKinds:['string','absent','string','absent','absent','string']}];
 const aggregation={version:5,source:{...ref,id:randomUUID()},keys:[0],values,resourcePolicy:defaultDatasetResourcePolicy(),missing:'skip',note:'Private method note'};
 return {aggregation,columns,read:async()=>({content:{rowCount:rows.length,aggregation}}),datasetColumns:async()=>columns,async *iterateDataset(){yield* rows;},retainedSchemaPage:async(_,options)=>({items:columns.slice(options.offset,options.offset+options.limit),total:columns.length}),datasetPageCount:()=>1,retainedDatasetPage:async(_,page,{columns:indices})=>({columnIndices:indices,rows:rows.map(row=>({cells:indices.map(i=>row.cells[i]),valueKinds:indices.map(i=>row.valueKinds[i])}))})};
}
test('paired-method context follows selected columns and keeps mixed quantiles in paged and retained tables',async()=>{
 const materials=fixture();
 for(const version of [1,2]){const table=await retainedTable(materials,{ref,version,selection:{columns:[4,0,2,5],offset:0,count:2,includeExcluded:false}});assert.equal(validRetainedTable(table),true);assert.match(table.headers[0],/intercept/i);assert.equal(table.headers[1],'Group');assert.match(table.headers[2],/population/i);assert.match(table.headers[3],/probability 1\/2/);assert.equal(table.rows[1].presence[0],'absent');}
 const table=await retainedTable(materials,{ref,version:3,selection:{columns:[4,0,2,5],offset:0,count:null,includeExcluded:false}});let block;for await(const item of retainedTableBlocks(materials,{ref,table}))block=item.table;
 assert.deepEqual(block.formats[0].pairedStatistic,{operation:'linear-fit',method:'ordinary-least-squares-intercept-v1',pairing:'complete-rows-v1',coefficient:'intercept'});assert.equal(block.formats[1].pairedStatistic,undefined);assert.equal(block.formats[2].pairedStatistic.normalization,'population');assert.equal(block.formats[3].quantile.probability.spelling,'1/2');assert.match(retainedTableView(block,esc),/intercept/i);
});
test('public paired statistics retain method and absence without leaking private references or notes',async()=>{
 const materials=fixture(),table=await retainedTable(materials,{ref,version:3,selection:{columns:'all',offset:0,count:null,includeExcluded:false}});let html='';for await(const part of retainedTableHTML(materials,{source:ref,table}))html+=part;
 for(const context of [/sample/i,/population/i,/slope/i,/intercept/i,/unweighted/i,/complete/i,/probability 1\/2/])assert.match(html,context);
 for(const value of ['2/1','4/3','1/1','0/1'])assert.ok(html.includes('<td>'+value+'</td>'));
 assert.match(html,/<td>Absent<\/td>/);for(const privateValue of [ref.id,materials.aggregation.source.id,'Private method note','resourcePolicy','pairedColumn'])assert.ok(!html.includes(privateValue));
});

test('table readers and public export preserve declared unit coordinates and stream complete retained scales',async()=>{
 const materials=fixture(),policy=defaultDatasetResourcePolicy(),unit={version:2,kind:'absolute',dimensions:[{axis:'time',exponent:1}],scale:{spelling:'3/2',representation:'rational',radix:10},offset:{spelling:'-7/2',representation:'rational',radix:10},resourcePolicy:policy};
 materials.columns[4].quantity={origin:'derived',conversion:null,calibration:null,unitDefinition:unit};
 const stored=await retainedTable(materials,{ref,version:2,selection:{columns:[4],offset:0,count:1,includeExcluded:false}});assert.match(stored.headers[0],/time\^1/);assert.match(stored.headers[0],/3\/2 \(rational, base 10\)/);assert.match(stored.headers[0],/-7\/2/);
 const scale='1.'+'0'.repeat(5000),value={format:'dataset-cell',version:1,characters:scale.length,sha256:'b'.repeat(64),parts:{format:1,kind:'cell-text',root:{count:1,height:1,hash:'c'.repeat(64),key:'d'.repeat(64)},count:1,chunkSize:16}},windows=[];
 materials.columns[4].quantity.unitDefinition={...unit,scale:{spelling:value,representation:'decimal',radix:10}};
 materials.readDatasetCell=async(selected,{offset,limit})=>{assert.deepEqual(selected,value);windows.push({offset,limit});const text=scale.slice(offset,offset+limit);return {text,next:offset+text.length<scale.length?offset+text.length:null};};
 const table=await retainedTable(materials,{ref,version:3,selection:{columns:[4],offset:0,count:null,includeExcluded:false}});let block;for await(const item of retainedTableBlocks(materials,{ref,table}))block=item.table;
 assert.deepEqual(block.formats[0].unitDefinition,materials.columns[4].quantity.unitDefinition);assert.match(retainedTableView(block,esc),/retained scalar/);assert.match(retainedTableView(block,esc),/time\^1/);
 let html='';for await(const part of retainedTableHTML(materials,{source:ref,table}))html+=part;assert.ok(html.includes(scale+' (decimal, base 10)'));assert.match(html,/-7\/2 \(rational, base 10\)/);assert.match(html,/Canonical value = value \* scale \+ offset/);assert.equal(windows.length,2);assert.ok(windows.every(window=>window.limit<=4096));for(const privateValue of [value.sha256,value.parts.root.hash,value.parts.root.key,'resourcePolicy'])assert.ok(!html.includes(privateValue));
});

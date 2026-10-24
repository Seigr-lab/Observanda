import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {clockSynchronizationContextText} from '../src/web/measurement-clock-context.js';
import {retainedTable,retainedTableBlocks} from '../src/retained-tables.js';
import {retainedTableView,validRetainedTable} from '../src/web/retained-table-model.js';
import {retainedTableHTML} from '../src/publication-retained-tables.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
const ref={kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)};
const scalar=spelling=>({spelling,representation:'radix',radix:6});
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const context=()=>({version:1,method:'two-anchor-affine',validity:{lower:scalar('0'),upper:scalar('10')},epoch:'Reference <origin>',sourceUnit:'source intervals',sourceReference:'Source coordinate origin',resourcePolicy:defaultDatasetResourcePolicy()});
function fixture(synchronization){
 const columns=[{...defaultColumn({label:'Synchronized coordinate'}),representation:'rational',unit:'reference intervals',synchronization},{...defaultColumn({label:'Unchanged'}),representation:'integer'}],cells=['5/2','4'],row={cells,valueKinds:['string','string']};
 return {columns,cells,read:async()=>({content:{rowCount:1}}),datasetColumns:async()=>[...columns],async *iterateDataset(){yield row;},retainedSchemaPage:async(_,options)=>({items:columns.slice(options.offset,options.offset+options.limit),total:columns.length}),datasetPageCount:()=>1,retainedDatasetPage:async(_,page,{columns:indices})=>({columnIndices:indices,rows:[{...row,cells:indices.map(i=>cells[i]),valueKinds:indices.map(i=>row.valueKinds[i])}]})};
}
test('table capture retains declared clock validity and source units without changing unrelated columns',async()=>{
 const materials=fixture(context()),selection={columns:[0,1],offset:0,count:1,includeExcluded:false};
 for(const version of [1,2]){
  const table=await retainedTable(materials,{ref,selection,version});assert.equal(validRetainedTable(table),true);assert.deepEqual(table.rows[0].cells,materials.cells);
  const html=retainedTableView(table,esc);assert.match(html,/two-anchor affine model/);assert.match(html,/0 \(radix, base 6\) to 10 \(radix, base 6\) \[source intervals\]/);assert.match(html,/Reference &lt;origin&gt;/);assert.equal(table.headers[1],'Unchanged');assert.equal(table.formats?.[0].synchronization,undefined);
 }
 assert.equal(clockSynchronizationContextText(null),'');
});
test('paged export streams complete validity bounds and never emits private scalar references',async()=>{
 const c=context(),upper='1.'+'23450'.repeat(1900),privateRef={format:'dataset-cell',privateStorageId:'do-not-publish-storage-identity',characters:upper.length};c.validity.upper={spelling:privateRef,representation:'decimal',radix:10};
 const materials=fixture(c),windows=[];materials.readDatasetCell=async(value,{offset,limit})=>{assert.deepEqual(value,privateRef);windows.push({offset,limit});const text=upper.slice(offset,offset+limit);return {text,offset,total:upper.length,next:offset+text.length<upper.length?offset+text.length:null};};
 const table=await retainedTable(materials,{ref,selection:{columns:'all',offset:0,count:null,includeExcluded:false},version:3});let block;for await(const item of retainedTableBlocks(materials,{ref,table}))block=item.table;
 assert.deepEqual(block.formats[0].synchronization,c);const preview=retainedTableView(block,esc);assert.match(preview,/retained scalar/);assert.doesNotMatch(preview,/do-not-publish-storage-identity/);
 let html='';for await(const part of retainedTableHTML(materials,{source:ref,table}))html+=part;
 assert.ok(html.includes(upper+' (decimal, base 10) [source intervals]'));assert.match(html,/Reference &lt;origin&gt;/);assert.match(html,/<td>5\/2<\/td>/);assert.doesNotMatch(html,/do-not-publish-storage-identity|resourcePolicy|observanda-exact/);assert.equal(windows.length,3);assert.ok(windows.every(w=>w.limit<=4096));
});

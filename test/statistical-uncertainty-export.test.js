import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {retainedTable,retainedTableBlocks} from '../src/retained-tables.js';
import {retainedTableHTML} from '../src/publication-retained-tables.js';
import {retainedTableView,validRetainedTable} from '../src/web/retained-table-model.js';
import {statisticalUncertaintyContextText} from '../src/web/statistical-uncertainty-context.js';
import {defaultStructuredCalculationPolicy} from '../src/web/tools/calculation-policy.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {blankUnitDefinition,exactUnitScalar} from '../src/web/measurement-unit-model.js';
const ref={kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},definition={kind:'analysis',id:randomUUID(),revision:'b'.repeat(64)},analysis={kind:'analysis',id:randomUUID(),revision:'c'.repeat(64)};
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function fixture({approximate=true}={}){
 const policy=defaultStructuredCalculationPolicy(),unit={...blankUnitDefinition(),dimensions:[{axis:'length',exponent:1}]};policy.workingDigits=80;policy.rounding='half-even';
 const columns=['nominal','variance','standard'].map(role=>({...defaultColumn({label:role}),representation:role==='standard'&&approximate?'decimal':'rational',statisticalUncertainty:{version:1,method:'first-order-covariance-v1',role,definition,analysis,...(role==='standard'?{squareRoot:{engine:4,policy,approximate}}:{})},quantity:{origin:'derived',conversion:null,calibration:null,unitDefinition:{...unit,...(role==='nominal'?{kind:'absolute',offset:exactUnitScalar('3')}:{dimensions:[{axis:'length',exponent:role==='variance'?2:1}]})}}}));
 const rows=[{cells:['9/1','2/1',approximate?'1.4142135623730950488016887242096980785696718753769480731766797379907324784621070389':'2/1'],valueKinds:['string','string','string']}];
 return {columns,rows,read:async()=>({content:{rowCount:1,uncertainty:{version:1,definition,analysis}}}),datasetColumns:async()=>columns,async *iterateDataset(){yield* rows;},retainedSchemaPage:async(_,options)=>({items:columns.slice(options.offset,options.offset+options.limit),total:columns.length}),datasetPageCount:()=>1,retainedDatasetPage:async(_,page,{columns:indices})=>({columnIndices:indices,rows:rows.map(row=>({cells:indices.map(i=>row.cells[i]),valueKinds:indices.map(i=>row.valueKinds[i])}))})};
}
const selection={columns:[2,0,1],offset:0,count:1,includeExcluded:false};

test('uncertainty method, role and numerical policy follow selected columns in retained and paged readers',async()=>{
 const materials=fixture();
 for(const version of [1,2]){const table=await retainedTable(materials,{ref,version,selection});assert.equal(validRetainedTable(table),true);assert.match(table.headers[0],/combined standard uncertainty/);assert.match(table.headers[0],/80 working digits; half-even; mathjs/);assert.match(table.headers[1],/nominal value/);assert.match(table.headers[2],/combined variance/);assert.match(table.headers[2],/length\^2/);}
 const table=await retainedTable(materials,{ref,version:3,selection});let block;for await(const item of retainedTableBlocks(materials,{ref,table}))block=item.table;
 assert.deepEqual(block.formats.map(f=>f.statisticalUncertainty.role),['standard','nominal','variance']);const view=retainedTableView(block,esc);assert.match(view,/First-order covariance propagation/);assert.match(view,/Approximate square root; 80 working digits/);assert.ok(view.includes(materials.rows[0].cells[2]));
});

test('published uncertainty tables stream complete values and exclude private model identities and resource settings',async()=>{
 const materials=fixture(),long='7'.repeat(9001),cell={format:'dataset-cell',version:1,characters:long.length,sha256:'d'.repeat(64),parts:{format:1,kind:'cell-text',root:{count:1,height:1,hash:'e'.repeat(64),key:'f'.repeat(64)},count:1,chunkSize:16}},windows=[];materials.rows[0].cells[0]=cell;
 materials.readDatasetCell=async(selected,{offset,limit})=>{assert.deepEqual(selected,cell);windows.push({offset,limit});const text=long.slice(offset,offset+limit);return {text,next:offset+text.length<long.length?offset+text.length:null};};
 const table=await retainedTable(materials,{ref,version:3,selection:{...selection,columns:'all'}});let html='';for await(const part of retainedTableHTML(materials,{source:ref,table}))html+=part;
 assert.ok(html.includes('<td>'+long+'</td>'));assert.ok(html.includes(materials.rows[0].cells[2]));assert.match(html,/combined variance/);assert.match(html,/Approximate square root; 80 working digits; half-even; mathjs/);assert.match(html,/length\^2/);assert.equal(windows.length,3);assert.ok(windows.every(w=>w.limit<=4096));
 for(const privateValue of [ref.id,definition.id,analysis.id,definition.revision,analysis.revision,cell.sha256,cell.parts.root.key,'maxBits','resourcePolicy','statisticalUncertainty'])assert.ok(!html.includes(privateValue));
});

test('exact square roots stay exact and malformed method or approximation contexts are refused',()=>{
 const exact=fixture({approximate:false}).columns[2].statisticalUncertainty;assert.match(statisticalUncertaintyContextText(exact),/Exact square root/);assert.doesNotMatch(statisticalUncertaintyContextText(exact),/working digits|Approximate/);
 for(const value of [{...exact,method:'unqualified-method'},{...exact,role:'coverage'},{...exact,squareRoot:undefined},{...exact,squareRoot:{...exact.squareRoot,engine:3}},{...exact,squareRoot:{...exact.squareRoot,policy:{}}},{...exact,role:'variance'}])assert.throws(()=>statisticalUncertaintyContextText(value),RangeError);
});

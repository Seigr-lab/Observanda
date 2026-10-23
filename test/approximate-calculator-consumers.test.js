import {measurementUI} from '../src/web/measurement-ui.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {retainedTable,retainedTableBlocks} from '../src/retained-tables.js';
import {retainedTableView,validRetainedTable} from '../src/web/retained-table-model.js';
import {retainedTableHTML} from '../src/publication-retained-tables.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {calculatorRecipeView} from '../src/web/calculator-result-view.js';
import {defaultStructuredCalculationPolicy} from '../src/web/tools/calculation-policy.js';
import {STRUCTURED_CALCULATION_ENGINE} from '../src/web/tools/structured-calculation-model.js';
const ref={kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},recipe={kind:'analysis',id:randomUUID(),revision:'b'.repeat(64)};
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function fixture(){
 const columns=[{...defaultColumn({label:'Approximate <value>'}),representation:'decimal',computation:{version:1,kind:'approximate',recipe}},{...defaultColumn({label:'Derived'}),representation:'decimal',computation:{version:1,kind:'approximate-inputs'}},{...defaultColumn({label:'Exact'}),representation:'rational'}],cells=['1.414213562373095048801688724209698078569671875376948073176679738','-0','1/3'],row={cells,valueKinds:['number','number','number']};
 return {columns,cells,read:async()=>({content:{rowCount:1}}),datasetColumns:async()=>columns,async *iterateDataset(){yield row;},retainedSchemaPage:async(_,options)=>({items:columns.slice(options.offset,options.offset+options.limit),total:columns.length}),datasetPageCount:()=>1,retainedDatasetPage:async(_,page,{columns:indices})=>({columnIndices:indices,rows:[{...row,cells:indices.map(i=>cells[i]),valueKinds:indices.map(i=>row.valueKinds[i])}]})};
}
test('bounded legacy retained tables preserve exact spellings and computation labels without a new persisted shape',async()=>{
 const materials=fixture(),selection={columns:[0,1,2],offset:0,count:1,includeExcluded:false};
 for(const version of [1,2]){const table=await retainedTable(materials,{ref,selection,version});assert.equal(validRetainedTable(table),true);assert.deepEqual(table.rows[0].cells,materials.cells);assert.deepEqual(table.headers,['Approximate <value> [Approximate computation]','Derived [Computed from approximate inputs]','Exact']);const html=retainedTableView(table,esc);assert.match(html,/Approximate &lt;value&gt; \[Approximate computation\]/);assert.match(html,/Computed from approximate inputs/);assert.doesNotMatch(html,new RegExp(recipe.id));assert.equal(table.formats?.[0].computation,undefined);}
});
test('paged browser and frozen table HTML distinguish approximations while exporting every stored digit',async()=>{
 const materials=fixture(),table=await retainedTable(materials,{ref,selection:{columns:'all',offset:0,count:null,includeExcluded:false},version:3}),statement={source:ref,table};let block;
 for await(const value of retainedTableBlocks(materials,{ref,table}))block=value.table;
 assert.deepEqual(block.formats[0].computation,materials.columns[0].computation);assert.match(retainedTableView(block,esc),/Approximate computation/);let html='';for await(const text of retainedTableHTML(materials,statement))html+=text;
 assert.match(html,/Approximate &lt;value&gt; \[Approximate computation\]/);assert.match(html,/Computed from approximate inputs/);for(const value of materials.cells)assert.ok(html.includes('<td>'+value+'</td>'));assert.ok(html.includes('<th scope="col">Exact</th>'));assert.doesNotMatch(html,new RegExp(recipe.id));
});
test('recipe3 visibly pins approximation precision and rounding without relabelling recipe2',()=>{
 const policy=defaultStructuredCalculationPolicy();policy.workingDigits=90;policy.displayDigits=5;policy.rounding='ceiling';const saved={version:3,scope:'selected-expression',source:{workspaceId:randomUUID(),type:'calculation',id:randomUUID(),revision:1,entityHash:'c'.repeat(64)},expressionIndex:0,expression:'sqrt(2)',engine:4,angle:'rad',policy,library:policy.library,structuredEngine:STRUCTURED_CALCULATION_ENGINE};
 const content={tool:'Observanda calculator recipe',version:'3',recipe:saved},html=calculatorRecipeView(content,esc);assert.match(html,/Approximate computation/);assert.match(html,/complete computational decimal/);assert.match(html,/&quot;workingDigits&quot;: 90/);assert.match(html,/&quot;rounding&quot;: &quot;ceiling&quot;/);assert.match(html,/no error bound is inferred/);
 assert.doesNotMatch(calculatorRecipeView({...content,version:'2',recipe:{...saved,version:2,expression:'1/3'}},esc),/Approximate computation/);
});

test('measurement labels distinguish stored approximation encodings from exact source values',()=>{
 const value={version:1,value:{spelling:'1.414213562373095',representation:'decimal',radix:10,unit:'',presence:'value'},quantity:{origin:'derived',conversion:null,calibration:null},time:{kind:'none',reference:'',resolution:'',uncertainty:''},sources:[],references:{},decoderVersion:'',integrity:'unknown',completion:'unknown',note:''},ui=measurementUI({esc});
 for(const computation of [{version:1,kind:'approximate',recipe},{version:1,kind:'approximate-inputs'}]){const html=ui.view({...value,computation});assert.match(html,/Stored computational value/);assert.match(html,/Exact encoding of the stored approximation/);assert.doesNotMatch(html,/Exact source value|Exact decimal/);assert.match(html,/1\.414213562373095/);}
 const exact=ui.view(value);assert.match(exact,/Exact source value/);assert.match(exact,/Exact decimal/);assert.doesNotMatch(exact,/Stored computational value|Exact encoding of the stored approximation/);
});

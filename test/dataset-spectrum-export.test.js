import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {retainedTable,retainedTableBlocks} from '../src/retained-tables.js';
import {retainedTableHTML} from '../src/publication-retained-tables.js';
import {retainedTableView} from '../src/web/retained-table-model.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {defaultStructuredCalculationPolicy} from '../src/web/tools/calculation-policy.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {blankUnitDefinition,exactUnitScalar} from '../src/web/measurement-unit-model.js';
import {spectrumColumnDescriptor,SPECTRUM_CONVENTIONS} from '../src/web/dataset-spectrum-model.js';
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function fixture(){
 const source={kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},analysis={kind:'analysis',id:randomUUID(),revision:'b'.repeat(64)},text='1'+'0'.repeat(5000),h='c'.repeat(64),step={format:'dataset-cell',version:1,characters:text.length,sha256:h,parts:{format:1,kind:'cell-text',root:{count:1,hash:h,height:1,key:h},count:1,chunkSize:16}},recipe={version:1,method:'radix2-fft-v1',source,column:17,range:{start:5,count:8},sampling:{step:{...exactUnitScalar(),spelling:step},origin:exactUnitScalar('7'),unitDefinition:blankUnitDefinition(),coordinateColumn:null},calculationPolicy:defaultStructuredCalculationPolicy(),resourcePolicy:defaultDatasetResourcePolicy(),...SPECTRUM_CONVENTIONS};
 const column={...defaultColumn({label:'Normalized squared coefficient'}),representation:'rational',resourcePolicy:recipe.resourcePolicy,spectrum:spectrumColumnDescriptor(recipe,analysis,'normalized-squared-magnitude'),computation:{version:2,kind:'per-cell'}},rows=[{cells:['1/1'],valueKinds:['string'],cellComputations:[null]},{cells:['1/2'],valueKinds:['string'],cellComputations:[{version:1,kind:'approximate',recipe:analysis}]}],doc={content:{rowCount:2,spectrum:{version:1,analysis},privateNote:'Unpublished interpretation'}};
 return {source,analysis,text,step,column,doc,read:async()=>doc,datasetColumns:async()=>[column],retainedSchemaPage:async()=>({items:[column],total:1}),datasetPageCount:()=>1,retainedDatasetPage:async()=>({columnIndices:[0],rows}),readDatasetCell:async(value,{offset,limit})=>{assert.deepEqual(value,step);return {text:text.slice(offset,offset+limit),next:offset+limit<text.length?offset+limit:null};}};
}
test('published spectra retain the full sampling declaration and method without private source identifiers',async()=>{
 const materials=fixture(),table=await retainedTable(materials,{ref:materials.source,version:3,selection:{columns:'all',offset:0,count:null,includeExcluded:false}});let block;for await(const item of retainedTableBlocks(materials,{ref:materials.source,table}))block=item.table;
 let exported='';for await(const part of retainedTableHTML(materials,{source:materials.source,table}))exported+=part;
 assert.ok(exported.includes(materials.text));assert.ok(!JSON.stringify(block.formats[0].spectrum).includes(materials.analysis.id));
 for(const html of [retainedTableView(block,esc),exported]){assert.match(html,/Fourier|radix/i);assert.match(html,/Nyquist/i);assert.match(html,/selected sample|selected.*index/i);assert.match(html,/not.*(watts|power spectral)/i);assert.match(html,/64/);assert.match(html,/Exact computational value/);for(const privateValue of [materials.source.id,materials.analysis.id,materials.source.revision,'Unpublished interpretation'])assert.ok(!html.includes(privateValue));}
 await assert.rejects(retainedTable(materials,{ref:materials.source,version:2,selection:{columns:[0],offset:0,count:2,includeExcluded:false}}),{code:'DATASET_TABLE'});
});

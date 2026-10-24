import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {retainedTable,retainedTableBlocks} from '../src/retained-tables.js';
import {retainedTableHTML} from '../src/publication-retained-tables.js';
import {retainedTableView} from '../src/web/retained-table-model.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {defaultNumericalExecutionPolicy} from '../src/web/numerical-execution-policy.js';
import {blankUnitDefinition,exactUnitScalar} from '../src/web/measurement-unit-model.js';
import {cusumColumnDescriptor,CUSUM_METHOD,CUSUM_CONVENTIONS} from '../src/web/dataset-cusum-model.js';
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
test('published change detection keeps complete parameters and explicit interpretation without private references',async()=>{
 const source={kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},analysis={kind:'analysis',id:randomUUID(),revision:'b'.repeat(64)},text='1'+'0'.repeat(5000),h='c'.repeat(64),threshold={format:'dataset-cell',version:1,characters:text.length,sha256:h,parts:{format:1,kind:'cell-text',root:{count:1,hash:h,height:1,key:h},count:1,chunkSize:16}},resourcePolicy=defaultDatasetResourcePolicy(),executionPolicy=defaultNumericalExecutionPolicy();
 const recipe={version:1,method:CUSUM_METHOD,source,column:20,range:{start:79,count:1024},target:exactUnitScalar('0'),allowance:exactUnitScalar('1'),threshold:{...exactUnitScalar(),spelling:threshold},unitDefinition:blankUnitDefinition(),gaps:'reset-both',afterSignal:'continue',resourcePolicy,executionPolicy,...CUSUM_CONVENTIONS};
 const column={...defaultColumn({label:'Upper accumulation'}),representation:'rational',resourcePolicy,cusum:cusumColumnDescriptor(recipe,analysis,'upper-score'),computation:{version:2,kind:'per-cell'}},rows=[{cells:['0/1'],valueKinds:['string'],cellComputations:[null]},{cells:['3/1'],valueKinds:['string'],cellComputations:[{version:1,kind:'approximate-inputs'}]}],doc={content:{rowCount:2,cusums:1,cusum:{version:1,analysis},privateNote:'Unpublished interpretation'}};
 const materials={read:async()=>doc,datasetColumns:async()=>[column],retainedSchemaPage:async()=>({items:[column],total:1}),datasetPageCount:()=>1,retainedDatasetPage:async()=>({columnIndices:[0],rows}),readDatasetCell:async(value,{offset,limit})=>{assert.deepEqual(value,threshold);return {text:text.slice(offset,offset+limit),next:offset+limit<text.length?offset+limit:null};}};
 const table=await retainedTable(materials,{ref:source,version:3,selection:{columns:'all',offset:0,count:null,includeExcluded:false}});let block;for await(const item of retainedTableBlocks(materials,{ref:source,table}))block=item.table;
 assert.equal(block.formats[0].cusum.analysis,undefined);assert.equal(block.formats[0].cusum.count,1024);assert.deepEqual(block.formats[0].cusum.threshold.spelling,threshold);assert.deepEqual(block.formats[0].cusum.executionPolicy,executionPolicy);
 let exported='';for await(const part of retainedTableHTML(materials,{source,table}))exported+=part;assert.ok(exported.includes(text));
 for(const html of [retainedTableView(block,esc),exported]){assert.match(html,/CUSUM|cumulative sum/i);assert.match(html,/threshold/i);assert.match(html,/retained/i);assert.match(html,/physical|significance|probability/i);for(const secret of [source.id,source.revision,analysis.id,analysis.revision,'Unpublished interpretation','commandHash','reservation'])assert.equal(html.includes(secret),false,secret);}
 await assert.rejects(retainedTable(materials,{ref:source,version:2,selection:{columns:[0],offset:0,count:2,includeExcluded:false}}),{code:'DATASET_TABLE'});
});

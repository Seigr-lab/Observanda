import test from 'node:test';
import assert from 'node:assert/strict';
import {ResearchMaterials} from '../src/research-materials.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {defaultDomain} from '../src/web/measurement-domain-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
function fixture({domainValues=0,scalarPolicies=1}={}){
 const policy=defaultDatasetResourcePolicy(),columns=Array.from({length:33},(_,i)=>({...defaultColumn({label:'Reading '+i}),representation:'integer',resourcePolicy:structuredClone(policy)})),cells=columns.map(()=>({kind:'string',value:'3'})),reads=[];
 const doc={content:{datasetFormat:3,scalarPolicies,domainValues,schemaIndex:{count:columns.length}}};
 const materials={workspace:{},async *iterateDatasetCells(){yield* cells;},async retainedSchemaPage(_,options){reads.push(options);return {items:columns.slice(options.offset,options.offset+options.limit)};},datasetColumn:ResearchMaterials.prototype.datasetColumn};
 return {columns,cells,reads,verify:()=>ResearchMaterials.prototype.verifyDatasetRow.call(materials,doc,{})};
}
test('row verification reads bounded schema pages once for scalar and domain declarations',async()=>{
 for(const domainValues of [0,1]){const f=fixture({domainValues});await f.verify();assert.deepEqual(f.reads,[{offset:0,limit:16},{offset:16,limit:16},{offset:32,limit:16}]);}
});
test('row verification enforces the selected column policy beyond the first schema page',async()=>{
 const f=fixture();f.columns[32].resourcePolicy.resources.maxBits=64;f.cells[32].value='1'+'0'.repeat(30);await assert.rejects(f.verify(),{code:'DATASET_CALCULATION_RESOURCE'});
 const valid=fixture();valid.cells[32].value='1'+'0'.repeat(30);await valid.verify();
});
test('row verification rejects missing columns, malformed cells and undeclared domain values',async()=>{
 const missing=fixture();missing.columns.pop();await assert.rejects(missing.verify());
 const malformed=fixture();malformed.cells[32].kind='unknown';await assert.rejects(malformed.verify(),{code:'MATERIAL_MISSING'});
 const domain=fixture();domain.cells[32].value={format:'domain-value',version:1,definition:defaultDomain(),original:'[1,2]',components:null,identity:null,complete:false};await assert.rejects(domain.verify(),{code:'MATERIAL_MISSING'});
 const extra=fixture();extra.cells.push({kind:'string',value:'3'});await assert.rejects(extra.verify());
 const short=fixture();short.cells.pop();await assert.rejects(short.verify(),{code:'MATERIAL_MISSING'});
});

test('paged verification preserves declared domain identity with and without scalar policies',async()=>{
 for(const scalarPolicies of [0,1]){
  const f=fixture({domainValues:1,scalarPolicies}),definition={...defaultDomain(),codec:'example.opaque'};
  f.columns[32]={...defaultColumn({label:'Opaque domain'}),representation:'domain',domain:definition};f.cells[32]={kind:'string',value:{format:'domain-value',version:1,definition:structuredClone(definition),original:'[1,2]',components:null,identity:null,complete:false}};
  await f.verify();assert.equal(f.reads.length,3);
  f.cells[32].value.definition.namespace='different';await assert.rejects(f.verify(),{code:'MATERIAL_MISSING'});
  f.cells[32].value='[1,2]';await assert.rejects(f.verify(),{code:'MATERIAL_MISSING'});
 }
});

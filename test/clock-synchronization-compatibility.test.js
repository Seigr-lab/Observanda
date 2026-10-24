import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {configurationCatalogueFeatures,configurationCatalogueGeneration,CATALOGUE_MAX_GENERATION,catalogueRequiresClockSynchronization,catalogueRequiresApproximateCalculator,restoreConfigurationCatalogueFormat} from '../src/catalogue-format.js';
import {clockSynchronizationMetadata} from '../src/clock-synchronization-format.js';
import {domainAlgebraMetadata} from '../src/domain-algebra-format.js';
import {measurementScalarMetadata} from '../src/measurement-scalar-format.js';
import {validGraphNode,validGraphCalculation} from '../src/web/dataset-calculation-graph-model.js';
import {materialRequest} from '../src/material-requests.js';
const base={website:0,staged:false,owners:0,publication:false,transfers:false};
test('clock synchronization and approximation decode independently in either feature order',async()=>{
 for(const approximateCalculator of [false,true])for(const clockSynchronization of [false,true]){
  const features={...base,approximateCalculator,clockSynchronization},format=configurationCatalogueGeneration(features);assert.equal(catalogueRequiresClockSynchronization(format),clockSynchronization);assert.equal(catalogueRequiresApproximateCalculator(format),approximateCalculator);assert.deepEqual(configurationCatalogueFeatures(format),{...base,...(approximateCalculator?{approximateCalculator:true}:{}),...(clockSynchronization?{clockSynchronization:true}:{})});
  let stored=122;const db={all:async()=>[{version:String(stored)}],get:async()=>null,run:async(sql,...values)=>{if(sql.startsWith('UPDATE catalogue_format'))stored=values[0];}};await restoreConfigurationCatalogueFormat(db,format);assert.equal(stored,format);
 }
 const all=Object.fromEntries(Object.keys(configurationCatalogueFeatures(CATALOGUE_MAX_GENERATION)).map(key=>[key,key==='website'?3:key==='owners'?2:true]));assert.equal(configurationCatalogueGeneration(all),CATALOGUE_MAX_GENERATION);assert.equal(configurationCatalogueFeatures(CATALOGUE_MAX_GENERATION+1),null);
});
test('graph9 and recipe12 preserve earlier node admission while new nodes require explicit upgrade',()=>{
 const ref={kind:'analysis',id:randomUUID(),revision:'a'.repeat(64)},node={id:randomUUID(),kind:'clock-synchronize',binding:{id:randomUUID(),position:0},column:17,model:ref,operation:'value',outside:'absent'};
 for(let version=1;version<=8;version++)assert.equal(validGraphNode(node,0,version),false);assert.equal(validGraphNode(node,0,9),true);assert.equal(validGraphNode({...node,model:{...ref,kind:'dataset'}},0,9),false);assert.equal(validGraphNode({...node,outside:'extrapolate'},0,9),false);for(const version of [12,13,14,15])assert.equal(validGraphCalculation({version,graph:ref}),true);assert.equal(validGraphCalculation({version:16,graph:ref}),false);
 assert.equal(materialRequest('/api/research/materials/clock-synchronization-save').write,true);assert.equal(materialRequest('/api/research/materials/clock-synchronization-read').write,false);
});
test('metadata admission covers direct models, inherited graph semantics, queued schemas and lineage without scanning arbitrary text',()=>{
 const object='.observanda/materials/objects/id/revision.json',chunk='.observanda/materials/sequences/chunks/hash.json',job='.observanda/jobs/id.json',graph={content:{tool:'Observanda calculation graph',graphVersion:9}},model={content:{tool:'Observanda clock synchronization'}};
 assert.equal(clockSynchronizationMetadata(object,model),true);assert.equal(clockSynchronizationMetadata(object,graph),true);assert.equal(domainAlgebraMetadata(object,graph),true);assert.equal(measurementScalarMetadata(object,graph),true);assert.equal(measurementScalarMetadata(object,model),true);
 for(const value of [{kind:'columns-policy',items:[{synchronization:{}}]},{kind:'calculation-nodes',items:[{kind:'clock-synchronize'}]},{kind:'calculation-lineage',items:[{synchronization:{node:{}}}]}])assert.equal(clockSynchronizationMetadata(chunk,value),true);
 assert.equal(clockSynchronizationMetadata(job,{input:{command:{calculation:{version:12}}}}),true);assert.equal(clockSynchronizationMetadata(job,{input:{command:{columnChanges:[{index:17,column:{synchronization:{}}}]}}}),true);assert.equal(clockSynchronizationMetadata(object,{content:{note:JSON.stringify(model)}}),false);assert.equal(clockSynchronizationMetadata('.observanda/custom/a.json',model),false);assert.equal(clockSynchronizationMetadata(chunk,{kind:'cells',items:[{synchronization:{}}]}),false);
});

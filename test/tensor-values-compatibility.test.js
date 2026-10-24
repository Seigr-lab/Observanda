import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {configurationCatalogueFeatures,configurationCatalogueGeneration,CATALOGUE_MAX_GENERATION,catalogueRequiresTensorValues,catalogueRequiresClockSynchronization,catalogueRequiresApproximateCalculator,restoreConfigurationCatalogueFormat} from '../src/catalogue-format.js';
import {tensorValuesMetadata} from '../src/tensor-values-format.js';
import {clockSynchronizationMetadata} from '../src/clock-synchronization-format.js';
import {domainAlgebraMetadata} from '../src/domain-algebra-format.js';
import {measurementScalarMetadata} from '../src/measurement-scalar-format.js';
import {validGraphNode,validGraphCalculation} from '../src/web/dataset-calculation-graph-model.js';
import {CalculationGraphs} from '../src/calculation-graphs.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {defaultDomain,knownDomain,validDomainDefinition} from '../src/web/measurement-domain-model.js';
import {MaterialSequence} from '../src/material-sequence.js';
import {retainDomainValue,domainValuePage,verifyDomainValue} from '../src/measurement-domain-storage.js';
const base={website:0,staged:false,owners:0,publication:false,transfers:false};
test('tensor, clock and approximate capabilities decode independently and restore in every combination',async()=>{
 for(const approximateCalculator of [false,true])for(const clockSynchronization of [false,true])for(const tensorValues of [false,true]){
  const features={...base,approximateCalculator,clockSynchronization,tensorValues},format=configurationCatalogueGeneration(features);assert.equal(catalogueRequiresTensorValues(format),tensorValues);assert.equal(catalogueRequiresClockSynchronization(format),clockSynchronization);assert.equal(catalogueRequiresApproximateCalculator(format),approximateCalculator);assert.deepEqual(configurationCatalogueFeatures(format),{...base,...(approximateCalculator?{approximateCalculator:true}:{}),...(clockSynchronization?{clockSynchronization:true}:{}),...(tensorValues?{tensorValues:true}:{})});
  let stored=122;const db={all:async()=>[{version:String(stored)}],get:async()=>null,run:async(sql,...values)=>{if(sql.startsWith('UPDATE catalogue_format'))stored=values[0];}};await restoreConfigurationCatalogueFormat(db,format);assert.equal(stored,format);
 }
 const all=Object.fromEntries(Object.keys(configurationCatalogueFeatures(CATALOGUE_MAX_GENERATION)).map(key=>[key,key==='website'?3:key==='owners'?2:true]));assert.equal(configurationCatalogueGeneration(all),CATALOGUE_MAX_GENERATION);assert.equal(configurationCatalogueFeatures(CATALOGUE_MAX_GENERATION+1),null);
});
test('historical tensor codec labels remain opaque in both previous declaration generations',async()=>{
 const data=new Map(),workspace={readMetadata:async key=>data.get(key)??null,writeMetadata:async(key,value)=>data.set(key,value)},materials={workspace,sequences:new MaterialSequence(workspace)};
 for(const version of [1,2]){const definition={...defaultDomain('vector'),version,codec:'observanda.tensor',shape:[2,2,2],...(version===2?{resourcePolicy:defaultDatasetResourcePolicy()}:{})};assert.equal(validDomainDefinition(definition),true);assert.equal(knownDomain(definition),false);const cell=await retainDomainValue(materials,{kind:'string',value:'Historical opaque text, deliberately not JSON'},definition,fn=>fn());assert.equal(cell.version,version===1?1:3);assert.equal(cell.components,null);assert.equal(cell.identity,null);assert.equal((await domainValuePage(materials,cell)).supported,false);await verifyDomainValue(materials,cell);assert.equal(tensorValuesMetadata('.observanda/materials/sequences/chunks/x',{kind:'columns-policy',items:[{representation:'domain',domain:definition}]}),false);}
});
test('reshape and tensor declarations require graph10 and exact positive target cardinality',async()=>{
 const node={id:randomUUID(),kind:'domain-reshape',left:{id:randomUUID(),position:0},shape:[2,2,2]};for(let version=1;version<10;version++)assert.equal(validGraphNode(node,1,version),false);assert.equal(validGraphNode(node,1,10),true);for(const shape of [[],[0],[-1],[1.5],Array(17).fill(1),[Number.MAX_SAFE_INTEGER,2]])assert.equal(validGraphNode({...node,shape},1,10),false);
 const ref={kind:'analysis',id:randomUUID(),revision:'a'.repeat(64)};assert.equal(validGraphCalculation({version:13,graph:ref}),true);assert.equal(validGraphCalculation({version:14,graph:ref}),true);assert.equal(validGraphCalculation({version:15,graph:ref}),false);const column={representation:'domain',domain:{...defaultDomain('tensor'),resourcePolicy:defaultDatasetResourcePolicy()}};
 for(let graphVersion=2;graphVersion<=9;graphVersion++)await assert.rejects(new CalculationGraphs({sequences:{}}).declaration(column,{graphVersion}),{code:'DATASET_CALCULATION'});
});
test('new metadata admits tensor generation without treating historical codec text as new evidence',()=>{
 const object='.observanda/materials/objects/id/revision.json',chunk='.observanda/materials/sequences/chunks/hash.json',job='.observanda/jobs/id.json',graph={content:{tool:'Observanda calculation graph',graphVersion:10}},column={representation:'domain',domain:{version:3,codec:'observanda.tensor'}};
 for(const classify of [tensorValuesMetadata,clockSynchronizationMetadata,domainAlgebraMetadata,measurementScalarMetadata])assert.equal(classify(object,graph),true);
 for(const value of [{kind:'columns-policy',items:[column]},{kind:'cells',items:[{value:{format:'domain-value',version:4}}]},{kind:'calculation-nodes',items:[{kind:'domain-reshape'}]}])assert.equal(tensorValuesMetadata(chunk,value),true);
 assert.equal(tensorValuesMetadata(job,{input:{command:{calculation:{version:13}}}}),true);assert.equal(tensorValuesMetadata(job,{input:{command:{columnChanges:[{index:4,column}]}}}),true);assert.equal(tensorValuesMetadata(object,{content:{note:JSON.stringify(column)}}),false);assert.equal(tensorValuesMetadata('.observanda/custom/a.json',graph),false);assert.equal(tensorValuesMetadata(chunk,{kind:'cells',items:[column]}),false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {configurationCatalogueFeatures,configurationCatalogueGeneration,CATALOGUE_MAX_GENERATION,catalogueFormat,restoreConfigurationCatalogueFormat,requirePairedStatistics,requireAxisPermutation,catalogueRequiresPairedStatistics,catalogueRequiresAxisPermutation} from '../src/catalogue-format.js';
import {pairedStatisticsMaterial,pairedStatisticsCommand,pairedStatisticsMetadata,assertPairedStatisticsFormat} from '../src/paired-statistics-format.js';
import {quantileAggregationMetadata} from '../src/quantile-aggregation-format.js';
import {measurementScalarMetadata} from '../src/measurement-scalar-format.js';
import {datasetResourceMetadata} from '../src/dataset-resource-format.js';
const base={website:0,staged:false,owners:0,publication:false,transfers:false};
function database(format=122){let stored=format;const statements=[],db={all:async()=>[{version:String(stored)}],get:async()=>null,run:async(sql,...values)=>{statements.push(sql);if(sql.startsWith('UPDATE catalogue_format'))stored=values[0];}};return {db,statements,get format(){return stored;}};}
const complete={...base,pairedStatistics:true,quantileAggregation:true,measurementScalarPolicies:true,datasetResourcePolicies:true};
const workspace=format=>({storageKind:()=> 'catalogue',catalogue:async operation=>operation({catalogueDb:database(format).db})});
test('paired statistics and previous feature bits remain independent through every selected combination and restoration',async()=>{
 for(const pairedStatistics of [false,true])for(const axisPermutation of [false,true])for(const quantileAggregation of [false,true])for(const tensorValues of [false,true])for(const clockSynchronization of [false,true]){
  const flags={pairedStatistics,axisPermutation,quantileAggregation,tensorValues,clockSynchronization},features={...base,...flags},format=configurationCatalogueGeneration(features),expected={...base,...Object.fromEntries(Object.entries(flags).filter(([,enabled])=>enabled))};assert.deepEqual(configurationCatalogueFeatures(format),expected);
  const copy=database();await restoreConfigurationCatalogueFormat(copy.db,format);assert.equal(copy.format,format);assert.equal(await catalogueFormat(copy.db),format);
 }
 const priorMaximum=51539607673;assert.equal(catalogueRequiresPairedStatistics(priorMaximum),false);assert.equal(catalogueRequiresAxisPermutation(priorMaximum),true);assert.equal(configurationCatalogueGeneration({...base,pairedStatistics:true}),51539607674);assert.equal(catalogueRequiresAxisPermutation(51539607674),false);
 const all=Object.fromEntries(Object.keys(configurationCatalogueFeatures(CATALOGUE_MAX_GENERATION)).map(key=>[key,key==='website'?3:key==='owners'?2:true]));assert.equal(configurationCatalogueGeneration(all),103079215225);assert.equal(CATALOGUE_MAX_GENERATION,103079215225);assert.equal(configurationCatalogueFeatures(CATALOGUE_MAX_GENERATION+1),null);assert.equal(configurationCatalogueFeatures(String(CATALOGUE_MAX_GENERATION)),null);
 assert.throws(()=>configurationCatalogueGeneration({...base,pairedStatistics:1}),{code:'INVALID'});await assert.rejects(catalogueFormat(database(CATALOGUE_MAX_GENERATION+1).db),{code:'CATALOGUE_DAMAGED'});
});
test('paired and axis upgrades preserve owners in either order and repeated admission is idempotent',async()=>{
 const original={...complete,pairedStatistics:false,website:3,staged:true,owners:2,publication:true,transfers:true},format=configurationCatalogueGeneration(original);
 for(const functions of [[requirePairedStatistics,requireAxisPermutation],[requireAxisPermutation,requirePairedStatistics]]){
  const store=database(format);for(const require of functions)await require(store.db);assert.deepEqual(configurationCatalogueFeatures(store.format),{...original,pairedStatistics:true,axisPermutation:true});const before=store.statements.length;await requirePairedStatistics(store.db);assert.equal(store.statements.length,before);assert.ok(store.statements.some(sql=>sql.includes('version TYPE bigint')));assert.ok(store.statements.some(sql=>sql.includes('CHECK(version BETWEEN 3 AND 103079215225)')));
  const restored=database();await restoreConfigurationCatalogueFormat(restored.db,store.format);assert.equal(restored.format,store.format);
 }
 const locked=database(format),run=locked.db.run;locked.db.run=async(sql,...values)=>{if(sql.startsWith('LOCK TABLE'))throw Object.assign(Error('busy'),{code:'55P03'});return run(sql,...values);};await assert.rejects(requirePairedStatistics(locked.db),{code:'LOCKED'});assert.equal(locked.format,format);
});
test('paired admission requires inherited quantile, scalar and resource owners and refuses old readers',async()=>{
 await assertPairedStatisticsFormat(workspace(configurationCatalogueGeneration(complete)));await assertPairedStatisticsFormat({});
 for(const missing of ['pairedStatistics','quantileAggregation','measurementScalarPolicies','datasetResourcePolicies'])await assert.rejects(assertPairedStatisticsFormat(workspace(configurationCatalogueGeneration({...complete,[missing]:false}))),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(assertPairedStatisticsFormat(workspace(51539607673)),{code:'CATALOGUE_DAMAGED'});
});
test('paired recipe, queued command, checkpoint and row receipt are recognized without reinterpreting older recipes',()=>{
 const object='.observanda/materials/objects/id/revision.json',job='.observanda/jobs/id.json',checkpoint='.observanda/materials/aggregation-work/id.json',table='.observanda/materials/tables/hash.json',doc={content:{aggregation:{version:5}}},command={aggregation:{version:5}},row={aggregation:[{included:2,excluded:0,missing:0,total:2,pairedStatistic:{version:1,method:'centered-pairs-v1',pairing:'complete-rows-v1',status:'ready'}}]};
 assert.equal(pairedStatisticsMaterial(doc),true);assert.equal(pairedStatisticsCommand(command),true);assert.equal(pairedStatisticsMetadata(checkpoint,{version:5}),true);assert.equal(pairedStatisticsMetadata(table,[row]),true);
 for(const classify of [pairedStatisticsMetadata,quantileAggregationMetadata,measurementScalarMetadata,datasetResourceMetadata]){assert.equal(classify(object,doc),true);assert.equal(classify(job,{input:{command}}),true);}
 assert.equal(quantileAggregationMetadata(checkpoint,{version:5}),true);
 for(const version of [1,2,3,4,6]){assert.equal(pairedStatisticsMaterial({content:{aggregation:{version,values:[{operation:'covariance'}]}}}),false);assert.equal(pairedStatisticsCommand({aggregation:{version}}),false);assert.equal(pairedStatisticsMetadata(checkpoint,{version}),false);}
 assert.equal(pairedStatisticsMetadata(table,[{aggregation:[{quantile:null}]}]),false);assert.equal(pairedStatisticsMetadata(table,[null,{aggregation:{pairedStatistic:true}}]),false);assert.equal(pairedStatisticsMetadata('.observanda/custom/id',doc),false);assert.equal(pairedStatisticsMetadata(job,doc),false);assert.equal(pairedStatisticsMaterial({content:{graphVersion:11,tool:'Observanda calculation graph'}}),false);
});

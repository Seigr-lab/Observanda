import test from 'node:test';
import assert from 'node:assert/strict';
import {CATALOGUE_MAX_GENERATION,configurationCatalogueFeatures,configurationCatalogueGeneration,catalogueFormat,restoreConfigurationCatalogueFormat,requireSegmentedClockSynchronization,requireStatisticalUncertainty,catalogueRequiresSegmentedClockSynchronization,catalogueRequiresStatisticalUncertainty} from '../src/catalogue-format.js';
import {segmentedClockSynchronizationCommand,segmentedClockSynchronizationMaterial,segmentedClockSynchronizationMetadata,assertSegmentedClockSynchronizationFormat} from '../src/segmented-clock-synchronization-format.js';
import {clockSynchronizationMetadata} from '../src/clock-synchronization-format.js';
import {axisPermutationMetadata} from '../src/axis-permutation-format.js';
import {tensorValuesMetadata} from '../src/tensor-values-format.js';
import {domainAlgebraMetadata} from '../src/domain-algebra-format.js';
import {measurementScalarMetadata} from '../src/measurement-scalar-format.js';
import {datasetResourceMetadata} from '../src/dataset-resource-format.js';
import {windowCalculationMetadata} from '../src/dataset-window-format.js';
const base={website:0,staged:false,owners:0,publication:false,transfers:false};
const inherited={clockSynchronization:true,measurementScalarPolicies:true,datasetResourcePolicies:true};
function database(format=122){let stored=format;const statements=[],db={all:async()=>[{version:String(stored)}],get:async()=>null,run:async(sql,...values)=>{statements.push(sql);if(sql.startsWith('UPDATE catalogue_format'))stored=values[0];}};return {db,statements,get format(){return stored;}};}
const workspace=flags=>({storageKind:()=> 'catalogue',catalogue:operation=>operation({catalogueDb:database(configurationCatalogueGeneration({...base,...flags})).db})});

test('segmented clocks retain independent uncertainty and owner flags across the next catalogue boundary',async()=>{
 for(const website of [0,1,2,3])for(const staged of [false,true])for(const owners of [0,1,2])for(const publication of [false,true])for(const transfers of [false,true])for(const segmentedClockSynchronization of [false,true])for(const statisticalUncertainty of [false,true]){
  const flags={...base,website,staged,owners,publication,transfers,...inherited,...(segmentedClockSynchronization?{segmentedClockSynchronization:true}:{}),...(statisticalUncertainty?{statisticalUncertainty:true}:{})},format=configurationCatalogueGeneration(flags);
  assert.deepEqual(configurationCatalogueFeatures(format),flags);const restored=database();await restoreConfigurationCatalogueFormat(restored.db,format);assert.equal(restored.format,format);assert.equal(await catalogueFormat(restored.db),format);
 }
 const previous=206158430329,first=206158430330;assert.equal(catalogueRequiresSegmentedClockSynchronization(previous),false);assert.equal(catalogueRequiresStatisticalUncertainty(previous),true);assert.equal(configurationCatalogueGeneration({...base,segmentedClockSynchronization:true}),first);assert.equal(catalogueRequiresStatisticalUncertainty(first),false);assert.deepEqual(configurationCatalogueFeatures(first),{...base,segmentedClockSynchronization:true});
 const maximum=configurationCatalogueFeatures(CATALOGUE_MAX_GENERATION);assert.equal(CATALOGUE_MAX_GENERATION,1649267441785);assert.equal(configurationCatalogueGeneration(maximum),CATALOGUE_MAX_GENERATION);assert.equal(maximum.segmentedClockSynchronization,true);assert.equal(maximum.statisticalUncertainty,true);
 for(const invalid of [CATALOGUE_MAX_GENERATION+1,NaN,Infinity,122.5,String(first)])assert.equal(configurationCatalogueFeatures(invalid),null);
 assert.throws(()=>configurationCatalogueGeneration({...base,segmentedClockSynchronization:1}),{code:'INVALID'});await assert.rejects(catalogueFormat(database(CATALOGUE_MAX_GENERATION+1).db),{code:'CATALOGUE_DAMAGED'});
});

test('segmented and uncertainty upgrades remain independent, idempotent and refuse an unavailable write lock',async()=>{
 for(const upgrades of [[requireSegmentedClockSynchronization,requireStatisticalUncertainty],[requireStatisticalUncertainty,requireSegmentedClockSynchronization]]){
  const original={...base,website:3,staged:true,owners:2,publication:true,transfers:true,...inherited},store=database(configurationCatalogueGeneration(original));for(const upgrade of upgrades)await upgrade(store.db);
  assert.deepEqual(configurationCatalogueFeatures(store.format),{...original,statisticalUncertainty:true,segmentedClockSynchronization:true});const before=store.statements.length;await requireSegmentedClockSynchronization(store.db);assert.equal(store.statements.length,before);
 }
 const locked=database(),run=locked.db.run;locked.db.run=async(sql,...values)=>{if(sql.startsWith('LOCK TABLE'))throw Object.assign(Error('busy'),{code:'55P03'});return run(sql,...values);};await assert.rejects(requireSegmentedClockSynchronization(locked.db),{code:'LOCKED'});assert.equal(locked.format,122);
});

test('segmented reads require all inherited clock and resource interpretations',async()=>{
 const complete={...inherited,segmentedClockSynchronization:true};await assertSegmentedClockSynchronizationFormat(workspace(complete));await assertSegmentedClockSynchronizationFormat({});
 for(const missing of Object.keys(complete))await assert.rejects(assertSegmentedClockSynchronizationFormat(workspace({...complete,[missing]:false})),{code:'CATALOGUE_DAMAGED'});
});

test('owned segmented metadata requires admission while earlier graphs and authored text retain their meaning',()=>{
 const object='.observanda/materials/objects/id/revision.json',job='.observanda/jobs/id.json',chunk='.observanda/materials/sequences/chunks/hash.json',descriptor={version:2,method:'segmented-piecewise-affine-v1'};
 for(const content of [{tool:'Observanda clock synchronization',version:2},{tool:'Observanda calculation graph',graphVersion:12},{segmentedClockSynchronization:1},{measurement:{synchronization:descriptor}}]){const value={content};assert.equal(segmentedClockSynchronizationMaterial(value),true);assert.equal(segmentedClockSynchronizationMetadata(object,value),true);assert.equal(segmentedClockSynchronizationMetadata('.observanda/custom/id',value),false);}
 for(const command of [{calculation:{version:15}},{columns:[{synchronization:descriptor}]},{columnChanges:[{index:18,column:{synchronization:descriptor}}]}]){assert.equal(segmentedClockSynchronizationCommand(command),true);assert.equal(segmentedClockSynchronizationMetadata(job,{input:{command}}),true);}
 for(const kind of ['clock-sync-segments','clock-sync-anchors'])assert.equal(segmentedClockSynchronizationMetadata(chunk,{kind,items:[]}),true);
 for(const kind of ['columns','columns-policy','calculation-lineage'])assert.equal(segmentedClockSynchronizationMetadata(chunk,{kind,items:[{synchronization:descriptor}]}),true);
 for(const content of [{tool:'Observanda clock synchronization',version:1},{tool:'Observanda calculation graph',graphVersion:11},{calculation:{version:14}},{measurement:{synchronization:{version:1}}},{note:JSON.stringify(descriptor)}])assert.equal(segmentedClockSynchronizationMetadata(object,{content}),false);
 assert.equal(segmentedClockSynchronizationMetadata(chunk,{kind:'cells',items:[{synchronization:descriptor}]}),false);
 for(const outputExcluded of [false,true])assert.equal(segmentedClockSynchronizationMetadata('.observanda/materials/tables/rows.json',[{calculationLineage:{version:1,outputExcluded}}]),true);
 assert.equal(segmentedClockSynchronizationMetadata('.observanda/materials/tables/rows.json',[{calculationLineage:{version:1}}]),false);
 assert.equal(segmentedClockSynchronizationMetadata('.observanda/custom/rows.json',[{calculationLineage:{outputExcluded:true}}]),false);
 for(const classify of [clockSynchronizationMetadata,axisPermutationMetadata,tensorValuesMetadata,domainAlgebraMetadata,measurementScalarMetadata,datasetResourceMetadata,windowCalculationMetadata]){
  assert.equal(classify(object,{content:{tool:'Observanda calculation graph',graphVersion:12}}),true);
  assert.equal(classify(object,{content:{calculation:{version:15}}}),true);
  assert.equal(classify(job,{input:{command:{calculation:{version:15}}}}),true);
 }
});

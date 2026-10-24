import test from 'node:test';
import assert from 'node:assert/strict';
import {CATALOGUE_MAX_GENERATION,configurationCatalogueFeatures,configurationCatalogueGeneration,catalogueFormat,restoreConfigurationCatalogueFormat,requireStatisticalUncertainty,requirePairedStatistics,catalogueRequiresStatisticalUncertainty,catalogueRequiresPairedStatistics} from '../src/catalogue-format.js';
import {statisticalUncertaintyMaterial,statisticalUncertaintyCommand,statisticalUncertaintyMetadata,assertStatisticalUncertaintyFormat} from '../src/statistical-uncertainty-format.js';
const base={website:0,staged:false,owners:0,publication:false,transfers:false};
const inherited={nativeNumericalModels:true,measurementScalarPolicies:true,datasetResourcePolicies:true,structuredCalculator:true,approximateCalculator:true};
function database(format=122){let stored=format;const statements=[],db={all:async()=>[{version:String(stored)}],get:async()=>null,run:async(sql,...values)=>{statements.push(sql);if(sql.startsWith('UPDATE catalogue_format'))stored=values[0];}};return {db,statements,get format(){return stored;}};}
const workspace=flags=>({storageKind:()=> 'catalogue',catalogue:operation=>operation({catalogueDb:database(configurationCatalogueGeneration({...base,...flags})).db})});

test('uncertainty admission preserves prior owners and independent numerical flags across int8 boundaries',async()=>{
 for(const website of [0,1,2,3])for(const staged of [false,true])for(const owners of [0,1,2])for(const publication of [false,true])for(const transfers of [false,true])for(const statisticalUncertainty of [false,true])for(const pairedStatistics of [false,true]){
  const flags={...base,website,staged,owners,publication,transfers,...inherited,...(statisticalUncertainty?{statisticalUncertainty:true}:{}),...(pairedStatistics?{pairedStatistics:true}:{})},format=configurationCatalogueGeneration(flags);
  assert.deepEqual(configurationCatalogueFeatures(format),flags);const restored=database();await restoreConfigurationCatalogueFormat(restored.db,format);assert.equal(restored.format,format);assert.equal(await catalogueFormat(restored.db),format);
 }
 const previousMaximum=103079215225,first=103079215226;assert.equal(catalogueRequiresStatisticalUncertainty(previousMaximum),false);assert.equal(catalogueRequiresPairedStatistics(previousMaximum),true);assert.equal(configurationCatalogueGeneration({...base,statisticalUncertainty:true}),first);assert.equal(catalogueRequiresPairedStatistics(first),false);assert.deepEqual(configurationCatalogueFeatures(first),{...base,statisticalUncertainty:true});
 const maximum=configurationCatalogueFeatures(CATALOGUE_MAX_GENERATION);assert.equal(configurationCatalogueGeneration({...maximum,segmentedClockSynchronization:false}),206158430329);assert.equal(configurationCatalogueGeneration(maximum),CATALOGUE_MAX_GENERATION);assert.equal(maximum.statisticalUncertainty,true);assert.equal(maximum.pairedStatistics,true);
 for(const invalid of [CATALOGUE_MAX_GENERATION+1,NaN,Infinity,122.5,String(first)])assert.equal(configurationCatalogueFeatures(invalid),null);
 assert.throws(()=>configurationCatalogueGeneration({...base,statisticalUncertainty:1}),{code:'INVALID'});await assert.rejects(catalogueFormat(database(CATALOGUE_MAX_GENERATION+1).db),{code:'CATALOGUE_DAMAGED'});
});

test('uncertainty and paired upgrades are independent, idempotent and respect lock refusal',async()=>{
 for(const upgrades of [[requireStatisticalUncertainty,requirePairedStatistics],[requirePairedStatistics,requireStatisticalUncertainty]]){
  const original={...base,website:3,staged:true,owners:2,publication:true,transfers:true,...inherited},store=database(configurationCatalogueGeneration(original));for(const upgrade of upgrades)await upgrade(store.db);
  assert.deepEqual(configurationCatalogueFeatures(store.format),{...original,pairedStatistics:true,statisticalUncertainty:true});const before=store.statements.length;await requireStatisticalUncertainty(store.db);assert.equal(store.statements.length,before);assert.ok(store.statements.some(sql=>sql.includes('version TYPE bigint')));assert.ok(store.statements.some(sql=>sql.includes('CHECK(version BETWEEN 3 AND '+CATALOGUE_MAX_GENERATION+')')));
 }
 const locked=database(),run=locked.db.run;locked.db.run=async(sql,...values)=>{if(sql.startsWith('LOCK TABLE'))throw Object.assign(Error('busy'),{code:'55P03'});return run(sql,...values);};await assert.rejects(requireStatisticalUncertainty(locked.db),{code:'LOCKED'});assert.equal(locked.format,122);
});

test('uncertainty reads require every inherited interpretation owner',async()=>{
 const complete={...inherited,statisticalUncertainty:true};await assertStatisticalUncertaintyFormat(workspace(complete));await assertStatisticalUncertaintyFormat({});
 for(const missing of Object.keys(complete))await assert.rejects(assertStatisticalUncertaintyFormat(workspace({...complete,[missing]:false})),{code:'CATALOGUE_DAMAGED'});
});

test('model revisions, result receipts, jobs and paged definitions retain the new requirement only in owned metadata',()=>{
 const object='.observanda/materials/objects/id/revision.json',job='.observanda/jobs/id.json',chunk='.observanda/materials/sequences/chunks/hash.json';
 for(const tool of ['Observanda uncertainty definition','Observanda statistical uncertainty']){const value={content:{tool,version:1}};assert.equal(statisticalUncertaintyMaterial(value),true);assert.equal(statisticalUncertaintyMetadata(object,value),true);assert.equal(statisticalUncertaintyMetadata(job,value),false);assert.equal(statisticalUncertaintyMetadata('.observanda/custom/id',value),false);}
 const descriptor={version:1,method:'first-order-covariance-v1',role:'standard'};
 for(const command of [{uncertainty:{version:1}},{columns:[{statisticalUncertainty:descriptor}]},{columnChanges:[{index:0,column:{statisticalUncertainty:descriptor}}]}]){assert.equal(statisticalUncertaintyCommand(command),true);assert.equal(statisticalUncertaintyMaterial({content:command}),true);assert.equal(statisticalUncertaintyMetadata(job,{input:{command}}),true);}
 for(const content of [{statisticalUncertainties:1},{measurement:{statisticalUncertainty:descriptor}}]){assert.equal(statisticalUncertaintyMaterial({content}),true);assert.equal(statisticalUncertaintyMetadata(object,{content}),true);}
 for(const kind of ['uncertainty-inputs','uncertainty-covariance'])assert.equal(statisticalUncertaintyMetadata(chunk,{kind,items:[]}),true);
 for(const kind of ['columns','columns-policy'])assert.equal(statisticalUncertaintyMetadata(chunk,{kind,items:[{statisticalUncertainty:descriptor}]}),true);
 for(const value of [null,{content:{tool:'Observanda calculator recipe'}},{content:{aggregation:{version:5}}},{kind:'other',items:[{statisticalUncertainty:descriptor}]}]){assert.equal(statisticalUncertaintyMaterial(value),false);assert.equal(statisticalUncertaintyMetadata(chunk,value),false);}
});

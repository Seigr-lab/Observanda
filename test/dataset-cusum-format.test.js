import test from 'node:test';
import assert from 'node:assert/strict';
import {configurationCatalogueGeneration,configurationCatalogueFeatures,restoreConfigurationCatalogueFormat,requireDatasetCusum,requireDatasetSpectra,requireCoordinateFrames,CATALOGUE_MAX_GENERATION} from '../src/catalogue-format.js';
import {cusumMetadata,assertCusumFormat,cusumCatalogueRequirements} from '../src/dataset-cusum-format.js';
const base={website:0,staged:false,owners:0,publication:false,transfers:false};
function database(format=122){let stored=format;return {db:{all:async()=>[{version:String(stored)}],get:async()=>null,run:async(sql,...values)=>{if(sql.startsWith('UPDATE catalogue_format'))stored=values[0];}},get format(){return stored;}};}
const requirements=['datasetCusum','numericalExecution','computedCells','nativeNumericalModels','calculationPolicies','structuredCalculator','approximateCalculator','measurementScalarPolicies','datasetResourcePolicies'];
test('change-detection storage preserves independent capabilities in either upgrade order and fresh restoration',async()=>{
 for(const prior of [requireDatasetSpectra,requireCoordinateFrames])for(const order of [[prior,requireDatasetCusum],[requireDatasetCusum,prior]])for(const owners of [0,2]){
  const db=database(configurationCatalogueGeneration({...base,owners,website:3}));for(const apply of order)await apply(db.db);const features=configurationCatalogueFeatures(db.format);for(const key of requirements)assert.equal(features[key],true,key);assert.equal(features.owners,owners);assert.equal(features.website,3);assert.equal(features[prior===requireDatasetSpectra?'datasetSpectra':'coordinateFrames'],true);const recovered=database();await restoreConfigurationCatalogueFormat(recovered.db,db.format);assert.equal(recovered.format,db.format);
 }
 const only=database();await requireDatasetCusum(only.db);const features=configurationCatalogueFeatures(only.format);assert.equal(features.datasetSpectra,undefined);assert.equal(features.nativeDomainValues,undefined);assert.equal(configurationCatalogueGeneration(configurationCatalogueFeatures(CATALOGUE_MAX_GENERATION)),CATALOGUE_MAX_GENERATION);
 const lock=database();lock.db.run=async()=>{throw Object.assign(Error('busy'),{code:'55P03'});};await assert.rejects(requireDatasetCusum(lock.db),{code:'LOCKED'});assert.equal(lock.format,122);
});
test('every change-detection requirement is independently enforced on reads',async()=>{
 const flags=Object.fromEntries(requirements.map(key=>[key,true])),workspace=value=>({storageKind:()=> 'catalogue',catalogue:operation=>operation({catalogueDb:database(configurationCatalogueGeneration({...base,...value})).db})});assert.equal(cusumCatalogueRequirements.length,requirements.length);await assertCusumFormat(workspace(flags));for(const key of requirements){const partial={...flags};delete partial[key];await assert.rejects(assertCusumFormat(workspace(partial)),{code:'CATALOGUE_DAMAGED'},key);}
});
test('change-detection recipes, result context, copied columns and pending work require admission',()=>{
 for(const [relative,value] of [
  ['jobs/job.json',{input:{command:{cusum:{version:1}}}}],
  ['materials/objects/revision.json',{content:{cusum:{version:1}}}],
  ['materials/objects/analysis.json',{content:{tool:'Observanda dataset CUSUM'}}],
  ['materials/objects/copied.json',{content:{cusums:1}}],
  ['materials/objects/measurement.json',{content:{measurement:{cusum:{version:1}}}}],
  ['materials/numerical-work/job.json',{kind:'cusum'}],
  ['materials/sequences/chunks/schema.json',{kind:'columns-policy',items:[{cusum:{version:1}}]}],
  ['materials/tables/page.json',[{cusum:{version:1}}]]
 ])assert.equal(cusumMetadata('.observanda/'+relative,value),true,relative);
 for(const [relative,value]of [['private-notes.json',{content:{cusum:{version:1}}}],['materials/numerical-work/job.json',{kind:'spectrum'}],['materials/sequences/chunks/text.json',{kind:'cell-text',items:['CUSUM']}],['materials/objects/old.json',{content:{spectrum:{version:1}}}]])assert.equal(cusumMetadata('.observanda/'+relative,value),false,relative);
});

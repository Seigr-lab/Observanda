import test from 'node:test';
import assert from 'node:assert/strict';
import {configurationCatalogueGeneration,configurationCatalogueFeatures,catalogueFormat,restoreConfigurationCatalogueFormat,requireComputedCells,requireCoordinateFrames,CATALOGUE_MAX_GENERATION} from '../src/catalogue-format.js';
import {computedCellMetadata,assertComputedCellFormat} from '../src/computed-cell-format.js';
const base={website:0,staged:false,owners:0,publication:false,transfers:false};
const required={computedCells:true,calculationPolicies:true,structuredCalculator:true,approximateCalculator:true,measurementScalarPolicies:true,datasetResourcePolicies:true};
function database(format=122){let stored=format;const statements=[],db={all:async()=>[{version:String(stored)}],get:async()=>null,run:async(sql,...values)=>{statements.push(sql);if(sql.startsWith('UPDATE catalogue_format'))stored=values[0];}};return {db,statements,get format(){return stored;}};}
const workspace=flags=>({storageKind:()=> 'catalogue',catalogue:operation=>operation({catalogueDb:database(configurationCatalogueGeneration({...base,...flags})).db})});
test('computed value formats retain earlier capabilities and restore the new interpretation exactly',async()=>{
 for(const owners of [0,1,2])for(const website of [0,1,2,3])for(const coordinateFrames of [false,true]){
  const source=database(configurationCatalogueGeneration({...base,owners,website}));if(coordinateFrames)await requireCoordinateFrames(source.db);await requireComputedCells(source.db);const flags=configurationCatalogueFeatures(source.format);for(const [name,value]of Object.entries(required))assert.equal(flags[name],value);assert.equal(flags.coordinateFrames===true,coordinateFrames);
  const recovered=database();await restoreConfigurationCatalogueFormat(recovered.db,source.format);assert.equal(recovered.format,source.format);
 }
 const previous=configurationCatalogueFeatures(824633720953),first=configurationCatalogueFeatures(824633720954);assert.equal(previous.coordinateFrames,true);assert.equal(previous.computedCells,undefined);assert.equal(first.computedCells,true);assert.equal(first.coordinateFrames,undefined);assert.equal(configurationCatalogueGeneration(configurationCatalogueFeatures(CATALOGUE_MAX_GENERATION)),CATALOGUE_MAX_GENERATION);
 const blocked=database();blocked.db.run=async sql=>{if(sql.startsWith('LOCK TABLE'))throw Object.assign(Error('busy'),{code:'55P03'});};await assert.rejects(requireComputedCells(blocked.db),{code:'LOCKED'});assert.equal(blocked.format,122);
});
test('every required interpretation is checked independently before reading computed values',async()=>{
 await assertComputedCellFormat(workspace(required));for(const name of Object.keys(required))await assert.rejects(assertComputedCellFormat(workspace({...required,[name]:false})),{code:'CATALOGUE_DAMAGED'},name);
});
test('native computed cells, commands and receipts require admission but prose does not',()=>{
 const object='.observanda/materials/objects/id/revision.json',chunk='.observanda/materials/sequences/chunks/hash.json',job='.observanda/jobs/id.json';
 for(const command of [{aggregation:{version:6}},{calculation:{version:17}},{columns:[{computation:{version:2,kind:'per-cell'}}]}])assert.equal(computedCellMetadata(job,{input:{command}}),true);
 for(const content of [{tool:'Observanda calculation graph',graphVersion:14},{cellComputations:1},{measurement:{computation:{version:2,kind:'approximate'}}}])assert.equal(computedCellMetadata(object,{content}),true);
 for(const computation of [null,{version:1,kind:'approximate-inputs'},{version:2,kind:'approximate'}])assert.equal(computedCellMetadata(chunk,{kind:'cells',items:[{computation}]}),true);
 assert.equal(computedCellMetadata('.observanda/materials/tables/rows.json',[{aggregation:[{pairedStatistic:{version:2}}]}]),true);
 assert.equal(computedCellMetadata('.observanda/custom/value',{content:{cellComputations:1}}),false);assert.equal(computedCellMetadata(chunk,{kind:'cell-text',items:['computation']}),false);assert.equal(computedCellMetadata(job,{input:{command:{calculation:{version:16}}}}),false);
});

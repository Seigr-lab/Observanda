import test from 'node:test';
import assert from 'node:assert/strict';
import {
 configurationCatalogueGeneration,configurationCatalogueFeatures,catalogueFormat,
 restoreConfigurationCatalogueFormat,requireSequenceValues,requireDatasetCusum,
 requireCoordinateFrames,requireNativeDomainValues,requireNativeNumericalModels,
 requireTensorValues,requireComputedCells,CATALOGUE_MAX_GENERATION
} from '../src/catalogue-format.js';
import {
 sequenceDeclaration,sequenceValuesMaterial,sequenceValuesCommand,
 sequenceValuesMetadata,assertSequenceValuesFormat,sequenceValuesCatalogueRequirements
} from '../src/sequence-values-format.js';

const base={website:0,staged:false,owners:0,publication:false,transfers:false};
const bit=13194139533312,first=bit+122;
const required=['sequenceValues','nativeDomainValues','nativeNumericalModels','tensorValues','computedCells','calculationPolicies','structuredCalculator','approximateCalculator','measurementScalarPolicies','datasetResourcePolicies'];
const requirementNames=required.map(name=>'catalogueRequires'+name[0].toUpperCase()+name.slice(1));
function database(format=122){
 let stored=format;const statements=[];
 const db={all:async()=>[{version:String(stored)}],get:async()=>null,run:async(sql,...values)=>{statements.push(sql);if(sql.startsWith('UPDATE catalogue_format'))stored=values[0];}};
 return {db,statements,get format(){return stored;}};
}
const workspace=flags=>({storageKind:()=> 'catalogue',catalogue:operation=>operation({catalogueDb:database(configurationCatalogueGeneration({...base,...flags})).db})});
const column=(version=4,codec='observanda.sequence')=>({representation:'domain',domain:{version,codec,codecVersion:1,namespace:'Synthetic ordered values'}});
const envelope=(version=5,definitionVersion=4,codec='observanda.sequence')=>({format:'domain-value',version,definition:column(definitionVersion,codec).domain});
const object='.observanda/materials/objects/id/revision.json',chunk='.observanda/materials/sequences/chunks/hash.json',job='.observanda/jobs/id.json';

test('sequence capability preserves independent upgrades in both orders and restores every required interpretation',async()=>{
 for(const [prior,flag]of [[requireDatasetCusum,'datasetCusum'],[requireCoordinateFrames,'coordinateFrames']])
 for(const order of [[prior,requireSequenceValues],[requireSequenceValues,prior]])
 for(const owners of [0,2])for(const website of [0,3]){
  const source=database(configurationCatalogueGeneration({...base,owners,website,staged:true,publication:true,transfers:true}));
  for(const apply of order)await apply(source.db);
  const features=configurationCatalogueFeatures(source.format);
  for(const name of required)assert.equal(features[name],true,name);
  assert.equal(features[flag],true);assert.equal(features.owners,owners);assert.equal(features.website,website);
  assert.equal(features.staged,true);assert.equal(features.publication,true);assert.equal(features.transfers,true);
  const recovered=database();await restoreConfigurationCatalogueFormat(recovered.db,source.format);
  assert.equal(recovered.format,source.format);assert.deepEqual(configurationCatalogueFeatures(recovered.format),features);
 }
 // Each inherited owner is independently upgradeable; either ordering must
 // retain exactly the same capability set as a fresh sequence upgrade.
 const fresh=database();await requireSequenceValues(fresh.db);
 for(const prior of [requireNativeDomainValues,requireNativeNumericalModels,requireTensorValues,requireComputedCells])
 for(const order of [[prior,requireSequenceValues],[requireSequenceValues,prior]]){
  const source=database();for(const apply of order)await apply(source.db);assert.equal(source.format,fresh.format);
 }
 const features=configurationCatalogueFeatures(fresh.format);
 for(const name of ['datasetCusum','numericalExecution','datasetSpectra','coordinateFrames'])assert.equal(features[name],undefined,name);
 assert.equal(configurationCatalogueFeatures(first-1).sequenceValues,undefined);
 assert.equal(configurationCatalogueFeatures(first).sequenceValues,true);
 assert.equal(configurationCatalogueFeatures(first).datasetCusum,undefined);
 assert.ok(CATALOGUE_MAX_GENERATION>=26388279066745);assert.equal(configurationCatalogueFeatures(26388279066745).sequenceValues,true);
 assert.equal(configurationCatalogueGeneration(configurationCatalogueFeatures(CATALOGUE_MAX_GENERATION)),CATALOGUE_MAX_GENERATION);
 await assert.rejects(catalogueFormat(database(CATALOGUE_MAX_GENERATION+1).db),{code:'CATALOGUE_DAMAGED'});
 const locked=database();locked.db.run=async sql=>{if(sql.startsWith('LOCK TABLE'))throw Object.assign(Error('busy'),{code:'55P03'});};
 await assert.rejects(requireSequenceValues(locked.db),{code:'LOCKED'});assert.equal(locked.format,122);
});

test('all ten sequence interpretation requirements are checked independently before reading',async()=>{
 assert.deepEqual(sequenceValuesCatalogueRequirements,requirementNames);
 assert.equal(Object.isFrozen(sequenceValuesCatalogueRequirements),true);
 const flags=Object.fromEntries(required.map(name=>[name,true]));await assertSequenceValuesFormat(workspace(flags));
 for(const name of required){const partial={...flags};delete partial[name];await assert.rejects(assertSequenceValuesFormat(workspace(partial)),{code:'CATALOGUE_DAMAGED'},name);}
});

test('current sequence declarations, measurements, native cells, jobs and graph recipes require admission',()=>{
 assert.equal(sequenceDeclaration(column()),true);
 for(const content of [
  {sequenceValues:1},{columns:[column()]},{measurement:{value:column()}},
  {tool:'Observanda calculation graph',graphVersion:15},{calculation:{version:18}}
 ]){assert.equal(sequenceValuesMaterial({content}),true);assert.equal(sequenceValuesMetadata(object,{content}),true);}
 for(const command of [
  {columns:[column()]},{columnChanges:[{index:17,column:column()}]},
  {measurement:{value:column()}},{calculation:{version:18}}
 ]){assert.equal(sequenceValuesCommand(command),true);assert.equal(sequenceValuesMetadata(job,{input:{command}}),true);}
 for(const value of [
  {kind:'columns',items:[column()]},{kind:'columns-policy',items:[column()]},
  {kind:'cells',items:[{kind:'domain',value:envelope()}]},
  {kind:'calculation-nodes',items:[{kind:'domain-sequence',operation:{kind:'reverse'}}]}
 ])assert.equal(sequenceValuesMetadata(chunk,value),true);
});

test('older unknown sequence codecs remain opaque and unrelated text, paths and recipes stay historical',()=>{
 for(const version of [1,2,3]){
  assert.equal(sequenceDeclaration(column(version)),false);
  assert.equal(sequenceValuesMaterial({content:{columns:[column(version)]}}),false);
  assert.equal(sequenceValuesCommand({measurement:{value:column(version)}}),false);
  assert.equal(sequenceValuesMetadata(chunk,{kind:'columns-policy',items:[column(version)]}),false);
  assert.equal(sequenceValuesMetadata(chunk,{kind:'cells',items:[{value:envelope(5,version)}]}),false);
 }
 for(const value of [envelope(1),envelope(2),envelope(3),envelope(4),envelope(5,4,'observanda.topology'),envelope(5,3,'observanda.tensor')])assert.equal(sequenceValuesMetadata(chunk,{kind:'cells',items:[{value}]}),false);
 for(const content of [{tool:'Observanda calculation graph',graphVersion:14},{calculation:{version:17}},{columns:[column(4,'unknown.sequence')]},{measurement:{value:{representation:'text',domain:column().domain}}}])assert.equal(sequenceValuesMetadata(object,{content}),false);
 for(const [relative,value]of [
  ['.observanda/private-notes.json',{content:{sequenceValues:1}}],
  [object,{kind:'cells',items:[{value:envelope()}]}],
  [chunk,{kind:'cell-text',items:['observanda.sequence']}],
  [chunk,{kind:'domain-components',items:[{spelling:'domain-sequence'}]}],
  [job,{input:{command:{calculation:{version:17}}}}],
  [job,{input:{command:{columns:[column(2)]}}}]
 ])assert.equal(sequenceValuesMetadata(relative,value),false,relative);
});

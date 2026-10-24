import test from 'node:test';
import assert from 'node:assert/strict';
import {
 configurationCatalogueGeneration,configurationCatalogueFeatures,catalogueFormat,
 restoreConfigurationCatalogueFormat,requireTopologyValues,requireSequenceValues,
 requireDatasetCusum,CATALOGUE_MAX_GENERATION
} from '../src/catalogue-format.js';
import {
 topologyDeclaration,topologyValuesMaterial,topologyValuesCommand,
 topologyValuesMetadata,assertTopologyValuesFormat,topologyValuesCatalogueRequirements
} from '../src/topology-values-format.js';

const base={website:0,staged:false,owners:0,publication:false,transfers:false};
const required=['topologyValues','sequenceValues','nativeDomainValues','nativeNumericalModels','tensorValues','computedCells','calculationPolicies','structuredCalculator','approximateCalculator','measurementScalarPolicies','datasetResourcePolicies'];
const names=required.map(name=>'catalogueRequires'+name[0].toUpperCase()+name.slice(1));
function database(version=122){let current=version;return {get version(){return current;},db:{all:async()=>[{version:String(current)}],get:async()=>null,run:async(sql,...values)=>{if(sql.startsWith('UPDATE catalogue_format'))current=values[0];}}};}
const workspace=flags=>({storageKind:()=> 'catalogue',catalogue:operation=>operation({catalogueDb:database(configurationCatalogueGeneration({...base,...flags})).db})});
const column=(version=4,codec='observanda.topology')=>({representation:'domain',domain:{version,codec,codecVersion:1,namespace:'Literal authored graph'}});
const envelope=(version=5,definitionVersion=4,codec='observanda.topology')=>({format:'domain-value',version,definition:column(definitionVersion,codec).domain});
const object='.observanda/materials/objects/id/revision.json',chunk='.observanda/materials/sequences/chunks/hash.json',job='.observanda/jobs/id.json';

test('topology capability preserves sequence and independent feature upgrades and restores all inherited owners',async()=>{
 for(const [prior,flag]of [[requireSequenceValues,'sequenceValues'],[requireDatasetCusum,'datasetCusum']])for(const order of [[prior,requireTopologyValues],[requireTopologyValues,prior]])for(const owners of [0,2])for(const website of [0,3]){
  const store=database(configurationCatalogueGeneration({...base,owners,website,staged:true,publication:true,transfers:true}));for(const apply of order)await apply(store.db);const features=configurationCatalogueFeatures(store.version);
  for(const name of required)assert.equal(features[name],true,name);assert.equal(features[flag],true);for(const [key,value]of Object.entries({owners,website,staged:true,publication:true,transfers:true}))assert.equal(features[key],value);
  const recovered=database();await restoreConfigurationCatalogueFormat(recovered.db,store.version);assert.equal(recovered.version,store.version);assert.deepEqual(configurationCatalogueFeatures(recovered.version),features);
 }
 const fresh=database();await requireTopologyValues(fresh.db);const features=configurationCatalogueFeatures(fresh.version);for(const name of ['datasetCusum','numericalExecution','datasetSpectra','coordinateFrames'])assert.equal(features[name],undefined,name);
 const first=26388279066624+122;assert.equal(configurationCatalogueFeatures(first-1).topologyValues,undefined);assert.equal(configurationCatalogueFeatures(first).topologyValues,true);assert.equal(configurationCatalogueFeatures(first).sequenceValues,undefined);assert.equal(CATALOGUE_MAX_GENERATION,52776558133369);assert.equal(configurationCatalogueGeneration(configurationCatalogueFeatures(CATALOGUE_MAX_GENERATION)),CATALOGUE_MAX_GENERATION);await assert.rejects(catalogueFormat(database(CATALOGUE_MAX_GENERATION+1).db),{code:'CATALOGUE_DAMAGED'});
 const locked=database();locked.db.run=async sql=>{if(sql.startsWith('LOCK TABLE'))throw Object.assign(Error('busy'),{code:'55P03'});};await assert.rejects(requireTopologyValues(locked.db),{code:'LOCKED'});assert.equal(locked.version,122);
});

test('all eleven topology interpretation requirements are independently required before reading',async()=>{
 assert.deepEqual(topologyValuesCatalogueRequirements,names);assert.equal(Object.isFrozen(topologyValuesCatalogueRequirements),true);const flags=Object.fromEntries(required.map(name=>[name,true]));await assertTopologyValuesFormat(workspace(flags));for(const name of required){const partial={...flags};delete partial[name];await assert.rejects(assertTopologyValuesFormat(workspace(partial)),{code:'CATALOGUE_DAMAGED'},name);}
});

test('topology admission covers saved columns, measurements, envelope5 siblings, graph16 jobs and orphan structural chunks',()=>{
 assert.equal(topologyDeclaration(column()),true);for(const content of [{topologyValues:1},{columns:[column()]},{measurement:{value:column()}},{tool:'Observanda calculation graph',graphVersion:16},{calculation:{version:19}}]){assert.equal(topologyValuesMaterial({content}),true);assert.equal(topologyValuesMetadata(object,{content}),true);}
 for(const command of [{columns:[column()]},{columnChanges:[{index:17,column:column()}]},{measurement:{value:column()}},{calculation:{version:19}}]){assert.equal(topologyValuesCommand(command),true);assert.equal(topologyValuesMetadata(job,{input:{command}}),true);}
 for(const value of [{kind:'columns',items:[column()]},{kind:'columns-policy',items:[column()]},{kind:'cells',items:[{kind:'string',value:envelope()}]},{kind:'calculation-nodes',items:[{kind:'domain-topology',operation:{kind:'count',collection:'vertices'}}]},{kind:'topology-vertices',items:[{key:'A'}]},{kind:'topology-edges',items:[{key:'ab',from:'A',to:'B'}]}])assert.equal(topologyValuesMetadata(chunk,value),true,value.kind);
});

test('historical opaque topology declarations and other envelope5 siblings do not acquire topology semantics',()=>{
 for(const version of [1,2,3]){assert.equal(topologyDeclaration(column(version)),false);assert.equal(topologyValuesMaterial({content:{columns:[column(version)]}}),false);assert.equal(topologyValuesCommand({measurement:{value:column(version)}}),false);assert.equal(topologyValuesMetadata(chunk,{kind:'columns-policy',items:[column(version)]}),false);assert.equal(topologyValuesMetadata(chunk,{kind:'cells',items:[{value:envelope(5,version)}]}),false);}
 for(const value of [envelope(1),envelope(2),envelope(3),envelope(4),envelope(5,4,'observanda.sequence'),envelope(5,3,'observanda.tensor')])assert.equal(topologyValuesMetadata(chunk,{kind:'cells',items:[{value}]}),false);
 for(const content of [{tool:'Observanda calculation graph',graphVersion:15},{calculation:{version:18}},{columns:[column(4,'unknown.topology')]},{measurement:{value:{representation:'text',domain:column().domain}}}])assert.equal(topologyValuesMetadata(object,{content}),false);
 for(const [relative,value]of [['.observanda/private-notes.json',{content:{topologyValues:1}}],[object,{kind:'cells',items:[{value:envelope()}]}],[chunk,{kind:'cell-text',items:['observanda.topology']}],[chunk,{kind:'domain-components',items:[{spelling:'domain-topology'}]}],[job,{input:{command:{calculation:{version:18}}}}]])assert.equal(topologyValuesMetadata(relative,value),false,relative);
});

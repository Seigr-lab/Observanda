import test from 'node:test';
import assert from 'node:assert/strict';
import {configurationCatalogueGeneration,configurationCatalogueFeatures,catalogueFormat,restoreConfigurationCatalogueFormat,requireWeightedFit,requireCoordinateAlignment,requireSpectralMethods,catalogueRequiresWeightedFit,CATALOGUE_MAX_GENERATION} from '../src/catalogue-format.js';
import {weightedFitCommand,weightedFitMaterial,weightedFitMetadata,assertWeightedFitFormat,weightedFitCatalogueRequirements} from '../src/weighted-fit-format.js';
import {pairedStatisticsMetadata} from '../src/paired-statistics-format.js';
import {quantileAggregationMetadata} from '../src/quantile-aggregation-format.js';
import {computedCellMetadata} from '../src/computed-cell-format.js';
import {measurementScalarMetadata} from '../src/measurement-scalar-format.js';
import {datasetResourceMetadata} from '../src/dataset-resource-format.js';
const base={website:0,staged:false,owners:0,publication:false,transfers:false},required=['weightedFit','pairedStatistics','quantileAggregation','computedCells','calculationPolicies','structuredCalculator','approximateCalculator','measurementScalarPolicies','datasetResourcePolicies','nativeNumericalModels'];
const first=211106232533114,maximum=CATALOGUE_MAX_GENERATION,weightedMaximum=422212465066105,bit=211106232532992;
const object='.observanda/materials/objects/id/revision.json',job='.observanda/jobs/id.json',work='.observanda/materials/aggregation-work/id.json',chunk='.observanda/materials/sequences/chunks/hash.json',table='.observanda/materials/tables/hash.json';
function database(format=122){let stored=format;const statements=[];return {db:{all:async()=>[{version:String(stored)}],get:async()=>null,run:async(sql,...values)=>{statements.push(sql);if(sql.startsWith('UPDATE catalogue_format'))stored=values[0];}},statements,get format(){return stored;}};}
const workspace=flags=>({storageKind:()=> 'catalogue',catalogue:operation=>operation({catalogueDb:database(configurationCatalogueGeneration({...base,...flags})).db})});

test('weighted fit occupies an independent catalogue bit and retains historical feature generations',async()=>{
 assert.ok(CATALOGUE_MAX_GENERATION>=weightedMaximum);assert.equal(configurationCatalogueGeneration({...base,weightedFit:true}),first);assert.equal(first-bit,122);assert.equal(catalogueRequiresWeightedFit(first-1),false);assert.equal(catalogueRequiresWeightedFit(first),true);assert.equal(configurationCatalogueFeatures(first).coordinateAlignment,undefined);assert.equal(configurationCatalogueFeatures(first-1).coordinateAlignment,true);assert.equal(configurationCatalogueGeneration(configurationCatalogueFeatures(weightedMaximum)),weightedMaximum);
 for(const weightedFit of [false,true])for(const coordinateAlignment of [false,true])for(const spectralMethods of [false,true])for(const pairedStatistics of [false,true]){const flags={weightedFit,coordinateAlignment,spectralMethods,pairedStatistics},format=configurationCatalogueGeneration({...base,...flags});assert.deepEqual(configurationCatalogueFeatures(format),{...base,...Object.fromEntries(Object.entries(flags).filter(([,enabled])=>enabled))});}
 assert.equal(configurationCatalogueFeatures(maximum+1),null);assert.equal(configurationCatalogueFeatures(String(maximum)),null);await assert.rejects(catalogueFormat(database(maximum+1).db),{code:'CATALOGUE_DAMAGED'});assert.throws(()=>configurationCatalogueGeneration({...base,weightedFit:1}),{code:'INVALID'});
});

test('weighted fit upgrades commute with preceding alignment and spectral owners and restore exactly',async()=>{
 for(const other of [requireCoordinateAlignment,requireSpectralMethods])for(const order of [[other,requireWeightedFit],[requireWeightedFit,other]]){const source=database(configurationCatalogueGeneration({...base,owners:2,website:3,staged:true,publication:true,transfers:true}));for(const apply of order)await apply(source.db);const features=configurationCatalogueFeatures(source.format);for(const name of required)assert.equal(features[name],true,name);assert.equal(features.owners,2);assert.equal(features.website,3);assert.equal(features.staged,true);assert.equal(features.publication,true);assert.equal(features.transfers,true);const recovered=database();await restoreConfigurationCatalogueFormat(recovered.db,source.format);assert.equal(recovered.format,source.format);assert.deepEqual(configurationCatalogueFeatures(recovered.format),features);const count=source.statements.length;await requireWeightedFit(source.db);assert.equal(source.statements.length,count);}
 const fresh=database();await requireWeightedFit(fresh.db);const flags=configurationCatalogueFeatures(fresh.format);for(const name of ['coordinateAlignment','spectralMethods','topologyValues','sequenceValues','datasetCusum','numericalExecution','datasetSpectra','statisticalUncertainty','coordinateFrames','clockSynchronization'])assert.equal(flags[name],undefined,name+' remains independently authored');for(const name of required)assert.equal(flags[name],true);assert.ok(fresh.statements.some(sql=>sql.includes('CHECK(version BETWEEN 3 AND '+maximum+')')));
 const locked=database();locked.db.run=async sql=>{if(sql.startsWith('LOCK TABLE'))throw Object.assign(Error('busy'),{code:'55P03'});};await assert.rejects(requireWeightedFit(locked.db),{code:'LOCKED'});assert.equal(locked.format,122);
});

test('each of ten weighted fit interpretation capabilities is independently required',async()=>{
 assert.equal(required.length,10);assert.equal(Object.isFrozen(weightedFitCatalogueRequirements),true);assert.deepEqual([...weightedFitCatalogueRequirements].sort(),required.map(name=>'catalogueRequires'+name[0].toUpperCase()+name.slice(1)).sort());const complete=Object.fromEntries(required.map(name=>[name,true]));await assertWeightedFitFormat(workspace(complete));await assertWeightedFitFormat({});for(const name of required){const partial={...complete};delete partial[name];await assert.rejects(assertWeightedFitFormat(workspace(partial)),{code:'CATALOGUE_DAMAGED'},name);}
});

test('recipe, queued work, row receipts, copied schema and capture all carry weighted fit admission',()=>{
 const column={weightedFit:{version:1}},command={aggregation:{version:7}},document={content:command};
 assert.equal(weightedFitCommand(command),true);assert.equal(weightedFitMaterial(document),true);assert.equal(weightedFitMetadata(object,document),true);assert.equal(weightedFitMetadata(work,{version:7}),true);assert.equal(weightedFitMetadata(table,[{aggregation:[{weightedFit:{version:1,status:'ready'}}]}]),true);
 for(const content of [{columns:[column]},{measurement:column},{weightedFits:1}])assert.equal(weightedFitMaterial({content}),true);
 for(const authored of [command,{columns:[column]},{columnChanges:[{index:31,column}]},{measurement:column}]){assert.equal(weightedFitCommand(authored),true);assert.equal(weightedFitMetadata(job,{input:{command:authored}}),true);}
 for(const kind of ['columns','columns-policy'])assert.equal(weightedFitMetadata(chunk,{kind,items:[column]}),true);assert.equal(weightedFitMetadata(chunk,{kind:'columns',items:[{weightedFit:null}]}),true,'malformed presence cannot evade capability admission');
 for(const classify of [pairedStatisticsMetadata,quantileAggregationMetadata,computedCellMetadata,measurementScalarMetadata,datasetResourceMetadata]){assert.equal(classify(object,document),true);assert.equal(classify(job,{input:{command}}),true);}
});

test('old and unknown aggregation recipes and unrelated chunks do not gain weighted fit semantics',()=>{
 for(const version of [1,2,3,4,5,6,8,99]){assert.equal(weightedFitCommand({aggregation:{version}}),false);assert.equal(weightedFitMaterial({content:{aggregation:{version,values:[{operation:'weighted-affine-fit'}]}}}),false);assert.equal(weightedFitMetadata(work,{version}),false);assert.equal(weightedFitMetadata(job,{input:{command:{aggregation:{version}}}}),false);}
 for(const version of [6,7])assert.equal(measurementScalarMetadata(chunk,{kind:'cells',items:[{value:{format:'domain-value',version}}]}),false,'aggregation7 does not admit future domain envelopes');
 for(const [path,value]of [[chunk,{kind:'cell-text',items:['observation-variance-affine-v1']}],[chunk,{kind:'cells',items:[{value:'1',kind:'string'}]}],[table,[{aggregation:[{pairedStatistic:{version:1}}]}]],[table,[null,{aggregation:{weightedFit:true}}]],['.observanda/notes/id.json',{content:{weightedFits:1}}],[job,{content:{aggregation:{version:7}}}],[object,{kind:'columns',items:[{weightedFit:{version:1}}]}]])assert.equal(weightedFitMetadata(path,value),false,path);
});

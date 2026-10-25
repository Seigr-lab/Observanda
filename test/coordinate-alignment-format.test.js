import test from 'node:test';
import assert from 'node:assert/strict';
import {configurationCatalogueGeneration,configurationCatalogueFeatures,catalogueFormat,restoreConfigurationCatalogueFormat,requireCoordinateAlignment,requireSpectralMethods,requireTopologyValues,catalogueRequiresCoordinateAlignment,CATALOGUE_MAX_GENERATION} from '../src/catalogue-format.js';
import {coordinateAlignmentCommand,coordinateAlignmentMaterial,coordinateAlignmentMetadata,assertCoordinateAlignmentFormat,coordinateAlignmentCatalogueRequirements} from '../src/coordinate-alignment-format.js';
const base={website:0,staged:false,owners:0,publication:false,transfers:false};
const required=['coordinateAlignment','topologyValues','sequenceValues','referencedCalculations','windowCalculations','datasetResourcePolicies','measurementScalarPolicies','domainAlgebra','clockSynchronization','tensorValues','axisPermutation','segmentedClockSynchronization','coordinateFrames','nativeDomainValues','nativeNumericalModels','computedCells','calculationPolicies','structuredCalculator','approximateCalculator'];
const requirements=required.map(name=>'catalogueRequires'+name[0].toUpperCase()+name.slice(1));
const bit=105553116266496,first=105553116266618,maximum=211106232533113;
const object='.observanda/materials/objects/id/revision.json',chunk='.observanda/materials/sequences/chunks/hash.json',table='.observanda/materials/tables/hash.json',job='.observanda/jobs/id.json';
const index=kind=>({format:1,kind,root:null,count:0,chunkSize:1}),column={coordinateAlignment:{version:1,contextsIndex:index('coordinate-alignment-contexts')}},cell={coordinateAlignment:{version:1,decisionsIndex:index('coordinate-alignment-decisions')}},axis={coordinateAxis:{version:1,frame:{kind:'analysis',id:'frame',revision:'revision'},axis:0}};
function database(format=122){let stored=format;const statements=[];return {db:{all:async()=>[{version:String(stored)}],get:async()=>null,run:async(sql,...values)=>{statements.push(sql);if(sql.startsWith('UPDATE catalogue_format'))stored=values[0];}},statements,get format(){return stored;}};}
const workspace=flags=>({storageKind:()=> 'catalogue',catalogue:operation=>operation({catalogueDb:database(configurationCatalogueGeneration({...base,...flags})).db})});

test('alignment upgrades commute with spectral and topology upgrades and restore the exact feature set',async()=>{
 for(const [other,flag]of [[requireSpectralMethods,'spectralMethods'],[requireTopologyValues,'topologyValues']])for(const order of [[other,requireCoordinateAlignment],[requireCoordinateAlignment,other]])for(const owners of [0,2])for(const website of [0,3]){
  const source=database(configurationCatalogueGeneration({...base,owners,website,staged:true,publication:true,transfers:true}));for(const apply of order)await apply(source.db);const features=configurationCatalogueFeatures(source.format);for(const name of required)assert.equal(features[name],true,name);assert.equal(features[flag],true);for(const [name,value]of Object.entries({owners,website,staged:true,publication:true,transfers:true}))assert.equal(features[name],value);const recovered=database();await restoreConfigurationCatalogueFormat(recovered.db,source.format);assert.equal(recovered.format,source.format);assert.deepEqual(configurationCatalogueFeatures(recovered.format),features);
 }
 const fresh=database();await requireCoordinateAlignment(fresh.db);const flags=configurationCatalogueFeatures(fresh.format);for(const name of ['spectralMethods','datasetSpectra','numericalExecution','datasetCusum','quantileAggregation','pairedStatistics','statisticalUncertainty'])assert.equal(flags[name],undefined,name+' remains independent');const once=fresh.format;await requireCoordinateAlignment(fresh.db);assert.equal(fresh.format,once);
 assert.equal(configurationCatalogueFeatures(maximum).coordinateAlignment,true);assert.equal(configurationCatalogueFeatures(maximum).weightedFit,undefined);assert.equal(configurationCatalogueGeneration({...base,coordinateAlignment:true}),first);assert.equal(catalogueRequiresCoordinateAlignment(first-1),false);assert.equal(catalogueRequiresCoordinateAlignment(first),true);assert.equal(configurationCatalogueFeatures(first).spectralMethods,undefined);assert.equal(configurationCatalogueFeatures(first-1).spectralMethods,true);assert.equal(configurationCatalogueGeneration(configurationCatalogueFeatures(maximum)),maximum);assert.equal(first-bit,122);await assert.rejects(catalogueFormat(database(CATALOGUE_MAX_GENERATION+1).db),{code:'CATALOGUE_DAMAGED'});
 const locked=database();locked.db.run=async sql=>{if(sql.startsWith('LOCK TABLE'))throw Object.assign(Error('busy'),{code:'55P03'});};await assert.rejects(requireCoordinateAlignment(locked.db),{code:'LOCKED'});assert.equal(locked.format,122);
});

test('all nineteen alignment interpretation flags are independently required before reading',async()=>{
 assert.equal(required.length,19);assert.equal(Object.isFrozen(coordinateAlignmentCatalogueRequirements),true);assert.deepEqual([...coordinateAlignmentCatalogueRequirements].sort(),[...requirements].sort());const complete=Object.fromEntries(required.map(name=>[name,true]));await assertCoordinateAlignmentFormat(workspace(complete));for(const name of required){const partial={...complete};delete partial[name];await assert.rejects(assertCoordinateAlignmentFormat(workspace(partial)),{code:'CATALOGUE_DAMAGED'},name);}
});

test('alignment graph recipes, copied columns, scalar axes and captured decisions classify queued and source objects',()=>{
 const measurement={coordinateAlignment:{version:1,contextsIndex:column.coordinateAlignment.contextsIndex,decisionsIndex:cell.coordinateAlignment.decisionsIndex}},contents=[{tool:'Observanda calculation graph',graphVersion:17},{calculation:{version:20}},{coordinateAlignments:1},{columns:[column]},{columns:[axis]},{measurement},{measurement:axis}];
 for(const content of contents){assert.equal(coordinateAlignmentMaterial({content}),true);assert.equal(coordinateAlignmentMetadata(object,{content}),true);}
 for(const command of [{calculation:{version:20}},{columns:[column]},{columns:[axis]},{columnChanges:[{index:42,column}]},{columnChanges:[{index:42,column:axis}]},{measurement},{measurement:axis}]){assert.equal(coordinateAlignmentCommand(command),true);assert.equal(coordinateAlignmentMetadata(job,{type:'dataset.prepare',input:{command}}),true);}
 // Presence is admitted before strict semantic validation; malformed declarations
 // cannot become an escape hatch around the catalogue capability.
 for(const marker of [{coordinateAlignment:null},{coordinateAxis:null}]){assert.equal(coordinateAlignmentCommand({columns:[marker]}),true);assert.equal(coordinateAlignmentMaterial({content:{measurement:marker}}),true);}
});

test('bounded context, decision, evidence, binding and native-cell chunks independently require alignment',()=>{
 for(const kind of ['coordinate-alignment-contexts','coordinate-alignment-decisions','coordinate-alignment-evidence'])assert.equal(coordinateAlignmentMetadata(chunk,{kind,items:[]}),true,kind);
 for(const kind of ['columns','columns-policy','cells'])for(const marker of [column,cell,axis])assert.equal(coordinateAlignmentMetadata(chunk,{kind,items:[marker]}),true,kind);
 assert.equal(coordinateAlignmentMetadata(chunk,{kind:'calculation-bindings',items:[{match:{method:'coordinate-neighbor-v1'}}]}),true);assert.equal(coordinateAlignmentMetadata(chunk,{kind:'calculation-row-bindings',items:[{alignment:{version:1}}]}),true);assert.equal(coordinateAlignmentMetadata(table,[{cellCoordinateAlignments:[undefined,cell.coordinateAlignment]}]),true);
});

test('historical exact matches, unrelated paths and unknown graph generations do not acquire alignment semantics',()=>{
 for(const content of [{tool:'Observanda calculation graph',graphVersion:16},{tool:'Observanda calculation graph',graphVersion:18},{calculation:{version:19}},{calculation:{version:21}},{coordinateAlignments:0},{columns:[{representation:'integer'}]}])assert.equal(coordinateAlignmentMaterial({content}),false);
 for(const [path,value]of [[job,{input:{command:{calculation:{version:19}}}}],[job,{input:{command:{calculation:{version:21}}}}],['.observanda/private-notes.json',{content:{coordinateAlignments:1}}],[object,{kind:'coordinate-alignment-contexts'}],[chunk,{kind:'cell-text',items:['coordinate-neighbor-v1']}],[chunk,{kind:'calculation-bindings',items:[{match:{keysIndex:{},unmatched:'error'}}]}],[chunk,{kind:'calculation-bindings',items:[{match:{method:'future-neighbor-v2'}}]}],[chunk,{kind:'calculation-row-bindings',items:[{binding:{},location:null}]}],[table,[{cellCoordinateAlignments:[null,null]}]]])assert.equal(coordinateAlignmentMetadata(path,value),false,path);
});

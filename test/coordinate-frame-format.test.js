import test from 'node:test';
import assert from 'node:assert/strict';
import {coordinateFrameCommand,coordinateFrameMaterial,coordinateFrameMetadata,assertCoordinateFrameFormat} from '../src/coordinate-frame-format.js';
test('coordinate-frame admission covers independently retained schemas, axes, jobs and graph lineage',()=>{
 const object='.observanda/materials/objects/id/revision.json',chunk='.observanda/materials/sequences/chunks/hash.json',job='.observanda/jobs/id.json',descriptor={version:1,frame:{kind:'analysis',id:'frame',revision:'r'}};
 for(const content of [{tool:'Observanda coordinate frame'},{tool:'Observanda coordinate frame transform'},{tool:'Observanda calculation graph',graphVersion:13},{coordinateFrames:1}]){const value={content};assert.equal(coordinateFrameMaterial(value),true);assert.equal(coordinateFrameMetadata(object,value),true);assert.equal(coordinateFrameMetadata('.observanda/custom/id',value),false);}
 for(const command of [{calculation:{version:16}},{columns:[{coordinateFrame:descriptor}]},{columnChanges:[{index:35,column:{coordinateFrame:descriptor}}]}]){assert.equal(coordinateFrameCommand(command),true);assert.equal(coordinateFrameMetadata(job,{input:{command}}),true);}
 for(const value of [{kind:'coordinate-frame-axes',items:[]},{kind:'columns',items:[{coordinateFrame:descriptor}]},{kind:'columns-policy',items:[{coordinateFrame:descriptor}]},{kind:'calculation-nodes',items:[{kind:'coordinate-transform'}]},{kind:'calculation-lineage',items:[{coordinateTransform:{version:1}}]},{kind:'calculation-lineage',items:[{coordinateComponent:{frame:descriptor.frame,axis:0}}]}]){assert.equal(coordinateFrameMetadata(chunk,value),true);assert.equal(coordinateFrameMetadata('.observanda/records/id',value),false);}
});
test('ordinary labels, prior graphs and unknown prose do not silently acquire coordinate-frame semantics',()=>{
 const object='.observanda/materials/objects/id/revision.json',chunk='.observanda/materials/sequences/chunks/hash.json';
 for(const content of [{tool:'Observanda calculation graph',graphVersion:12},{calculation:{version:15}},{coordinateFrames:0},{note:{coordinateFrame:{version:1}}},{columns:[{name:'coordinate frame'}]}])assert.equal(coordinateFrameMetadata(object,{content}),false);
 for(const value of [{kind:'cell-text',items:['coordinate-transform']},{kind:'columns',items:[{name:'coordinate frame'}]},{kind:'calculation-lineage',items:[{note:{coordinateTransform:{version:1}}}]}])assert.equal(coordinateFrameMetadata(chunk,value),false);
});

import {CATALOGUE_MAX_GENERATION,configurationCatalogueFeatures,configurationCatalogueGeneration,catalogueFormat,restoreConfigurationCatalogueFormat,requireCoordinateFrames,requireSegmentedClockSynchronization,catalogueRequiresCoordinateFrames,catalogueRequiresSegmentedClockSynchronization} from '../src/catalogue-format.js';
import {clockSynchronizationMetadata} from '../src/clock-synchronization-format.js';
import {segmentedClockSynchronizationMetadata} from '../src/segmented-clock-synchronization-format.js';
import {axisPermutationMetadata} from '../src/axis-permutation-format.js';
import {tensorValuesMetadata} from '../src/tensor-values-format.js';
import {domainAlgebraMetadata} from '../src/domain-algebra-format.js';
import {measurementScalarMetadata} from '../src/measurement-scalar-format.js';
import {datasetResourceMetadata} from '../src/dataset-resource-format.js';
import {windowCalculationMetadata} from '../src/dataset-window-format.js';
const base={website:0,staged:false,owners:0,publication:false,transfers:false};
const inherited={domainAlgebra:true,nativeDomainValues:true,measurementScalarPolicies:true,datasetResourcePolicies:true};
function database(format=122){let stored=format;const statements=[],db={all:async()=>[{version:String(stored)}],get:async()=>null,run:async(sql,...values)=>{statements.push(sql);if(sql.startsWith('UPDATE catalogue_format'))stored=values[0];}};return {db,statements,get format(){return stored;}};}
const workspace=flags=>({storageKind:()=> 'catalogue',catalogue:operation=>operation({catalogueDb:database(configurationCatalogueGeneration({...base,...flags})).db})});
test('frame admission preserves independent owner and numerical features across copy and restoration',async()=>{
 for(const website of [0,1,2,3])for(const owners of [0,1,2])for(const staged of [false,true])for(const publication of [false,true])for(const transfers of [false,true])for(const coordinateFrames of [false,true])for(const segmentedClockSynchronization of [false,true]){
  const flags={...base,website,owners,staged,publication,transfers,...inherited,...(coordinateFrames?{coordinateFrames:true}:{}),...(segmentedClockSynchronization?{segmentedClockSynchronization:true}:{})},format=configurationCatalogueGeneration(flags);
  assert.deepEqual(configurationCatalogueFeatures(format),flags);const restored=database();await restoreConfigurationCatalogueFormat(restored.db,format);assert.equal(await catalogueFormat(restored.db),format);
 }
 const previous=412316860537,first=412316860538;assert.equal(catalogueRequiresCoordinateFrames(previous),false);assert.equal(catalogueRequiresSegmentedClockSynchronization(previous),true);assert.equal(configurationCatalogueGeneration({...base,coordinateFrames:true}),first);assert.equal(catalogueRequiresSegmentedClockSynchronization(first),false);
 const maximum=configurationCatalogueFeatures(CATALOGUE_MAX_GENERATION);assert.equal(configurationCatalogueGeneration(maximum),CATALOGUE_MAX_GENERATION);assert.equal(maximum.coordinateFrames,true);assert.equal(maximum.segmentedClockSynchronization,true);
 for(const invalid of [CATALOGUE_MAX_GENERATION+1,NaN,Infinity,122.5,String(first)])assert.equal(configurationCatalogueFeatures(invalid),null);
 assert.throws(()=>configurationCatalogueGeneration({...base,coordinateFrames:1}),{code:'INVALID'});await assert.rejects(catalogueFormat(database(CATALOGUE_MAX_GENERATION+1).db),{code:'CATALOGUE_DAMAGED'});
});
test('frame upgrades retain prior flags, install inherited numerical capabilities and respect the write lock',async()=>{
 for(const upgrades of [[requireCoordinateFrames,requireSegmentedClockSynchronization],[requireSegmentedClockSynchronization,requireCoordinateFrames]]){
  const original={...base,website:3,staged:true,owners:2,publication:true,transfers:true},store=database(configurationCatalogueGeneration(original));for(const upgrade of upgrades)await upgrade(store.db);
  const flags=configurationCatalogueFeatures(store.format);for(const [key,value] of Object.entries({...original,...inherited,coordinateFrames:true,segmentedClockSynchronization:true}))assert.equal(flags[key],value,key);
  const before=store.statements.length;await requireCoordinateFrames(store.db);assert.equal(store.statements.length,before);
 }
 const locked=database(),run=locked.db.run;locked.db.run=async(sql,...values)=>{if(sql.startsWith('LOCK TABLE'))throw Object.assign(Error('busy'),{code:'55P03'});return run(sql,...values);};await assert.rejects(requireCoordinateFrames(locked.db),{code:'LOCKED'});assert.equal(locked.format,122);
});
test('framed reads refuse every missing mathematical interpretation independently',async()=>{
 const complete={...inherited,coordinateFrames:true};await assertCoordinateFrameFormat(workspace(complete));await assertCoordinateFrameFormat({});
 for(const missing of Object.keys(complete))await assert.rejects(assertCoordinateFrameFormat(workspace({...complete,[missing]:false})),{code:'CATALOGUE_DAMAGED'},missing);
});
test('frame graph and recipe revisions retain earlier numerical format admission',()=>{
 const object='.observanda/materials/objects/id/revision.json',job='.observanda/jobs/id.json';
 for(const classify of [clockSynchronizationMetadata,segmentedClockSynchronizationMetadata,axisPermutationMetadata,tensorValuesMetadata,domainAlgebraMetadata,measurementScalarMetadata,datasetResourceMetadata,windowCalculationMetadata]){
  assert.equal(classify(object,{content:{tool:'Observanda calculation graph',graphVersion:13}}),true);assert.equal(classify(object,{content:{calculation:{version:16}}}),true);assert.equal(classify(job,{input:{command:{calculation:{version:16}}}}),true);
 }
});

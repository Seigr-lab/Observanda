import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {registerHooks} from 'node:module';
import {configurationCatalogueGeneration} from '../src/catalogue-format.js';
import {referencedCalculationMetadata} from '../src/calculation-graph-format.js';
import {computedCellMetadata} from '../src/computed-cell-format.js';
import {coordinateFrameMetadata} from '../src/coordinate-frame-format.js';
import {segmentedClockSynchronizationMetadata} from '../src/segmented-clock-synchronization-format.js';
import {tensorValuesMetadata} from '../src/tensor-values-format.js';
import {axisPermutationMetadata} from '../src/axis-permutation-format.js';
import {domainAlgebraMetadata} from '../src/domain-algebra-format.js';
import {measurementScalarMetadata} from '../src/measurement-scalar-format.js';
import {clockSynchronizationMetadata} from '../src/clock-synchronization-format.js';
import {datasetResourceMetadata} from '../src/dataset-resource-format.js';
import {windowCalculationMetadata} from '../src/dataset-window-format.js';
import {sequenceValuesMetadata} from '../src/sequence-values-format.js';
import {topologyValuesMetadata} from '../src/topology-values-format.js';
import {coordinateAlignmentMetadata} from '../src/coordinate-alignment-format.js';
import {spectralMethodsMetadata} from '../src/spectral-methods-format.js';
const object='.observanda/materials/objects/id/revision.json',job='.observanda/jobs/job.json',base={website:0,staged:false,owners:0,publication:false,transfers:false};
const inherited={referencedCalculationMetadata,computedCellMetadata,coordinateFrameMetadata,segmentedClockSynchronizationMetadata,tensorValuesMetadata,axisPermutationMetadata,domainAlgebraMetadata,measurementScalarMetadata,clockSynchronizationMetadata,datasetResourceMetadata,windowCalculationMetadata,sequenceValuesMetadata,topologyValuesMetadata};

test('graph17 and recipe20 retain graph16 capabilities while historical and future boundaries stay explicit',()=>{
 for(const version of [16,17])for(const [name,classify]of Object.entries(inherited))for(const [path,value]of [[object,{content:{tool:'Observanda calculation graph',graphVersion:version}}],[object,{content:{calculation:{version:version+3}}}],[job,{type:'dataset.prepare',input:{command:{calculation:{version:version+3}}}}]])assert.equal(!!classify(path,value),true,name+' '+version+' '+path);
 for(const graphVersion of [16,17,18]){const graph={content:{tool:'Observanda calculation graph',graphVersion}},recipe={content:{calculation:{version:graphVersion+3}}},queued={input:{command:{calculation:{version:graphVersion+3}}}};assert.equal(coordinateAlignmentMetadata(object,graph),graphVersion===17);assert.equal(coordinateAlignmentMetadata(object,recipe),graphVersion===17);assert.equal(coordinateAlignmentMetadata(job,queued),graphVersion===17);assert.equal(spectralMethodsMetadata(object,graph),false);if(graphVersion===18)for(const [name,classify]of Object.entries(inherited)){// The historical resource detector intentionally marks every generation >=5;
// it requests its resource owner but does not admit an unknown graph recipe.
assert.equal(!!classify(object,graph),name==='datasetResourceMetadata',name+' unknown graph boundary');assert.equal(!!classify(object,recipe),false,name+' unknown recipe');assert.equal(!!classify(job,queued),false,name+' unknown queue');}}
 assert.equal(topologyValuesMetadata(object,{content:{tool:'Observanda calculation graph',graphVersion:15}}),false);assert.equal(sequenceValuesMetadata(object,{content:{tool:'Observanda calculation graph',graphVersion:14}}),false);
});

test('graph17 verifier rejects every independently missing capability before compilation and leaves graph16 historical',async()=>{
 const id='alignmentFormats_'+randomUUID().replaceAll('-',''),hooks=registerHooks({resolve(specifier,context,next){return specifier==='./scratch-work.js'&&context.parentURL?.includes('alignment-format=')?{url:'alignment-format:'+id,shortCircuit:true}:next(specifier,context);},load(url,context,next){return url==='alignment-format:'+id?{format:'module',shortCircuit:true,source:'export const withScratch=operation=>operation({add:async()=>true,has:async()=>true});'}:next(url,context);}});let CalculationGraphs;try{({CalculationGraphs}=await import('../src/calculation-graphs.js?alignment-format='+id));}finally{hooks.deregister();}
 const names=['coordinateAlignment','topologyValues','sequenceValues','referencedCalculations','windowCalculations','datasetResourcePolicies','measurementScalarPolicies','domainAlgebra','clockSynchronization','tensorValues','axisPermutation','segmentedClockSynchronization','coordinateFrames','nativeDomainValues','nativeNumericalModels','computedCells','calculationPolicies','structuredCalculator','approximateCalculator'],complete=Object.fromEntries(names.map(name=>[name,true]));let flags=complete,compiled=0;const db={all:async()=>[{version:String(configurationCatalogueGeneration({...base,...flags}))}]},workspace={storageKind:()=> 'catalogue',catalogue:operation=>operation({db,catalogueDb:db})},materials={workspace,sequences:{validate:value=>value,items:async function*(){}},references:async function*(){}},graphs=new CalculationGraphs(materials),doc={kind:'analysis',content:{tool:'Observanda calculation graph',graphVersion:17,graphNodesIndex:{kind:'calculation-nodes'}}};graphs.compile=async()=>{compiled++;};graphs.references=async function*(){};
 await graphs.verify(doc);assert.equal(compiled,1);for(const name of names){flags={...complete,[name]:false};await assert.rejects(graphs.verify(doc),{code:'CATALOGUE_DAMAGED'},name);assert.equal(compiled,1,name+' admission precedes compiler');}
 flags={...complete,coordinateAlignment:false};await graphs.verify({...doc,content:{...doc.content,graphVersion:16}});assert.equal(compiled,2,'historical graph16 does not acquire alignment-specific requirements');
});

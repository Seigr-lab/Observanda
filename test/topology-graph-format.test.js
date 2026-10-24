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
const object='.observanda/materials/objects/id/revision.json',job='.observanda/jobs/job.json',chunk='.observanda/materials/sequences/chunks/hash.json',base={website:0,staged:false,owners:0,publication:false,transfers:false};
const classifiers={referencedCalculationMetadata,computedCellMetadata,coordinateFrameMetadata,segmentedClockSynchronizationMetadata,tensorValuesMetadata,axisPermutationMetadata,domainAlgebraMetadata,measurementScalarMetadata,clockSynchronizationMetadata,datasetResourceMetadata,windowCalculationMetadata,sequenceValuesMetadata};
test('graph16 and recipe19 retain every graph15 interpretation in saved objects, queued commands and output datasets',()=>{
 for(const graphVersion of [15,16]){const graph={content:{tool:'Observanda calculation graph',graphVersion}},calculation={version:graphVersion+3};for(const [name,classify]of Object.entries(classifiers)){assert.equal(!!classify(object,graph),true,name+' graph'+graphVersion);assert.equal(!!classify(object,{content:{calculation}}),true,name+' result');assert.equal(!!classify(job,{type:'dataset.prepare',input:{command:{calculation}}}),true,name+' queue');}assert.equal(!!topologyValuesMetadata(object,graph),graphVersion===16);assert.equal(!!topologyValuesMetadata(job,{input:{command:{calculation}}}),graphVersion===16);}
 for(const graphVersion of [14,15,16]){assert.equal(referencedCalculationMetadata(object,{content:{tool:'Observanda calculation graph',graphVersion}}),true);for(const path of [object,job])assert.equal(referencedCalculationMetadata(path,path===object?{content:{calculation:{version:graphVersion+3}}}:{input:{command:{calculation:{version:graphVersion+3}}}}),true);}assert.equal(referencedCalculationMetadata(object,{content:{tool:'Observanda calculation graph',graphVersion:17}}),false);assert.equal(referencedCalculationMetadata(job,{input:{command:{calculation:{version:20}}}}),false);
 assert.equal(!!measurementScalarMetadata(chunk,{kind:'cells',items:[{value:{format:'domain-value',version:5}}]}),true);assert.equal(!!measurementScalarMetadata(chunk,{kind:'cells',items:[{value:{format:'domain-value',version:6}}]}),false);
});
test('graph verification refuses each inherited capability independently before compilation',async()=>{
 const id='topologyFormats_'+randomUUID().replaceAll('-',''),hooks=registerHooks({resolve(specifier,context,next){return specifier==='./scratch-work.js'&&context.parentURL?.includes('topology-format=')?{url:'topology-format:'+id,shortCircuit:true}:next(specifier,context);},load(url,context,next){return url==='topology-format:'+id?{format:'module',shortCircuit:true,source:'export const withScratch=operation=>operation({add:async()=>true,has:async()=>true});'}:next(url,context);}});let CalculationGraphs;try{({CalculationGraphs}=await import('../src/calculation-graphs.js?topology-format='+id));}finally{hooks.deregister();}
 const names=['topologyValues','sequenceValues','referencedCalculations','windowCalculations','datasetResourcePolicies','measurementScalarPolicies','domainAlgebra','clockSynchronization','tensorValues','axisPermutation','segmentedClockSynchronization','coordinateFrames','nativeDomainValues','nativeNumericalModels','computedCells','calculationPolicies','structuredCalculator','approximateCalculator'],complete=Object.fromEntries(names.map(name=>[name,true]));let flags=complete,compiled=0;const db={all:async()=>[{version:String(configurationCatalogueGeneration({...base,...flags}))}]},workspace={storageKind:()=> 'catalogue',catalogue:operation=>operation({db,catalogueDb:db})},materials={workspace,sequences:{validate:value=>value,items:async function*(){}},references:async function*(){}},graphs=new CalculationGraphs(materials),doc={kind:'analysis',content:{tool:'Observanda calculation graph',graphVersion:16,graphNodesIndex:{kind:'calculation-nodes'}}};graphs.compile=async()=>{compiled++;};graphs.references=async function*(){};
 await graphs.verify(doc);assert.equal(compiled,1);for(const name of names){flags={...complete,[name]:false};await assert.rejects(graphs.verify(doc),{code:'CATALOGUE_DAMAGED'},name);assert.equal(compiled,1,name+' admission precedes compiler');}
 flags={...complete,topologyValues:false};await graphs.verify({...doc,content:{...doc.content,graphVersion:15}});assert.equal(compiled,2,'historical graph15 does not acquire topology-specific requirements');
});

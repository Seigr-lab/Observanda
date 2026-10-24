import {projectSourceJobOwner} from '../src/project-source-job-owner.js';
import {materialPartKey} from '../src/material-part-identity.js';
import {createNumericalExecutionState,reserveNumericalExecution} from '../src/numerical-execution-budget.js';
import {defaultNumericalExecutionPolicy} from '../src/web/numerical-execution-policy.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {defaultStructuredCalculationPolicy} from '../src/web/tools/calculation-policy.js';
import {SPECTRUM_CONVENTIONS} from '../src/web/dataset-spectrum-model.js';
import {blankUnitDefinition,exactUnitScalar} from '../src/web/measurement-unit-model.js';
import {digest} from '../src/storage-format.js';
import {revisionText} from '../src/web/revision-model.js';
import {randomUUID} from 'node:crypto';
import {recordOwnerMetadataDependencies} from '../src/record-owner-resources.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {configurationCatalogueGeneration,configurationCatalogueFeatures,restoreConfigurationCatalogueFormat,requireDatasetSpectra,requireNumericalExecution,CATALOGUE_MAX_GENERATION} from '../src/catalogue-format.js';
import {numericalExecutionMetadata,assertNumericalExecutionFormat} from '../src/numerical-execution-format.js';
import {spectrumMetadata} from '../src/dataset-spectrum-format.js';
const base={website:0,staged:false,owners:0,publication:false,transfers:false};
function database(format=122){let stored=format;return {db:{all:async()=>[{version:String(stored)}],get:async()=>null,run:async(sql,...values)=>{if(sql.startsWith('UPDATE catalogue_format'))stored=values[0];}},get format(){return stored;}};}
const workspace=flags=>({storageKind:()=> 'catalogue',catalogue:operation=>operation({catalogueDb:database(configurationCatalogueGeneration({...base,...flags})).db})});
test('numerical execution admission is independent, survives both upgrade orders, and restores exactly',async()=>{
 for(const order of [[requireNumericalExecution,requireDatasetSpectra],[requireDatasetSpectra,requireNumericalExecution]])for(const website of [0,3])for(const owners of [0,2]){
  const db=database(configurationCatalogueGeneration({...base,website,owners}));for(const upgrade of order)await upgrade(db.db);const features=configurationCatalogueFeatures(db.format);assert.equal(features.numericalExecution,true);assert.equal(features.datasetSpectra,true);assert.equal(features.datasetResourcePolicies,true);assert.equal(features.website,website);assert.equal(features.owners,owners);const recovered=database();await restoreConfigurationCatalogueFormat(recovered.db,db.format);assert.equal(recovered.format,db.format);
 }
 const only=database();await requireNumericalExecution(only.db);assert.equal(configurationCatalogueFeatures(only.format).datasetSpectra,undefined);assert.equal(configurationCatalogueFeatures(3298534883449).numericalExecution,undefined);assert.equal(configurationCatalogueFeatures(3298534883450).numericalExecution,true);assert.equal(configurationCatalogueFeatures(3298534883450).datasetSpectra,undefined);assert.equal(configurationCatalogueGeneration(configurationCatalogueFeatures(CATALOGUE_MAX_GENERATION)),CATALOGUE_MAX_GENERATION);
 const lock=database();lock.db.run=async()=>{throw Object.assign(Error('busy'),{code:'55P03'});};await assert.rejects(requireNumericalExecution(lock.db),{code:'LOCKED'});assert.equal(lock.format,122);
});
test('numerical work and outputs refuse missing admission requirements independently',async()=>{
 await assertNumericalExecutionFormat(workspace({numericalExecution:true,datasetResourcePolicies:true}));for(const flags of [{datasetResourcePolicies:true},{numericalExecution:true},{}])await assert.rejects(assertNumericalExecutionFormat(workspace(flags)),{code:'CATALOGUE_DAMAGED'});
});
test('new work, recipes and copied interpretation require admission while historical spectra remain unchanged',()=>{
 for(const version of [1,2]){const job={input:{command:{spectrum:{version}}}},path='.observanda/jobs/example.json';assert.equal(spectrumMetadata(path,job),true);assert.equal(numericalExecutionMetadata(path,job),version===2);for(const content of [{spectrum:{version}},{measurement:{spectrum:{version}}}]){const p='.observanda/materials/objects/example.json';assert.equal(spectrumMetadata(p,{content}),true);assert.equal(numericalExecutionMetadata(p,{content}),version===2);}assert.equal(numericalExecutionMetadata('.observanda/materials/sequences/chunks/example.json',{kind:'columns-policy',items:[{spectrum:{version}}]}),version===2);}
 for(const path of ['numerical-work/job.json','sequences/numerical-work-nodes/hash.json','sequences/numerical-work-values/hash.json','sequences/numerical-work-chunks/hash.json'])assert.equal(numericalExecutionMetadata('.observanda/materials/'+path,{}),true);
 assert.equal(numericalExecutionMetadata('.observanda/materials/objects/example.json',{content:{numericalExecution:1}}),true);assert.equal(numericalExecutionMetadata('.observanda/private-notes.json',{content:{numericalExecution:1}}),false);assert.equal(numericalExecutionMetadata('.observanda/materials/sequences/chunks/hash.json',{kind:'cell-text',items:['numerical-work']}),false);
});

test('record transfer follows a numerical checkpoint through immutable pages and a retained large value',async()=>{
 const p='.observanda/materials/',hashes=['a','b','c','d','e'].map(c=>c.repeat(64)),job='.observanda/jobs/job.json',checkpoint=p+'numerical-work/job.json',root=p+'sequences/numerical-work-nodes/'+hashes[0]+'.json',value=p+'sequences/numerical-work-values/'+hashes[1]+'.json',sequence=p+'sequences/nodes/'+hashes[2]+'.json',chunk=p+'sequences/chunks/'+hashes[3]+'.json',bytes=p+'sequences/numerical-work-chunks/'+hashes[4]+'.json';
 const entries=new Map([[job,{input:{command:{spectrum:{version:2}}}}],[checkpoint,{root:{hash:hashes[0]}}],[root,{entries:[{id:'key',revision:hashes[1]}]}],[value,{version:2,value:{chunks:{root:{hash:hashes[2]}}}}],[sequence,{revision:hashes[3]}],[chunk,{kind:'pages',items:[hashes[4]]}],[bytes,{data:'e30='}]]),store={object:async key=>entries.has(key.slice(9))?{text:JSON.stringify(entries.get(key.slice(9)))}:null},seen=new Set();
 async function visit(path){if(seen.has(path))return;seen.add(path);for(const dependency of await recordOwnerMetadataDependencies(store,path,JSON.stringify(entries.get(path)))){assert.equal(dependency.kind,'object');assert.equal(dependency.key.startsWith('metadata:'),true);await visit(dependency.key.slice(9));}}
 await visit(job);assert.deepEqual([...seen].sort(),[...entries.keys()].sort());
});

test('project ownership classifies pending numerical work without settling its reservation',async()=>{
 const jobId=randomUUID(),recordId=randomUUID(),projectId=randomUUID(),namespaceId=randomUUID(),executionPolicy=defaultNumericalExecutionPolicy(),command={id:randomUUID(),recordId,title:'Scoped result',expectedRevision:null,spectrum:{version:2,method:'radix2-fft-v1',source:{kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},column:0,range:{start:0,count:64},sampling:{step:exactUnitScalar('1'),origin:exactUnitScalar('0'),unitDefinition:blankUnitDefinition(),coordinateColumn:null},calculationPolicy:defaultStructuredCalculationPolicy(),resourcePolicy:defaultDatasetResourcePolicy(),executionPolicy,...SPECTRUM_CONVENTIONS}},identity=digest(revisionText(command)),reservation=reserveNumericalExecution(createNumericalExecutionState(identity,executionPolicy),{id:randomUUID(),operations:500,activeMilliseconds:50}),checkpoint={version:1,kind:'spectrum',commandHash:identity,ledger:reservation,cursor:null,root:null},file='.observanda/materials/numerical-work/'+jobId+'.json',job={format:1,id:jobId,type:'dataset.prepare',scope:recordId,state:'running',attempt:1,cancelRequested:false,progress:{stage:'input',done:0,total:64},input:{command},lease:{token:randomUUID(),until:Date.now()+30000},createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'},files=new Map([[file,JSON.stringify(checkpoint)],['.observanda/jobs/'+jobId+'.json',JSON.stringify(job)]]);
 let writes=0,store;const workspace={root:'.',metadataPath:value=>value,readMetadata:async key=>files.get(key)??null,writeMetadata:async()=>{writes++;throw Error('read-only classification');},catalogue:async operation=>operation(store),inspectCatalogue:async(_store,operation)=>operation()};store={workspace};const owner=projectSourceJobOwner(store,{namespaceId,projectId},async id=>{assert.equal(id,recordId);return {kind:'project',projectId};}),before=files.get(file);
 assert.deepEqual(await owner('metadata:'+file),{kind:'project',projectId});assert.equal(files.get(file),before);assert.equal(writes,0);files.set(file,JSON.stringify({...checkpoint,commandHash:'b'.repeat(64)}));await assert.rejects(owner('metadata:'+file),{code:'MATERIAL_CHANGED'});files.delete(file);await assert.rejects(owner('metadata:'+file),{code:'JOB_DAMAGED'});
});
test('immutable numerical work pages participate in retained material ownership, but mutable checkpoints do not',()=>{
 for(const kind of ['nodes','values','chunks'])assert.equal(materialPartKey('metadata:.observanda/materials/sequences/numerical-work-'+kind+'/'+'a'.repeat(64)+'.json'),true);
 assert.equal(materialPartKey('metadata:.observanda/materials/numerical-work/'+randomUUID()+'.json'),false);assert.equal(materialPartKey('metadata:.observanda/materials/sequences/numerical-work-unknown/'+'a'.repeat(64)+'.json'),false);
});

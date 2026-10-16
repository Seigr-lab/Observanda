import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {AnalysisComparisons} from '../src/analysis-comparisons.js';
import {createComparisonInputReader} from '../src/comparison-input-reader.js';
import {analysisDependencyState} from '../src/analysis-dependencies.js';
import {blankAnalysisMethod,blankAnalysisSource,addressedComparisonInputs,validComparison,analysisIdentity} from '../src/web/analysis-model.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {recordRevision,ResearchRecords} from '../src/research.js';
import {AppError} from '../src/errors.js';
import {withWorkspaceMetadataBatch} from '../src/metadata-batch.js';
import {MaterialIndex} from '../src/material-index.js';
import {materialRecordSummary} from '../src/material-record-summary.js';
import {ComparisonIndex} from '../src/analysis-comparison-index.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';

const addressed=(ref,owner)=>({...ref,workspaceId:owner.book.id});
async function fixture(t,{rows=3}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-comparison-owners-')),template=upgradeNotebook(sampleNotebook()),owners=[];
 t.after(async()=>{for(const owner of owners)clearVault(owner.vault);await rm(directory,{recursive:true,force:true});});
 for(let i=0;i<3;i++){
  const book={...structuredClone(template),id:randomUUID()},f=await encryptedFixture(path.join(directory,String(i)),book),m=new ResearchMaterials(f.workspace);owners.push({...f,book,m,recordId:book.entries[0].id});
 }
 const [output,first,second]=owners,datasetId=randomUUID();
 for(const [index,owner] of [first,second].entries()){
  const text='Key,Value,State\n'+Array.from({length:rows},(_,i)=>i+','+(10*index+i)+',correct').join('\n'),bytes=Buffer.from(text),upload=await owner.m.startImport({recordId:owner.recordId,name:'readings.csv',size:bytes.length});
  await owner.m.appendImport(upload.id,0,[bytes]);owner.artifact=await owner.m.finishImport(upload.id);
  owner.columns=['Key','Value','State'].map(label=>defaultColumn({label}));owner.columns[1].representation='integer';
  owner.dataset=await owner.m.dataset({id:datasetId,recordId:owner.recordId,title:'Retained readings',artifact:owner.artifact,columns:owner.columns});
  owner.run={kind:'record',id:owner.recordId,revision:recordRevision(owner.book.entries[0]),workspaceId:owner.book.id};
 }
 let active=0,closed=0,allowed=true;const visits=[],access={
  async use(ref,consume){assert.equal(active,0,'Source contexts must not overlap');assert.equal(allowed,true);const owner=owners.find(o=>o.book.id===ref.workspaceId);if(!owner)throw new AppError('WORKSPACE_CHANGED');active++;visits.push(ref);try{return await owner.workspace.catalogue(()=>consume(owner.workspace,ref,{owner:{workspaceId:owner.book.id}}));}finally{active--; }},
  async verify(){if(!allowed)throw new AppError('ACCESS_LOCKED');},async close(){closed++;}
 };
 const inputs=createComparisonInputReader(output.m,{workspaceId:output.book.id,access}),comparison=new AnalysisComparisons(output.m,{inputs});t.after(()=>inputs.close());
 const sources=[first,second].map(owner=>{const source=blankAnalysisSource(addressed(owner.dataset,owner));source.run=owner.run;source.columns.value=1;source.columns.status=2;return source;});
 const command={recordId:output.recordId,title:'Across retained owners',tool:'Synthetic readings',version:'1',...addressedComparisonInputs({method:{...blankAnalysisMethod(),unavailable:'No external tool.',uncertainty:'Unspecified instrument uncertainty.',limitations:'Synthetic data.'},comparison:{version:1,sources,ordering:'source',expected:{dataset:addressed(second.dataset,second),source:0,actualKey:0,key:0,value:1,rationale:'Compare corresponding retained rows.'}}},output.book.id)};
 return {output,first,second,owners,inputs,comparison,command,visits,access,get active(){return active;},get closed(){return closed;},set allowed(value){allowed=value;}};
}

test('new comparison identities require namespaces without changing historical identity or source documents',()=>{
 const a={kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},one=blankAnalysisSource({...a,workspaceId:randomUUID()}),two=blankAnalysisSource({...a,workspaceId:randomUUID()});one.columns.value=two.columns.value=0;
 const comparison={version:1,sources:[one,two],ordering:'source',expected:null},method={...blankAnalysisMethod(),references:{toolSource:a,decoder:null,calibration:null},parameters:[{name:'Input',value:'1',unit:'',reference:a,reason:''}]},original=structuredClone({method,comparison}),workspaceId=randomUUID();
 const next=addressedComparisonInputs({method,comparison},workspaceId);
 assert.deepEqual({method,comparison},original);assert.equal(validComparison(comparison),false);assert.equal(validComparison(next.comparison),true);
 assert.equal(next.method.references.toolSource.workspaceId,workspaceId);assert.equal(next.method.parameters[0].reference.workspaceId,workspaceId);assert.equal(next.comparison.sources[0].dataset.workspaceId,one.dataset.workspaceId);
 assert.equal(analysisIdentity(one.dataset),analysisIdentity(two.dataset));assert.notEqual(analysisIdentity(one.dataset,2),analysisIdentity(two.dataset,2));
 delete next.comparison.sources[1].dataset.workspaceId;assert.equal(validComparison(next.comparison),false);
});

test('addressed comparisons read exact source pages and record history without writing or pinning foreign owners',async t=>{
 const f=await fixture(t),firstDoc=await f.first.m.read(f.first.dataset);
 const {datasetFormat,pageIndex,schemaIndex,...legacyContent}=firstDoc.content;
 const pages=await Array.fromAsync(f.first.m.sequences.items(pageIndex)),legacy=await f.first.workspace.withLock(()=>f.first.m.commit({kind:'dataset',recordId:f.first.recordId,title:'Earlier retained format',content:{...legacyContent,pages,columns:f.first.columns}}));
 const revisedRecord={...f.first.book.entries[0],title:'Later description of the same run'};
 await new ResearchRecords(f.first.workspace,{}).save({workspaceId:f.first.book.id,changes:[{id:f.first.recordId,expectedRevision:f.first.run.revision,record:revisedRecord}]},{compact:true});
 const revisedRun={...f.first.run,revision:await f.first.workspace.catalogue(async store=>(await materialRecordSummary(store,await store.member(await store.snapshot(),f.first.recordId))).revision)};assert.notEqual(revisedRun.revision,f.first.run.revision);
 const indexed=await f.first.workspace.withLock(async()=>{const builder=f.first.m.sequences.builder('references',fn=>fn());for(let i=0;i<70;i++)await builder.append(i===69?addressed(f.second.artifact,f.second):f.first.artifact);return f.first.m.commit({kind:'analysis',recordId:f.first.recordId,title:'Indexed provenance',content:{inputsIndex:await builder.finish()}});});
 const dependencyFile='.observanda/materials/index/dependencies/'+f.first.dataset.id+'/'+f.first.dataset.revision+'.json';
 await f.first.workspace.withLock(async()=>{await f.first.workspace.removeMetadata(dependencyFile);await f.first.workspace.removeMetadata('.observanda/materials/index/state.json');});
 for(const source of [f.first,f.second])await source.workspace.withLock(()=>source.workspace.removeMetadata('.observanda/materials/records/'+source.run.id+'/'+source.run.revision+'.json'));
 await assert.doesNotReject(f.inputs.read(f.first.run),'Original source run remains in authenticated history');await assert.doesNotReject(f.inputs.read(revisedRun),'Revised source run has its authenticated content revision');
 const writes=[];for(const source of [f.first,f.second]){t.mock.method(source.workspace,'writeMetadata',()=>{writes.push(source.book.id);assert.fail('Foreign metadata write');});t.mock.method(source.workspace,'withLock',()=>assert.fail('Foreign writer acquisition'));}
 t.mock.method(MaterialIndex.prototype,'ensure',()=>assert.fail('Read-only input must not initialize an index'));
 const nested=await Array.fromAsync(f.inputs.inputs(addressed(indexed,f.first)));assert.equal(nested.length,70);assert.equal(nested[0].workspaceId,f.first.book.id);assert.equal(nested[69].workspaceId,f.second.book.id);
 const legacyDoc=await f.inputs.read(addressed(legacy,f.first));assert.deepEqual(await f.inputs.datasetColumns(legacyDoc),f.first.columns);assert.equal((await Array.fromAsync(f.inputs.iterateDataset(addressed(legacy,f.first)))).length,3);
 const inputRefs=await Array.fromAsync(f.inputs.inputs(addressed(f.first.dataset,f.first)));assert.ok(inputRefs.some(r=>r.id===f.first.artifact.id&&r.workspaceId===f.first.book.id));
 const both=await Promise.all([f.inputs.read(addressed(f.first.dataset,f.first)),f.inputs.read(addressed(f.second.dataset,f.second))]);
 assert.equal(both[0].id,both[1].id);assert.notEqual(both[0].content.inputs[0].revision,both[1].content.inputs[0].revision);
 const [a,b]=await Promise.all(both.map(doc=>f.inputs.retainedDatasetPage(doc,0)));assert.equal(a.rows[0].cells[1],'0');assert.equal(b.rows[0].cells[1],'10');
 assert.throws(()=>f.inputs.datasetPageCount(structuredClone(both[0])),{code:'MATERIAL_INVALID'});
 const ref=await f.comparison.save(f.command,{writePage:fn=>{assert.equal(f.active,0,'A source read cannot span an output transaction');return f.output.workspace.withLock(()=>withWorkspaceMetadataBatch(f.output.workspace,fn));}}),doc=await f.output.m.read(ref);
 assert.equal(doc.content.summary.algorithmVersion,'3');assert.equal(doc.content.summary.runs,2);assert.equal(doc.content.summary.counts.groups,2);assert.equal(doc.content.summary.verification.mismatched,3);
 const groups=(await f.output.m.comparisons.page({ref,view:'groups'})).items;assert.deepEqual(new Set(groups.map(g=>g.run.workspaceId)),new Set([f.first.book.id,f.second.book.id]));
 await f.comparison.verify(f.command,doc.content.summary);
 const earlier=f.command.comparison.sources[0],sameRun=await f.comparison.prepare({...f.command,comparison:{...f.command.comparison,sources:[earlier,{...earlier,dataset:addressed(legacy,f.first),run:revisedRun}],expected:null}},{retained:true});
 assert.equal(sameRun.content.summary.runs,1,'Different retained descriptions do not create a second run');assert.equal(sameRun.content.summary.counts.groups,2,'Revision-specific groups remain distinct');
 await assert.rejects(f.comparison.verify(f.command,{...doc.content.summary,algorithmVersion:'2'}),{code:'CATALOGUE_DAMAGED'});
 const readMetadata=f.second.workspace.readMetadata;f.second.workspace.readMetadata=function(name,...args){return name.startsWith('.observanda/materials/tables/')?Promise.resolve('[]'):readMetadata.call(this,name,...args);};
 try{await assert.rejects(f.inputs.retainedDatasetPage(both[1],0),{code:'MATERIAL_MISSING'});}finally{f.second.workspace.readMetadata=readMetadata;}
 for(const source of [f.first,f.second])assert.equal(await source.workspace.readMetadata('.observanda/materials/records/'+source.run.id+'/'+source.run.revision+'.json',16777216),null);
 assert.deepEqual(writes,[]);assert.equal(await f.first.workspace.readMetadata('.observanda/materials/index/state.json',1024),null);assert.deepEqual(await f.first.m.read(f.first.dataset),firstDoc);
 f.allowed=false;assert.equal((await f.output.m.comparisons.page({ref,view:'all'})).items.length,6,'Retained results remain inspectable without replaying inaccessible sources');
 await assert.rejects(f.comparison.prepare(f.command),{code:'ACCESS_LOCKED'});
 await f.inputs.close();assert.equal(f.closed,1);await assert.rejects(f.inputs.read(addressed(f.first.dataset,f.first)),{code:'WORKSPACE_CHANGED'});
});

test('source access loss fences checkpoint and commit; a new reader resumes only the exact qualified command',async t=>{
 const f=await fixture(t,{rows:35}),id=randomUUID(),command={...f.command,id},file='.observanda/materials/comparison-work/'+id+'.json';let batches=0;
 await assert.rejects(f.comparison.prepare(command,{jobId:id,writePage:fn=>f.output.workspace.withLock(()=>withWorkspaceMetadataBatch(f.output.workspace,async()=>{if(++batches===2)f.allowed=false;return fn();}))}),{code:'ACCESS_LOCKED'});
 const checkpoint=JSON.parse(await f.output.workspace.readMetadata(file,1048576));assert.equal(checkpoint.summary.rows,32);assert.equal(checkpoint.summary.algorithmVersion,'3');assert.equal(await f.output.m.current(id),null);
 f.allowed=true;await f.inputs.close();const inputs=createComparisonInputReader(f.output.m,{workspaceId:f.output.book.id,access:{...f.access}}),comparison=new AnalysisComparisons(f.output.m,{inputs});t.after(()=>inputs.close());
 await assert.rejects(comparison.prepare({...command,comparison:{...command.comparison,version:1}},{jobId:id}),{code:'MATERIAL_CHANGED'});
 const prepared=await comparison.prepare(command,{jobId:id});assert.equal(prepared.content.summary.rows,70);
 f.allowed=false;await assert.rejects(f.output.workspace.withLock(()=>comparison.commit(command,prepared)),{code:'ACCESS_LOCKED'});assert.equal(await f.output.m.current(id),null);
 f.allowed=true;const ref=await f.output.workspace.withLock(()=>comparison.commit(command,prepared));assert.equal(await f.output.workspace.readMetadata(file,1048576),null);assert.equal((await f.output.m.read(ref)).content.summary.rows,70);
 const sources=[{recordId:f.output.recordId,resultId:randomUUID(),analysis:addressed(ref,f.output)}],before=await analysisDependencyState(f.output.m,sources,{inputs});assert.equal(before.items.length,0);
 await f.first.m.dataset({recordId:f.first.recordId,title:'Updated schema',id:f.first.dataset.id,expectedRevision:f.first.dataset.revision,artifact:f.first.artifact,baseDataset:f.first.dataset,columnChanges:[{index:1,column:{...f.first.columns[1],unit:'count'}}]});
 t.mock.method(ResearchMaterials.prototype,'retainedDatasetPage',()=>assert.fail('Dependency review must not read table rows'));
 t.mock.method(ResearchMaterials.prototype,'artifact',()=>assert.fail('Dependency review must not read original bytes'));
 t.mock.method(MaterialIndex.prototype,'ensure',()=>assert.fail('Dependency review must not write source indexes'));
 const after=await analysisDependencyState(f.output.m,sources,{inputs});assert.notEqual(after.fingerprint,before.fingerprint);assert.equal(after.items[0].changed,1);assert.equal(after.items[0].sample[0].workspaceId,f.first.book.id);assert.equal(after.items[0].sample[0].id,f.second.dataset.id);
 f.allowed=false;await assert.rejects(analysisDependencyState(f.output.m,sources,{inputs}),{code:'ACCESS_LOCKED'});
});


test('routed local dependency fingerprints preserve implicit and explicit identities and only local record-head overrides',async t=>{
 const f=await fixture(t),owner=f.first,local=createComparisonInputReader(owner.m,{workspaceId:owner.book.id});t.after(()=>local.close());
 const implicit={kind:'record',id:owner.run.id,revision:owner.run.revision},refs=[owner.artifact,addressed(owner.artifact,owner),implicit,owner.run];
 const analysis=await owner.workspace.withLock(()=>owner.m.commit({kind:'analysis',recordId:owner.recordId,title:'Mixed reference spellings',content:{inputs:refs}}));
 const sources=[{recordId:owner.recordId,resultId:randomUUID(),analysis}];let oldCalls=0,newCalls=0;
 const before=await analysisDependencyState(owner.m,sources,{recordHead:async id=>{assert.equal(id,owner.recordId);oldCalls++;return 'b'.repeat(64);}});
 const after=await analysisDependencyState(owner.m,sources,{inputs:local,recordHead:async id=>{assert.equal(id,owner.recordId);newCalls++;return 'b'.repeat(64);}});
 assert.deepEqual(after,before);assert.equal(oldCalls,2);assert.equal(newCalls,2);assert.deepEqual(await Array.fromAsync(local.inputs(analysis)),refs);
 const foreign=await f.inputs.current(owner.run,{recordHead:()=>assert.fail('Foreign record head must not use result-owner snapshot')});assert.equal(foreign.revision,owner.run.revision);assert.equal(foreign.local,false);
 const alias=randomUUID(),reader=createComparisonInputReader(owner.m,{workspaceId:owner.book.id,access:{verify:async()=>{},close:async()=>{},use:(ref,consume)=>owner.workspace.catalogue(()=>consume(owner.workspace,{...ref,workspaceId:owner.book.id}))}});t.after(()=>reader.close());
 let aliasCalls=0;const canonical=await reader.current({...owner.run,workspaceId:alias},{recordHead:async()=>{aliasCalls++;return owner.run.revision;}});assert.equal(canonical.local,true);assert.equal(aliasCalls,1);
 const forged=createComparisonInputReader(owner.m,{workspaceId:owner.book.id,access:{verify:async()=>{},close:async()=>{},use:(ref,consume)=>consume(owner.workspace,{...ref,id:randomUUID()})}});t.after(()=>forged.close());await assert.rejects(forged.read(owner.run),{code:'WORKSPACE_CHANGED'});
 const controller=new AbortController(),cancelled=createComparisonInputReader(owner.m,{workspaceId:owner.book.id,signal:controller.signal});t.after(()=>cancelled.close());controller.abort();await assert.rejects(cancelled.read(owner.artifact),{name:'AbortError'});
});


test('owned comparison integrity and portable copies retain external addresses without requiring or copying source data',async t=>{
 const f=await fixture(t,{rows:65}),bytes=Buffer.from('Retained local method'),upload=await f.output.m.startImport({recordId:f.output.recordId,name:'method.txt',size:bytes.length});await f.output.m.appendImport(upload.id,0,[bytes]);const method=await f.output.m.finishImport(upload.id);
 const command=structuredClone(f.command);command.method.references.toolSource=addressed(method,f.output);command.method.unavailable='';command.comparison.sources[0].investigation={kind:'record',id:f.output.book.entries[1].id,revision:recordRevision(f.output.book.entries[1]),workspaceId:f.output.book.id};
 const reference=await f.comparison.save(command),doc=await f.output.m.read(reference);f.allowed=false;
 for(const source of [f.first,f.second]){t.mock.method(source.workspace,'catalogue',()=>assert.fail('Owner integrity opened an external database'));t.mock.method(source.workspace,'readMetadata',()=>assert.fail('Owner integrity read external metadata'));}
 await assert.rejects(f.comparison.verify(command,doc.content.summary),{code:'ACCESS_LOCKED'});
 let observations=0;const items=ComparisonIndex.prototype.items,started=Date.now();
 const spy=t.mock.method(ComparisonIndex.prototype,'items',async function*(table,options){for await(const row of items.call(this,table,options)){if(table==='observations')observations++;yield row;}});
 const integrity=await f.output.m.comparisons.verifyIntegrity(doc);assert.equal(integrity.rows,130);assert.equal(observations,130);spy.mock.restore();t.diagnostic(JSON.stringify({observations,integrityMs:Date.now()-started,manifestBytes:Buffer.byteLength(JSON.stringify(doc))}));
 const verification=await f.output.m.verify();assert.equal(verification.externalReferences,4);assert.ok(verification.originalBytes>=bytes.length);
 const root=await copyWorkspace(await copyPlan(f.output.workspace.root,path.join(path.dirname(f.output.workspace.root),'retained-copy')),{vault:f.output.vault}),restored=new ResearchMaterials(new Workspace(root,f.output.vault));
 assert.deepEqual(await restored.read(reference),doc);assert.equal((await restored.verify()).externalReferences,4);assert.equal(await restored.current(f.first.dataset.id),null);assert.equal(await restored.current(f.first.artifact.id),null);assert.equal((await restored.comparisons.page({ref:reference,view:'all',offset:120})).items.length,10);
 const index=restored.comparisons.index(doc.content.summary),entry=await index.tree.find({root:index.root},'row/observations/'+String(0).padStart(16,'0')),file='.observanda/materials/sequences/comparison-values/'+entry.revision+'.json',raw=await restored.workspace.readMetadata(file,1048576);
 await restored.workspace.withLock(()=>restored.workspace.writeMetadata(file,'{}'));await assert.rejects(restored.verify(),{code:'MATERIAL_MISSING'});await restored.workspace.withLock(()=>restored.workspace.writeMetadata(file,raw));
 const methodFile='.observanda/materials/objects/'+method.id+'/'+method.revision+'.json',methodRaw=await restored.workspace.readMetadata(methodFile,16777216);await restored.workspace.withLock(()=>restored.workspace.writeMetadata(methodFile,'{}'));await assert.rejects(restored.verify(),{code:'MATERIAL_MISSING'});await restored.workspace.withLock(()=>restored.workspace.writeMetadata(methodFile,methodRaw));
 await assert.rejects(restored.comparisons.verifyIntegrity({...doc,content:{...doc.content,inputs:[...doc.content.inputs,addressed(f.first.artifact,f.first)]}}),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(restored.comparisons.verifyIntegrity({...doc,content:{...doc.content,summary:{...doc.content.summary,sourceRows:[64,66]}}}),{code:'CATALOGUE_DAMAGED'});
 // A foreign address on another retained kind is not excused by the comparison
 // integrity boundary, even if that same source was declared by a comparison.
 await restored.workspace.withLock(()=>restored.commit({kind:'collection',recordId:f.output.recordId,title:'Undeclared external ownership',content:{inputs:[addressed(f.first.dataset,f.first)]}}));
 await assert.rejects(restored.verify(),{code:'MATERIAL_INVALID'});
});


test('owned comparison integrity preserves long retained context and exact margins beyond input spelling lengths',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-comparison-exact-')),book=upgradeNotebook(sampleNotebook()),f=await encryptedFixture(directory,book),materials=new ResearchMaterials(f.workspace);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const value='7'.repeat(3999)+'/'+'9'.repeat(4000),lower='0.'+'0'.repeat(8000)+'1e-8192',sequence='Retained context \t'+'.'.repeat(20000),text=['Value,Lower,Sequence,State',[value,lower,sequence,'correct'].join(',')].join('\n'),bytes=Buffer.from(text),recordId=book.entries[0].id;
 const upload=await materials.startImport({recordId,name:'exact-context.csv',size:bytes.length});await materials.appendImport(upload.id,0,[bytes]);const artifact=await materials.finishImport(upload.id);
 const columns=['Value','Lower','Sequence','State'].map(label=>defaultColumn({label}));columns[0].representation='rational';columns[1].representation='decimal';
 const dataset=await materials.dataset({recordId,title:'Exact retained context',artifact,columns}),source=blankAnalysisSource({...dataset,workspaceId:book.id});source.columns.value=0;source.columns.lower=1;source.columns.sequence=2;source.columns.status=3;
 const command={recordId,title:'Exact context comparison',tool:'Synthetic bounds',version:'1',...addressedComparisonInputs({method:{...blankAnalysisMethod(),unavailable:'No external tool.',uncertainty:'Exact synthetic values.',limitations:'Synthetic data.'},comparison:{version:1,sources:[source],ordering:'source',expected:null}},book.id)},inputs=createComparisonInputReader(materials,{workspaceId:book.id}),comparison=new AnalysisComparisons(materials,{inputs});t.after(()=>inputs.close());
 const ref=await comparison.save(command),doc=await materials.read(ref),row=(await materials.comparisons.page({ref,view:'all'})).items[0];
 assert.equal(row.sequence,sequence);assert.ok(row.margin.numerator.length>16384);assert.ok(row.margin.denominator.length>16384);assert.equal(row.boundary,'inside');
 assert.equal((await materials.comparisons.verifyIntegrity(doc)).rows,1);await comparison.verify(command,doc.content.summary);
});


test('authenticated source aliases deduplicate datasets and runs without rewriting retained provenance',async t=>{
 const f=await fixture(t,{rows:17}),alias=randomUUID();let destination=f.first;
 const access={...f.access,use:(reference,consume)=>f.access.use(reference.workspaceId===alias?{...reference,workspaceId:destination.book.id}:reference,consume)},inputs=createComparisonInputReader(f.output.m,{workspaceId:f.output.book.id,access}),comparison=new AnalysisComparisons(f.output.m,{inputs});t.after(()=>inputs.close());
 const command=structuredClone(f.command);command.comparison.expected=null;command.comparison.sources[1].run={...f.first.run,workspaceId:alias};
 const duplicate=structuredClone(command);duplicate.comparison.sources[1].dataset={...duplicate.comparison.sources[0].dataset,workspaceId:alias};
 await assert.rejects(comparison.prepare(duplicate),{code:'ANALYSIS_INVALID'});
 const id=randomUUID(),pending={...command,id};let batches=0;
 await assert.rejects(comparison.prepare(pending,{jobId:id,writePage:fn=>f.output.workspace.withLock(()=>withWorkspaceMetadataBatch(f.output.workspace,async()=>{if(++batches===2)throw new AppError('ACCESS_LOCKED');return fn();}))}),{code:'ACCESS_LOCKED'});
 const file='.observanda/materials/comparison-work/'+id+'.json',checkpoint=JSON.parse(await f.output.workspace.readMetadata(file,1048576));assert.equal(checkpoint.summary.rows,32);assert.equal(checkpoint.summary.runs,1);assert.equal(checkpoint.summary.sourceIdentities[1].run.workspaceId,f.first.book.id);
 destination=f.second;await assert.rejects(comparison.prepare(pending,{jobId:id}),{code:'MATERIAL_MISSING'});
 destination=f.first;const prepared=await comparison.prepare(pending,{jobId:id}),ref=await f.output.workspace.withLock(()=>comparison.commit(pending,prepared)),doc=await f.output.m.read(ref);
 assert.equal(doc.content.summary.runs,1);assert.equal(doc.content.summary.counts.groups,2);assert.equal(doc.content.comparison.sources[1].run.workspaceId,alias);assert.equal(doc.content.summary.sourceIdentities[1].run.workspaceId,f.first.book.id);
 const rows=(await f.output.m.comparisons.page({ref,view:'all',limit:50})).items;assert.equal(rows[17].run.workspaceId,alias);
 await comparison.verify(command,doc.content.summary);destination=f.second;await assert.rejects(comparison.verify(command,doc.content.summary),{code:'CATALOGUE_DAMAGED'});
 f.allowed=false;assert.equal((await f.output.m.comparisons.verifyIntegrity(doc)).rows,34,'Owned verification uses retained authenticated resolution without contacting moved sources');
 const damaged=structuredClone(doc);damaged.content.summary.sourceIdentities[1].run.id=randomUUID();await assert.rejects(f.output.m.comparisons.verifyIntegrity(damaged),{code:'CATALOGUE_DAMAGED'});
});

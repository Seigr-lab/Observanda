import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {clearVault} from '../src/encryption.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {defaultDomain} from '../src/web/measurement-domain-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {executeMaterialRequest} from '../src/material-requests.js';
import {policyScalarText} from '../src/dataset-resource-values.js';
import {verifyDatasetCell} from '../src/dataset-cell-storage.js';

// Focused follow-up for recipe18's retained scalar admission/read branch. The
// separate sequence lifecycle fixture already qualifies full copy and recovery.
test('recipe18 extracts and reads a long exact scalar under its pinned source and graph policies',{timeout:300000},async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-sequence-scalar-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider);let vault;
 t.after(async()=>{await provider.close();detach();if(vault)clearVault(vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-sequence-scalar-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const book=sampleNotebook(),fixture=await encryptedFixture(directory,book),m=new ResearchMaterials(fixture.workspace),recordId=book.entries[0].id,request=(operation,data)=>executeMaterialRequest(fixture.workspace,{material:operation},data,{signal:t.signal});vault=fixture.vault;
 const policy=defaultDatasetResourcePolicy();Object.assign(policy.resources,{maxScalarCharacters:12000,maxOperations:1000000,maxMilliseconds:30000});
 const spelling='0'.repeat(9000)+'10',definition={...defaultDomain('sequence'),namespace:'Pinned long numerical element',element:{kind:'numeric',representation:'radix-fraction',radix:6},resourcePolicy:policy},column={...defaultColumn({label:'Long sequence'}),representation:'domain',domain:definition},text='Values\n"'+JSON.stringify([spelling]).replaceAll('"','""')+'"',bytes=Buffer.from(text),upload=await m.startImport({recordId,name:'long-sequence-scalar.csv',size:bytes.length});await m.appendImport(upload.id,0,[bytes]);const artifact=await m.finishImport(upload.id),source=await m.dataset({recordId,title:'Long exact sequence source',artifact,columns:[column]},{signal:t.signal});
 let graph=(await request('calculation-graph-create',{recordId,title:'Long exact selected element',source,graphVersion:15,policy})).ref;const binding=(await request('calculation-graph-page',{ref:graph,collection:'bindings'})).items[0],input={id:randomUUID(),kind:'column',binding:{id:binding.id,position:0},column:0};graph=(await request('calculation-graph-change',{ref:graph,collection:'nodes',offset:0,item:input})).ref;
 const selected={id:randomUUID(),kind:'domain-sequence',left:{id:input.id,position:0},right:null,operation:{kind:'index',index:0}};graph=(await request('calculation-graph-change',{ref:graph,collection:'nodes',offset:1,item:selected})).ref;graph=(await request('calculation-graph-change',{ref:graph,collection:'outputs',offset:0,item:{id:randomUUID(),name:'Exact selected long scalar',node:{id:selected.id,position:1}}})).ref;
 const pinnedGraph=graph,calculation={version:18,graph:pinnedGraph},result=await m.dataset({recordId,title:'Retained recipe18 scalar beyond legacy limit',calculation},{signal:t.signal}),doc=await m.read(result),schema=await m.datasetColumn(doc,0),page=await m.datasetPage(result),value=page.rows[0].cells[0],rawRow=(await m.retainedDatasetPage(doc,0,{metadataOnly:true})).rows[0],cell=await m.sequences.item(rawRow.cellIndex,0);
 assert.equal(doc.content.algorithmVersion,17);assert.deepEqual(doc.content.calculation,calculation);assert.equal(value.format,'dataset-cell');assert.equal(value.characters,9002);assert.equal(schema.representation,'radix-fraction');assert.equal(schema.radix,6);assert.equal(schema.resourcePolicy.resources.maxScalarCharacters,12000);assert.equal(await policyScalarText(m,value,schema,calculation,cell.lineage,{signal:t.signal}),true);await m.verifyDatasetRow(doc,rawRow,{signal:t.signal});
 const selectedSource={ref:result,selector:{kind:'cell',page:0,row:0,column:0}};let assembled='',offset=0;
 for(;;){t.signal.throwIfAborted();const inspected=await request('measurement-inspect',{source:selectedSource,offset});assert.equal(inspected.textPage.offset,offset);assert.equal(inspected.textPage.total,spelling.length);assert.equal(inspected.column.resourcePolicy.resources.maxScalarCharacters,12000);assembled+=inspected.textPage.text;if(inspected.next===null)break;assert.ok(inspected.next>offset);offset=inspected.next;}
 assert.equal(assembled,spelling);const late=await request('measurement-inspect',{source:selectedSource,offset:8999});assert.equal(late.textPage.text,'010');assert.equal(late.next,null);assert.ok(late.lineage.items.flatMap(item=>item.sources).some(item=>item.ref.id===source.id&&item.ref.revision===source.revision&&item.selector.column===0));
 await assert.rejects(verifyDatasetCell(m,{...cell,value:{...value,sha256:'0'.repeat(64)}},{signal:t.signal}),{code:'MATERIAL_MISSING'});
 const tighter=structuredClone(policy);tighter.resources.maxScalarCharacters=8192;graph=(await request('calculation-graph-change',{ref:graph,collection:'policy',policy:tighter})).ref;assert.notEqual(graph.revision,pinnedGraph.revision);assert.equal((await m.read(pinnedGraph)).content.policy.resources.maxScalarCharacters,12000);
 const refusedId=randomUUID();await assert.rejects(m.dataset({recordId,id:refusedId,expectedRevision:null,title:'Explicit tighter policy must refuse',calculation:{version:18,graph}},{signal:t.signal}),{code:'DATASET_CALCULATION_RESOURCE'});assert.equal(await m.current(refusedId),null);await assert.rejects(policyScalarText(m,value,schema,{version:18,graph},cell.lineage,{signal:t.signal}),{code:'DATASET_CALCULATION_RESOURCE'});
 assert.equal(await policyScalarText(m,value,schema,calculation,cell.lineage,{signal:t.signal}),true);assert.equal((await request('measurement-inspect',{source:selectedSource,offset:8999})).textPage.text,'010');await verifyDatasetCell(m,cell,{signal:t.signal});
 process.stdout.write('# Long recipe18 scalar retained and paged through actual inspector, digest refusal, explicit tighter-policy refusal, and unchanged pinned graph passed.\n');
});

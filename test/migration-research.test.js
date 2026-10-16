import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {migrationFixture} from './migration-fixture.js';
import {portableResearch} from './fixtures/import-research.js';
import {event} from './fixtures/attempts.js';
import {inventorySource} from '../src/migration/inventory.js';
import {MigrationImport} from '../src/migration/import-service.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {buildPublication} from '../src/publication.js';
import {retainedTable} from '../src/retained-tables.js';
import {defaultColumn} from '../src/web/dataset-schema.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-import-facts-')),source=path.join(directory,'source'),book=upgradeNotebook(sampleNotebook()),f=await encryptedFixture(path.join(directory,'app'),book),declared=await migrationFixture(source,{creative:true});
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const facts=portableResearch();declared.manifest.objects[1].attributes={privateMarker:'PRIVATE_UNMAPPED_METADATA',facts};
 return {...f,directory,source,book,declared,facts,service:new MigrationImport(f.workspace)};
}
async function stage(f,{select=true,resolution='merge'}={}){
 await writeFile(path.join(f.source,'inventory.observanda-source.json'),JSON.stringify(f.declared.manifest));
 const inventory=await inventorySource({source:f.source}),command={id:randomUUID(),workspaceId:f.book.id};
 let batch=await f.service.create({...command,source:f.source,expectedPin:inventory.source.pin,notebookId:f.book.notebooks[0].id});
 while(batch.state==='staging')batch=await f.service.stage(command);
 if(select){const detail=await f.service.detail({...command,index:1});batch=await f.service.mapping({...command,index:1,edit:batch.edit,mapping:{...detail.mapping,resolution,research:{path:'/facts'},links:[{...detail.mapping.links[0],role:'uses-method'}]}});}
 batch=await f.service.beginReview({...command,edit:batch.edit});while(batch.state==='reviewing')batch=await f.service.review(command);
 return {command,batch};
}
async function applied(f,options){const run=await stage(f,options);assert.equal(run.batch.state,'ready',JSON.stringify(await f.service.detail({...run.command,index:1})));await f.service.commit({...run.command,review:run.batch.review});return run;}

test('explicit structured facts are reviewable, private by default, pinned and retained in encrypted backups',async t=>{
 const f=await fixture(t),unselected=await stage(f,{select:false}),plain=await f.service.detail({...unselected.command,index:1});
 assert.equal(plain.prepared.sourceRecord.attempt,undefined);assert.deepEqual(plain.prepared.sourceRecord.sections,[]);
 const {command,batch}=await applied(f);assert.equal(batch.reconciliation.preparations,1);assert.equal(batch.reconciliation.executionEvents,2);assert.equal(batch.reconciliation.criterionAssessments,2);assert.equal(batch.reconciliation.resultStatements,1);
 const saved=await f.workspace.read(),record=saved.book.entries.find(r=>r.title==='morning-one'),method=saved.book.entries.find(r=>r.title==='listening-method'),protocol=record.attempt.preparations[0].protocols[0];
 assert.equal(record.share,false);assert.equal(record.template.values.counter,'900719925474099312345');assert.equal(record.attempt.assessments[1].outcome,'unresolved');assert.equal(protocol.revision,recordRevision(method));assert.equal(record.relations[0].role,'uses-method');
 const provenance=await f.service.provenance({workspaceId:f.book.id,recordId:record.id});assert.match(provenance.items[0].source.attributes,/PRIVATE_UNMAPPED_METADATA/);assert.ok(!JSON.stringify(record).includes('PRIVATE_UNMAPPED_METADATA'));
 await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:method.id,expectedRevision:recordRevision(method),record:{...method,body:'Later method; not the one used by the earlier run'}}]});
 assert.equal((await new ResearchMaterials(f.workspace).read(protocol)).body,method.body);
 const backup=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'backup')),{vault:f.vault}),restored=new Workspace(backup,f.vault),restoredRecord=(await restored.read()).book.entries.find(r=>r.id===record.id);
 assert.deepEqual(restoredRecord,record);assert.equal((await new ResearchMaterials(restored).read(protocol)).body,method.body);
 assert.equal((await new MigrationImport(restored).detail({...command,index:1})).mapping.research.path,'/facts');
 const published=structuredClone(saved.book);published.entries=published.entries.filter(r=>r.id===record.id).map(r=>({...r,share:true}));published.projects.forEach(p=>p.share=true);
 const output=[...buildPublication(published).files.values()].filter(v=>typeof v==='string').join('\n');assert.ok(output.includes('Acquisition alone does not establish recognition.'));assert.ok(!output.includes('PRIVATE_UNMAPPED_METADATA'));assert.ok(!output.includes(method.id));
});

test('continuing imports merge independent additions and refuse silent replacement even with source conflict resolution',async t=>{
 const f=await fixture(t);await applied(f);const before=await f.workspace.read(),record=before.book.entries.find(r=>r.title==='morning-one'),local=structuredClone(record);
 local.attempt.events.push(event(local.attempt.preparations[0],{label:'Local follow-up'}));
 await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:local}]});
 f.declared.manifest.objects[1].revision='r2';const first=f.facts.attempt.assessments[0];f.facts.attempt.assessments.push({...first,id:'amended-assessment',supersedes:first.id,observed:'Reconciled against all returned bytes',reason:'Explicit correction after review'});
 const update=await applied(f),saved=await f.workspace.read(),current=saved.book.entries.find(r=>r.id===record.id);
 assert.equal(current.attempt.events.at(-1).label,'Local follow-up');assert.deepEqual(current.attempt.assessments.slice(0,2),record.attempt.assessments);assert.equal(current.attempt.assessments.length,3);
 const repeat=await applied(f);assert.equal(repeat.batch.reconciliation.unchanged,4);assert.equal((await f.workspace.read()).etag,saved.etag);
 f.declared.manifest.objects[1].revision='r3';f.facts.attempt.assessments[0].observed='Silently changed earlier assessment';
 const blocked=await stage(f,{resolution:'source'}),detail=await f.service.detail({...blocked.command,index:1});assert.equal(blocked.batch.state,'mapping');assert.ok(detail.prepared.conflicts.includes('attempt'));assert.equal(detail.prepared.unresolved,true);
 await assert.rejects(f.service.commit({...blocked.command,review:blocked.batch.review}),{code:'IMPORT_REVIEW'});assert.equal((await f.workspace.read()).etag,saved.etag);
 // Reversal must not erase facts appended to a previously existing run.
 const reversed=await f.service.reverse({...update.command,review:update.batch.review});assert.equal(reversed.reversal.counts['preserved-facts'],1);assert.deepEqual((await f.workspace.read()).book.entries.find(r=>r.id===record.id).attempt,current.attempt);
});

test('unavailable research references stop review and all writes roll back if a retained dependency disappears after review',async t=>{
 const f=await fixture(t),materials=new ResearchMaterials(f.workspace),retained=f.book.entries[0];
 const reference={workspaceId:f.book.id,kind:'record',id:retained.id,revision:recordRevision(retained),label:'Retained preparation source'};f.facts.attempt.preparations[0].basedOn=reference;
 // This record exists in the workspace but has not been explicitly retained.
 const missing=await stage(f);assert.equal(missing.batch.state,'mapping');assert.equal((await f.service.detail({...missing.command,index:1})).problem.code,'MATERIAL_MISSING');
 await f.workspace.withLock(()=>materials.retainRecord(retained));const reviewed=await stage(f);assert.equal(reviewed.batch.state,'ready');
 await f.workspace.withLock(()=>f.workspace.removeMetadata('.observanda/materials/records/'+retained.id+'/'+reference.revision+'.json'));
 const before=await f.workspace.read();await assert.rejects(f.service.commit({...reviewed.command,review:reviewed.batch.review}),{code:'MATERIAL_MISSING'});
 assert.deepEqual(await f.workspace.read(),before);assert.equal((await materials.heads()).length,0);assert.equal((await f.service.page(reviewed.command)).batch.state,'ready');
 await f.workspace.withLock(()=>materials.retainRecord(retained));await f.service.commit({...reviewed.command,review:reviewed.batch.review});assert.equal((await f.workspace.read()).book.entries.length,before.book.entries.length+4);
});

test('retained table values must match their source during review, before an import can be approved',async t=>{
 const f=await fixture(t),materials=new ResearchMaterials(f.workspace),recordId=f.book.entries[0].id,bytes=Buffer.from('Counter\n900719925474099312345\n');
 const upload=await materials.startImport({recordId,name:'readings.csv',size:bytes.length});await materials.appendImport(upload.id,0,[bytes]);const artifact=await materials.finishImport(upload.id);
 const dataset=await materials.dataset({recordId,title:'Exact readings',artifact,columns:[{...defaultColumn({label:'Counter'}),representation:'integer'}]}),table=await retainedTable(materials,{ref:dataset,selection:{columns:[0],offset:0,count:10,includeExcluded:false}});
 f.facts.results.statements.push({id:'readings',kind:'table',basis:'retained',source:dataset,title:'Returned readings',text:'Exact retained counters.',limitations:'Synthetic example.',table:structuredClone(table)});
 f.facts.results.statements.at(-1).table.rows[0].cells[0]='900719925474099312346';const before=await f.workspace.read(),blocked=await stage(f);
 assert.equal(blocked.batch.state,'mapping');assert.equal((await f.service.detail({...blocked.command,index:1})).problem.code,'DATASET_TABLE');assert.equal((await f.workspace.read()).etag,before.etag);
 f.facts.results.statements.at(-1).table=table;await applied(f);const record=(await f.workspace.read()).book.entries.find(r=>r.title==='morning-one');assert.deepEqual(record.results.statements.at(-1).table,table);
});

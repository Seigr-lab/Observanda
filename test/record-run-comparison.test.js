import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {runComparisonFixture} from './run-comparison-fixture.js';
import {clearVault,seal} from '../src/encryption.js';
import {RecordRuns} from '../src/record-runs.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {RecordValues} from '../src/record-values.js';
import {RecordContent} from '../src/record-content.js';
import {RecordSectionCommands} from '../src/record-section-commands.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {withRecordDocument} from '../src/record-document.js';
import {validRunPage,validRunComparisonPage} from '../src/web/record-runs.js';
import {withStoredRecord} from '../src/record-storage.js';
import {recordRunComparison} from '../src/record-run-comparison.js';
import {serialize} from '../src/storage-format.js';
test('heavy run comparisons page current facts and methods without assembling unrelated record content',async t=>{
 const data=runComparisonFixture({heavy:true}),directory=await mkdtemp(path.join(os.tmpdir(),'observanda-run-comparison-')),run=data.runs[0];let f;
 t.after(async()=>{if(f)clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});f=await encryptedFixture(directory,data.book);
 const writing=new RecordSectionCommands(f.workspace),target={workspaceId:data.book.id,recordId:run.id};let structure=(await new RecordContent(f.workspace).read({...target,header:false})).structureRevision;
 for(let i=0;i<4;i++){const section={id:randomUUID(),title:'Other narrative appended '+i,body:'Private unselected prose '.repeat(2400)};const saved=await writing.run({...target,action:'insert',sectionId:section.id,expectedStructureRevision:structure,beforeId:null,value:{title:section.title,body:section.body}});structure=saved.structureRevision;run.sections.push(section);}
 assert.ok(Buffer.byteLength(JSON.stringify(run))>2*1024*1024);
 const service=new RecordRuns(f.workspace),command={workspaceId:data.book.id,recordId:data.parent.id,compare:true},forbidden=new Set();
 await f.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),run.id);await withRecordDocument(store,row.id,row.revision,async document=>{
  for(const field of [['sections'],['relations'],['attempt'],['attempt','events'],['attempt','assessments']])forbidden.add(await document.reference(field));
  for await(const item of document.items(['sections']))if((await document.tree.selected(item.value,['title'])).value.startsWith('Other narrative'))forbidden.add(await document.reference(['sections',String(item.index),'body']));
 });});
 let comparing=true;const read=RecordValueTree.prototype.read;t.mock.method(RecordValueTree.prototype,'read',function(ref){if(comparing)assert.ok(!forbidden.has(ref),'Comparison assembled unselected content');return read.call(this,ref);});
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Comparison loaded a complete record');});
 const first=await service.list(command);assert.ok(validRunPage(first,command));const conditions=first.runs[0].conditions;
 assert.equal(conditions.methods.length,4);assert.equal(conditions.attempt.events.length,4);assert.equal(conditions.attempt.assessments.length,4);assert.equal(conditions.windows.events.total,11);assert.equal(conditions.windows.assessments.total,11);
 assert.equal(conditions.attempt.events[0].label,'Acquisition 1');assert.equal(conditions.attempt.assessments[0].observed,'Observation 1');assert.equal(conditions.attempt.assessments[0].preparationNumber,1);
 const detail={workspaceId:data.book.id,recordId:data.parent.id,runId:run.id,snapshotId:first.snapshotId,windows:{events:8,assessments:8,methods:8}},late=await service.comparison(detail);
 assert.ok(validRunComparisonPage(late,detail));assert.deepEqual(late.conditions.windows.events,{offset:8,count:3,total:11});assert.equal(late.conditions.attempt.events.at(-1).label,'Reviewed acquisition zero');assert.equal(late.conditions.attempt.assessments.at(-1).observed,'Reviewed observation zero');assert.equal(late.conditions.attempt.assessments.at(-1).preparationNumber,2);assert.equal(late.conditions.methods.at(-1).label,'Method context 10');
 assert.ok(Buffer.byteLength(JSON.stringify(late))<16000);assert.equal(late.conditions.parameters,'Light level 0');
 // Older unindexed block manifests remain readable; their temporary comparison
 // index belongs to encrypted scratch storage and cannot change the workspace.
 await assert.rejects(f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const member=await store.member(await store.snapshot(first.snapshotId),run.id);
  await withStoredRecord(store,member.id,member.revision,async({value,key,row})=>{delete value.attemptIndex;delete value.methodIndex;value.version=1;await store.db.run('UPDATE records SET payload=$1 WHERE id=$2 AND revision=$3',seal(Buffer.from(serialize(value)),key,store.recordAAD(member.id,member.revision,row.scope_id,row.generation)),member.id,member.revision);});
  const legacy=await withRecordDocument(store,member.id,member.revision,document=>recordRunComparison(document,{windows:detail.windows}));assert.deepEqual(legacy,late.conditions);throw Error('Rollback synthetic legacy representation');
 })),/Rollback synthetic legacy representation/);
 const values=new RecordValues(f.workspace),titleTarget={...target,field:'title'},base=await values.read(titleTarget);comparing=false;try{await values.save({...titleTarget,expectedRevision:base.revision,value:{value:'Later title'}});}finally{comparing=true;}
 assert.deepEqual(await service.comparison(detail),late);assert.equal((await service.list(command)).runs[0].title,'Later title');
 for(const changes of [{recordId:data.method.id},{runId:data.incidental.id}])await assert.rejects(service.comparison({...detail,...changes}),{code:'MISSING'});
 for(const changes of [{windows:{events:-1}},{windows:{title:0}},{snapshotId:'bad'},{extra:true}])await assert.rejects(service.comparison({...detail,...changes}),{code:'INVALID'});
 await assert.rejects(service.comparison({...detail,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});const controller=new AbortController();controller.abort();await assert.rejects(service.comparison(detail,{signal:controller.signal}),{name:'AbortError'});
 for(const alter of [value=>value.runId=randomUUID(),value=>value.conditions.windows.events.count++,value=>value.conditions.windows.events.offset=7,value=>value.conditions.attempt.assessments[0].preparationNumber=0]){const copy=structuredClone(late);alter(copy);assert.equal(validRunComparisonPage(copy,detail),false);}
});

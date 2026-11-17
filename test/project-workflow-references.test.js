import {RecordQuery} from '../src/record-query.js';
import {recordBrowse} from '../src/web/record-query.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './project-domain-fixture.js';
import {createRun} from '../src/web/record-workflow.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {RecordRuns} from '../src/record-runs.js';
import {RecordRunCreation} from '../src/record-run-creation.js';
import {referenceOriginKey} from '../src/research-reference-namespace.js';
import {RecordHistory} from '../src/record-history.js';

test('retained workflow addresses support verification, run lists, history, editing and repetition under their authenticated owner',{timeout:120000},async t=>{
 const f=await fixture(t),sourceNamespace=randomUUID(),parent=f.book.entries[0],records=new ResearchRecords(f.storage,{});
 await f.storage.withLock(()=>f.storage.catalogue(async store=>{
  await store.putObject('project:research-migration',{version:1,projectId:f.projectId,namespaceId:f.book.id,sourceNamespace});
  await store.putObject(referenceOriginKey({kind:'record',id:parent.id}),{version:1,projectId:f.projectId,namespaceId:f.book.id,sourceNamespace,kind:'record',id:parent.id});
 }));
 const run=createRun(f.book,parent);run.relations[0].target.workspaceId=sourceNamespace;
 let retainedRevision;
 await records.save({workspaceId:f.book.id,changes:[{id:run.id,expectedRevision:null,record:run}]},{recordIds:[run.id]});
 await f.storage.catalogue(async store=>{const member=await store.member(await store.snapshot(),run.id),saved=await store.record(run.id,member.revision);Object.assign(run,saved);retainedRevision=recordRevision(saved);await store.verifySnapshot(undefined,f.book.id);assert.equal(recordRevision(await store.record(run.id,member.revision)),retainedRevision);assert.equal(saved.relations[0].target.workspaceId,sourceNamespace);});
 const service=new RecordRuns(f.storage),command={workspaceId:f.book.id,recordId:parent.id};
 const page=await service.list({...command,compare:true});assert.equal(page.total,1);assert.equal(page.runs[0].id,run.id);
 const history=new RecordHistory(f.storage,{}),versions=await history.list({workspaceId:f.book.id,recordId:run.id});assert.ok(versions.versions.some(version=>version.revision===retainedRevision));
 const changed={...run,title:'Continued work'};await records.save({workspaceId:f.book.id,changes:[{id:run.id,expectedRevision:retainedRevision,record:changed}]},{recordIds:[run.id]});
 const creation=new RecordRunCreation(f.storage),next={workspaceId:f.book.id,sourceId:run.id,id:randomUUID()},prepared=await creation.prepare(next);
 await creation.create({...next,expectedRevision:prepared.revision,title:'Next run'});
 assert.equal((await service.list(command)).total,2);
 const foreign=createRun(f.book,parent);foreign.relations[0].target.workspaceId=randomUUID();await records.save({workspaceId:f.book.id,changes:[{id:foreign.id,expectedRevision:null,record:foreign}]},{recordIds:[foreign.id]});
 const backlinks=new RecordQuery(f.storage),query={projectId:null,notebookId:null,filter:'all',search:'',browse:recordBrowse()};
 const back=await backlinks.list({workspaceId:f.book.id,query,relatedTo:{workspaceId:f.book.id,id:parent.id}});assert.equal(back.total,2);assert.ok(back.records.every(row=>row.id!==foreign.id));
 assert.equal((await backlinks.list({workspaceId:f.book.id,query,relatedTo:{workspaceId:sourceNamespace,id:parent.id}})).total,2);
 assert.equal((await service.list(command)).total,2,'A foreign address with the same ID must not become a local child');
 await assert.rejects(records.save({workspaceId:f.book.id,changes:[{id:parent.id,expectedRevision:recordRevision(parent),record:{...parent,type:'run'}}]},{recordIds:[parent.id]}),{code:'INVALID'});
 await f.storage.catalogue(store=>store.verifySnapshot(undefined,f.book.id));
 // Revoking one identity proof cannot make every ID in the old namespace local.
 await f.storage.withLock(()=>f.storage.catalogue(store=>store.deleteObject(referenceOriginKey({kind:'record',id:parent.id}))));
 assert.equal((await service.list(command)).total,0);
});


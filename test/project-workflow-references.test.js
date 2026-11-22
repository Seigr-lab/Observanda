import {RecordQuery} from '../src/record-query.js';
import {recordBrowse} from '../src/web/record-query.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {projectTreeFixture} from './project-tree-fixture.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {RecordOwnerTransfer} from '../src/record-owner-transfer.js';
import {createRun} from '../src/web/record-workflow.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {RecordRuns} from '../src/record-runs.js';
import {RecordRunCreation} from '../src/record-run-creation.js';
import {RecordHistory} from '../src/record-history.js';

test('retained workflow addresses support verification, run lists, history, editing and repetition under their authenticated owner',{timeout:240000},async t=>{
 // The parent arrives by a completed record-owner transfer, so its former
 // address remains an authenticated identity of the same record here.
 const f=await projectTreeFixture(t),[origin,selected]=f.books,directory=new LabBookDirectory(f.registry);for(const book of f.books)await directory.register(book.projectId,book);
 const parentId=origin.before.book.entries[0].id,source=new LabBookStorage(origin.root,origin.labBookId,origin.key),storage=new LabBookStorage(selected.root,selected.labBookId,selected.key);
 const member=await source.catalogue(async store=>store.member(await store.snapshot(),parentId));
 const moved=await new RecordOwnerTransfer(source,storage,{registry:f.registry,sourceOwner:{projectId:origin.projectId,labBookId:origin.labBookId,workspaceId:origin.namespaceId},targetOwner:{projectId:selected.projectId,labBookId:selected.labBookId,workspaceId:selected.namespaceId}}).start({id:randomUUID(),workspaceId:origin.namespaceId,recordId:parentId,sourceNotebookId:origin.labBookId,expectedStorageRevision:member.revision,targetWorkspaceId:selected.namespaceId,targetNotebookId:selected.labBookId});
 assert.equal(moved.phase,'complete');
 const sourceNamespace=origin.namespaceId,workspaceId=selected.namespaceId,book=(await storage.read()).book,parent=book.entries.find(entry=>entry.id===parentId),records=new ResearchRecords(storage,{});
 const run=createRun(book,parent);run.relations[0].target.workspaceId=sourceNamespace;
 let retainedRevision;
 await records.save({workspaceId:workspaceId,changes:[{id:run.id,expectedRevision:null,record:run}]},{recordIds:[run.id]});
 await storage.catalogue(async store=>{const member=await store.member(await store.snapshot(),run.id),saved=await store.record(run.id,member.revision);Object.assign(run,saved);retainedRevision=recordRevision(saved);await store.verifySnapshot(undefined,workspaceId);assert.equal(recordRevision(await store.record(run.id,member.revision)),retainedRevision);assert.equal(saved.relations[0].target.workspaceId,sourceNamespace);});
 const service=new RecordRuns(storage),command={workspaceId:workspaceId,recordId:parent.id};
 const page=await service.list({...command,compare:true});assert.equal(page.total,1);assert.equal(page.runs[0].id,run.id);
 const history=new RecordHistory(storage,{}),versions=await history.list({workspaceId:workspaceId,recordId:run.id});assert.ok(versions.versions.some(version=>version.revision===retainedRevision));
 const changed={...run,title:'Continued work'};await records.save({workspaceId:workspaceId,changes:[{id:run.id,expectedRevision:retainedRevision,record:changed}]},{recordIds:[run.id]});
 const creation=new RecordRunCreation(storage),next={workspaceId:workspaceId,sourceId:run.id,id:randomUUID()},prepared=await creation.prepare(next);
 await creation.create({...next,expectedRevision:prepared.revision,title:'Next run'});
 assert.equal((await service.list(command)).total,2);
 const foreign=createRun(book,parent);foreign.relations[0].target.workspaceId=randomUUID();await records.save({workspaceId:workspaceId,changes:[{id:foreign.id,expectedRevision:null,record:foreign}]},{recordIds:[foreign.id]});
 const backlinks=new RecordQuery(storage),query={projectId:null,notebookId:null,filter:'all',search:'',browse:recordBrowse()};
 const back=await backlinks.list({workspaceId:workspaceId,query,relatedTo:{workspaceId:workspaceId,id:parent.id}});assert.equal(back.total,2);assert.ok(back.records.every(row=>row.id!==foreign.id));
 assert.equal((await backlinks.list({workspaceId:workspaceId,query,relatedTo:{workspaceId:sourceNamespace,id:parent.id}})).total,2);
 assert.equal((await service.list(command)).total,2,'A foreign address with the same ID must not become a local child');
 await assert.rejects(records.save({workspaceId:workspaceId,changes:[{id:parent.id,expectedRevision:recordRevision(parent),record:{...parent,type:'run'}}]},{recordIds:[parent.id]}),{code:'INVALID'});
 await storage.catalogue(store=>store.verifySnapshot(undefined,workspaceId));
 // Revoking one identity proof cannot make every ID in the old namespace local.
 await storage.withLock(()=>storage.catalogue(store=>store.deleteObject('record:reference-origin:record:'+parent.id+':'+sourceNamespace)));
 assert.equal((await service.list(command)).total,0);
});


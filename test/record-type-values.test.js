import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {RecordValues} from '../src/record-values.js';
import {RecordValueDrafts} from '../src/record-value-drafts.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {RecordContent} from '../src/record-content.js';
import {RECORD_SECTION_WINDOW} from '../src/web/record-header-windows.js';
import {RecordQueryDocuments} from '../src/record-query-documents.js';
import {createRun} from '../src/web/record-workflow.js';
import {catalogueFormat} from '../src/catalogue-format.js';
import {digest,serialize} from '../src/storage-format.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {TestDeviceStore} from './device-fixture.js';
import {RecordDraftReview,verifyRecordDraftReviews} from '../src/record-draft-review.js';
import {retainedDraft} from './fixtures/record-draft-review.js';
import {mkdir} from 'node:fs/promises';
import {fixture as labBookFixture} from './project-domain-fixture.js';
import {copyProjectLocation} from '../src/project-transfer.js';
import {ProjectStorage} from '../src/project-storage.js';
import {rekeyCatalogue} from '../src/research-catalogue.js';
import {workspaceFile,atomicWrite} from '../src/storage.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-type-values-')),book=sampleNotebook(),record=book.entries[2],parent=book.entries[0];
 record.type='note';record.status='draft';record.sections=Array.from({length:67},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Retained observation '+i}));
 const run=createRun(book,parent),templated={...structuredClone(record),id:randomUUID(),sections:[],template:{id:randomUUID(),profileId:null,label:'Saved template',description:'',fields:[],values:{}}};book.entries.push(run,templated);
 const f=await encryptedFixture(directory,book);t.after(async()=>{await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const values=new RecordValues(f.workspace),target=(id=record.id,field='type')=>({workspaceId:book.id,recordId:id,field});
 return {...f,directory,book,record,parent,run,templated,values,target,save:(base,value)=>values.save({...target(base.recordId,base.field),expectedRevision:base.revision,value:{value}})};
}
test('record type changes preserve content and history, update queries and enforce incoming and outgoing run relationships',async t=>{
 const f=await fixture(t),etag=(await f.workspace.outline()).etag;
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Type editing reconstructed an entire record');});
 const type=await f.values.read(f.target()),title=await f.values.read(f.target(f.record.id,'title'));
 await f.save(title,'Reclassified observations');const saved=await f.save(type,'observation');assert.deepEqual(await f.save(type,'observation'),saved);
 await assert.rejects(f.save(type,'analysis'),{code:'RECORD_CHANGED'});
 for(const invalid of ['unknown','',null,{},1])await assert.rejects(f.save(await f.values.read(f.target()),invalid),{code:'INVALID'});
 await assert.rejects(f.save(await f.values.read(f.target(f.parent.id)),'run'),{code:'INVALID'});
 await assert.rejects(f.save(await f.values.read(f.target(f.run.id)),'note'),{code:'INVALID'});
 await assert.rejects(f.values.read(f.target(f.templated.id)),{code:'INVALID'});
 await assert.rejects(f.values.save({...f.target(f.templated.id),expectedRevision:digest(serialize({value:f.templated.type})),value:{value:'analysis'}}),{code:'INVALID'});
 const current=await new RecordContent(f.workspace).read({workspaceId:f.book.id,recordId:f.record.id,pagedHeader:true});
 assert.equal(current.header.type,'observation');assert.equal(current.header.title,'Reclassified observations');assert.deepEqual(current.sections.values,f.record.sections.slice(0,RECORD_SECTION_WINDOW));
 const old=await new RecordContent(f.workspace).read({workspaceId:f.book.id,recordId:f.record.id,snapshotId:etag,pagedHeader:true});assert.equal(old.header.type,'note');
 await f.workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(),row=await store.member(snapshot,f.record.id);assert.equal(row.type,'observation');
  const query=await Array.fromAsync(new RecordQueryDocuments(store).read([row],snapshot.metadata,{search:false}));assert.equal(query[0].type,'observation');
  ResearchCatalogue.prototype.record.mock.restore();
  await store.verifySnapshot(undefined,f.book.id);await store.verifySnapshot(etag,f.book.id);
 });
});
test('recoverable type changes atomically guard their format and survive ordinary and fresh-key copying',async t=>{
 // A workspace catalogue is created past generation 13 (its settings); a lab
 // book catalogue stays below it until its first recoverable type change.
 const book=sampleNotebook(),record=book.entries[2];record.type='note';record.status='draft';record.sections=Array.from({length:67},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Retained observation '+i}));
 const f=await labBookFixture(t,{book}),storage=f.storage,generation=(owner=storage)=>owner.catalogue(store=>catalogueFormat(store.db));
 const base=await new RecordValues(storage).read({workspaceId:book.id,recordId:record.id,field:'type'}),drafts=new RecordValueDrafts(storage),before=await generation();assert.ok(Number.isSafeInteger(before)&&before<13);
 const command={id:randomUUID(),workspaceId:book.id,recordId:record.id,expectedRevision:null,selection:{field:'type',revision:base.revision,storageRevision:base.storageRevision},value:{value:'analysis'}};
 const write=storage.writeMetadata.bind(storage);t.mock.method(storage,'writeMetadata',async(name,...rest)=>{if(name==='.observanda/drafts/'+command.id+'.json')throw Error('Interrupted checkpoint');return write(name,...rest);});
 await assert.rejects(drafts.write(command),/Interrupted checkpoint/);assert.equal(await generation(),before);assert.equal(await new ResearchDrafts(storage).read(command.id,{header:true}),null);storage.writeMetadata.mock.restore();
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Type recovery reconstructed an entire record');});
 // requireRecordTypeDrafts raises an older catalogue to exactly generation 13.
 const receipt=await drafts.write(command);assert.deepEqual(await drafts.write(command),receipt);assert.equal(await generation(),13);
 const lookup={id:command.id,workspaceId:book.id,expectedRevision:receipt.revision};assert.deepEqual((await drafts.read(lookup)).value,command.value);
 await assert.rejects(storage.withLock(()=>storage.catalogue(async store=>{await store.db.run('UPDATE catalogue_format SET version=12');await new ResearchDrafts(storage).read(command.id,{header:true});})),{code:'CATALOGUE_DAMAGED'});assert.equal(await generation(),13);
 ResearchCatalogue.prototype.record.mock.restore();
 const destination=path.join(f.workspace.root,'type-copy','project');await mkdir(path.dirname(destination));const copied=await copyProjectLocation(storage,destination,{id:randomUUID()});
 const access=await createWorkspaceAccess('','synthetic type recovery password',new TestDeviceStore({file:path.join(f.root,'type-recovery-device')})),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const descriptor=await storage.readFile(await workspaceFile(storage.root),'utf8'),fresh=new ProjectStorage(path.join(await f.receivingWorkspace(),'project'),f.projectId,vault);
 await mkdir(path.join(fresh.root,'.observanda'),{recursive:true});await atomicWrite(path.join(fresh.root,'.observanda/access.json'),serialize(access));await fresh.writeFile(await workspaceFile(fresh.root),descriptor);await rekeyCatalogue(storage,fresh,JSON.parse(descriptor));
 // A copy may add later catalogue features; it must still admit record type drafts (generation 13 or later).
 for(const copy of [copied,fresh]){assert.ok(await generation(copy)>=13);assert.deepEqual((await new RecordValueDrafts(copy).read(lookup)).value,command.value);await copy.catalogue(store=>store.verifySnapshot(undefined,book.id));}
});

test('whole-record checkpoint type corrections are guarded, recoverable and retain template ownership',async t=>{
 // The lab book catalogue holds a retained draft (generation 10) and is still
 // below generation 13 when the first type correction is checkpointed.
 const source=sampleNotebook(),record=source.entries[2];record.type='note';record.status='draft';record.sections=Array.from({length:67},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Retained observation '+i}));
 const templatedId=randomUUID();source.entries.push(createRun(source,source.entries[0]),{...structuredClone(record),id:templatedId,sections:[],template:{id:randomUUID(),profileId:null,label:'Saved template',description:'',fields:[],values:{}}});
 const f=await labBookFixture(t,{book:source}),storage=f.storage,generation=()=>storage.catalogue(store=>catalogueFormat(store.db));
 const book=(await storage.read()).book,original=book.entries.find(r=>r.id===record.id),mine={...structuredClone(original),title:'Recovered observations'};
 const draft=await retainedDraft(storage,book.id,original,mine),media={get:async()=>{throw Error('Unexpected media');}},review=new RecordDraftReview(storage,media);
 const prepare={workspaceId:book.id,id:draft.draft.id,expectedRevision:draft.revision};let plan=await review.prepare(prepare);
 const target=p=>({id:p.id,workspaceId:p.workspaceId,expectedRevision:p.revision});
 assert.ok((await review.editFields({...target(plan),group:'details',offset:0})).items.some(i=>i.field==='type'));
 const selected=await review.editRead({...target(plan),field:'type'}),command={...target(plan),field:'type',value:{value:'analysis'},valueRevision:selected.revision,editRevision:selected.editRevision,operationId:randomUUID()},before=await generation(),put=ResearchCatalogue.prototype.putObject;
 assert.ok(Number.isSafeInteger(before)&&before>=10&&before<13);
 t.mock.method(ResearchCatalogue.prototype,'putObject',async function(id,value){await put.call(this,id,value);if(id.startsWith('record-draft-edit-operation:'))throw Error('Interrupted type correction');});
 await assert.rejects(review.editWrite(command),/Interrupted type correction/);ResearchCatalogue.prototype.putObject.mock.restore();
 assert.equal(await generation(),before);assert.equal((await review.editRead({...target(plan),field:'type'})).value.value,original.type);
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Checkpoint correction reconstructed a complete record');});
 const corrected=await review.editWrite(command);assert.deepEqual(await review.editWrite(command),corrected);assert.equal(await generation(),13);
 await assert.rejects(storage.withLock(()=>storage.catalogue(async store=>{await store.db.run('UPDATE catalogue_format SET version=12');await verifyRecordDraftReviews(store);})),{code:'CATALOGUE_DAMAGED'});assert.equal(await generation(),13);
 plan=await review.prepare(prepare);assert.equal((await review.editRead({...target(plan),field:'type'})).value.value,'analysis');await storage.catalogue(store=>verifyRecordDraftReviews(store));
 ResearchCatalogue.prototype.record.mock.restore();
 const access=await createWorkspaceAccess('','synthetic corrected type password',new TestDeviceStore({file:path.join(f.root,'corrected-type-device')})),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const descriptor=await storage.readFile(await workspaceFile(storage.root),'utf8'),copied=new ProjectStorage(path.join(await f.receivingWorkspace(),'project'),f.projectId,vault);
 await mkdir(path.join(copied.root,'.observanda'),{recursive:true});await atomicWrite(path.join(copied.root,'.observanda/access.json'),serialize(access));await copied.writeFile(await workspaceFile(copied.root),descriptor);await rekeyCatalogue(storage,copied,JSON.parse(descriptor));
 const restored=new RecordDraftReview(copied,media);assert.equal(await copied.catalogue(store=>catalogueFormat(store.db)),13);
 assert.deepEqual(await restored.prepare(prepare),plan);await restored.apply(target(plan));
 const result=(await copied.read()).book.entries.find(r=>r.id===original.id);assert.equal(result.type,'analysis');assert.equal(result.title,mine.title);assert.deepEqual(result.sections,original.sections);await copied.catalogue(store=>store.verifySnapshot(undefined,book.id));
 const templated=book.entries.find(r=>r.id===templatedId),templateDraft=await retainedDraft(storage,book.id,templated,{...templated,title:'Template draft'}),templatePlan=await review.prepare({workspaceId:book.id,id:templateDraft.draft.id,expectedRevision:templateDraft.revision});
 assert.ok(!(await review.editFields({...target(templatePlan),group:'details',offset:0})).items.some(i=>i.field==='type'));await assert.rejects(review.editRead({...target(templatePlan),field:'type'}),{code:'INVALID'});
});

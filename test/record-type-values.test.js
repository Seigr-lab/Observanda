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
import {RecordQueryDocuments} from '../src/record-query-documents.js';
import {createRun} from '../src/web/record-workflow.js';
import {catalogueFormat} from '../src/catalogue-format.js';
import {digest,serialize} from '../src/storage-format.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {RecordDraftReview,verifyRecordDraftReviews} from '../src/record-draft-review.js';
import {retainedDraft} from './fixtures/record-draft-review.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-type-values-')),book=sampleNotebook(),record=book.entries[2],parent=book.entries[0];
 record.type='note';record.status='draft';record.sections=Array.from({length:67},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Retained observation '+i}));
 const run=createRun(book,parent),templated={...structuredClone(record),id:randomUUID(),sections:[],template:{id:randomUUID(),profileId:null,label:'Saved template',description:'',fields:[],values:{}}};book.entries.push(run,templated);
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
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
 assert.equal(current.header.type,'observation');assert.equal(current.header.title,'Reclassified observations');assert.deepEqual(current.sections.values,f.record.sections.slice(0,4));
 const old=await new RecordContent(f.workspace).read({workspaceId:f.book.id,recordId:f.record.id,snapshotId:etag,pagedHeader:true});assert.equal(old.header.type,'note');
 await f.workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(),row=await store.member(snapshot,f.record.id);assert.equal(row.type,'observation');
  const query=await Array.fromAsync(new RecordQueryDocuments(store).read([row],snapshot.metadata,{search:false}));assert.equal(query[0].type,'observation');
  ResearchCatalogue.prototype.record.mock.restore();
  await store.verifySnapshot(undefined,f.book.id);await store.verifySnapshot(etag,f.book.id);
 });
});
test('recoverable type changes atomically guard their format and survive ordinary and fresh-key copying',async t=>{
 const f=await fixture(t),base=await f.values.read(f.target()),drafts=new RecordValueDrafts(f.workspace),before=await f.workspace.catalogue(store=>catalogueFormat(store.db));assert.ok(before<13);
 const command={id:randomUUID(),workspaceId:f.book.id,recordId:f.record.id,expectedRevision:null,selection:{field:'type',revision:base.revision,storageRevision:base.storageRevision},value:{value:'analysis'}};
 const write=f.workspace.writeMetadata.bind(f.workspace);t.mock.method(f.workspace,'writeMetadata',async(name,...rest)=>{if(name==='.observanda/drafts/'+command.id+'.json')throw Error('Interrupted checkpoint');return write(name,...rest);});
 await assert.rejects(drafts.write(command),/Interrupted checkpoint/);assert.equal(await f.workspace.catalogue(store=>catalogueFormat(store.db)),before);assert.equal(await new ResearchDrafts(f.workspace).read(command.id,{header:true}),null);f.workspace.writeMetadata.mock.restore();
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Type recovery reconstructed an entire record');});
 const receipt=await drafts.write(command);assert.deepEqual(await drafts.write(command),receipt);assert.equal(await f.workspace.catalogue(store=>catalogueFormat(store.db)),13);
 const lookup={id:command.id,workspaceId:f.book.id,expectedRevision:receipt.revision};assert.deepEqual((await drafts.read(lookup)).value,command.value);
 await assert.rejects(f.workspace.withLock(()=>f.workspace.catalogue(async store=>{await store.db.run('UPDATE catalogue_format SET version=12');await new ResearchDrafts(f.workspace).read(command.id,{header:true});})),{code:'CATALOGUE_DAMAGED'});assert.equal(await f.workspace.catalogue(store=>catalogueFormat(store.db)),13);
 ResearchCatalogue.prototype.record.mock.restore();
 const copied=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'copy')),{vault:f.vault}),access=await createAccess('','synthetic type recovery password'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'fresh')),access,vault,f.vault);
 for(const workspace of [new Workspace(copied,f.vault),new Workspace(fresh,vault)]){assert.equal(await workspace.catalogue(store=>catalogueFormat(store.db)),13);assert.deepEqual((await new RecordValueDrafts(workspace).read(lookup)).value,command.value);await workspace.catalogue(store=>store.verifySnapshot(undefined,f.book.id));}
});

test('whole-record checkpoint type corrections are guarded, recoverable and retain template ownership',async t=>{
 const f=await fixture(t),book=(await f.workspace.read()).book,original=book.entries.find(r=>r.id===f.record.id),mine={...structuredClone(original),title:'Recovered observations'};
 const draft=await retainedDraft(f.workspace,f.book.id,original,mine),media={get:async()=>{throw Error('Unexpected media');}},review=new RecordDraftReview(f.workspace,media);
 const prepare={workspaceId:f.book.id,id:draft.draft.id,expectedRevision:draft.revision};let plan=await review.prepare(prepare);
 const target=p=>({id:p.id,workspaceId:p.workspaceId,expectedRevision:p.revision});
 assert.ok((await review.editFields({...target(plan),group:'details',offset:0})).items.some(i=>i.field==='type'));
 const selected=await review.editRead({...target(plan),field:'type'}),command={...target(plan),field:'type',value:{value:'analysis'},valueRevision:selected.revision,editRevision:selected.editRevision,operationId:randomUUID()},before=await f.workspace.catalogue(store=>catalogueFormat(store.db)),put=ResearchCatalogue.prototype.putObject;
 t.mock.method(ResearchCatalogue.prototype,'putObject',async function(id,value){await put.call(this,id,value);if(id.startsWith('record-draft-edit-operation:'))throw Error('Interrupted type correction');});
 await assert.rejects(review.editWrite(command),/Interrupted type correction/);ResearchCatalogue.prototype.putObject.mock.restore();
 assert.equal(await f.workspace.catalogue(store=>catalogueFormat(store.db)),before);assert.equal((await review.editRead({...target(plan),field:'type'})).value.value,original.type);
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Checkpoint correction reconstructed a complete record');});
 const corrected=await review.editWrite(command);assert.deepEqual(await review.editWrite(command),corrected);assert.equal(await f.workspace.catalogue(store=>catalogueFormat(store.db)),13);
 await assert.rejects(f.workspace.withLock(()=>f.workspace.catalogue(async store=>{await store.db.run('UPDATE catalogue_format SET version=12');await verifyRecordDraftReviews(store);})),{code:'CATALOGUE_DAMAGED'});
 plan=await review.prepare(prepare);assert.equal((await review.editRead({...target(plan),field:'type'})).value.value,'analysis');await f.workspace.catalogue(store=>verifyRecordDraftReviews(store));
 ResearchCatalogue.prototype.record.mock.restore();
 const access=await createAccess('','synthetic corrected type password'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const copied=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'corrected-copy')),access,vault,f.vault),workspace=new Workspace(copied,vault),restored=new RecordDraftReview(workspace,media);
 assert.deepEqual(await restored.prepare(prepare),plan);await restored.apply(target(plan));
 const result=(await workspace.read()).book.entries.find(r=>r.id===original.id);assert.equal(result.type,'analysis');assert.equal(result.title,mine.title);assert.deepEqual(result.sections,original.sections);await workspace.catalogue(store=>store.verifySnapshot(undefined,f.book.id));
 const templated=book.entries.find(r=>r.id===f.templated.id),templateDraft=await retainedDraft(f.workspace,f.book.id,templated,{...templated,title:'Template draft'}),templatePlan=await review.prepare({workspaceId:f.book.id,id:templateDraft.draft.id,expectedRevision:templateDraft.revision});
 assert.ok(!(await review.editFields({...target(templatePlan),group:'details',offset:0})).items.some(i=>i.field==='type'));await assert.rejects(review.editRead({...target(templatePlan),field:'type'}),{code:'INVALID'});
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {figureValueFixture} from './record-figure-values-fixture.js';
import {retainedDraft} from './fixtures/record-draft-review.js';
import {RecordDraftReview,verifyRecordDraftReviews} from '../src/record-draft-review.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {withRecordDocument} from '../src/record-document.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
const media={get:async()=>{throw Error('Unexpected media');}};
const target=plan=>({id:plan.id,workspaceId:plan.workspaceId,expectedRevision:plan.revision});
const prepare=(f,draft)=>({workspaceId:f.book.id,id:draft.draft.id,expectedRevision:draft.revision});
const newRecord=f=>({...structuredClone(f.record),id:randomUUID(),title:'Recovered new run',body:'Never saved before',sections:[],figures:[],attachments:[],results:{version:1,statements:[]},relations:[],share:false});
const forbid=t=>t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Recovery reconstructed an entire record');});

test('large new-record drafts recover atomically with indexed ownership, original identities and a fresh-key backup',async t=>{
 const f=await figureValueFixture();t.after(f.close);const record=newRecord(f);record.sections=Array.from({length:82},(_,i)=>({id:randomUUID(),title:'Acquisition '+i,body:'Exact observations '.repeat(1600)}));
 const draft=await retainedDraft(f.workspace,f.book.id,null,record);assert.ok(draft.draft.content.bytes>2*1024*1024);forbid(t);
 const review=new RecordDraftReview(f.workspace,media),plan=await review.prepare(prepare(f,draft));assert.equal(plan.count,0);assert.equal(plan.newRecord,true);
 const before=await f.workspace.outline(),finish=ResearchCatalogue.prototype.finishRecordChanges;t.mock.method(ResearchCatalogue.prototype,'finishRecordChanges',async function(...args){await finish.apply(this,args);throw Error('Interrupted insertion');});await assert.rejects(review.apply(target(plan)),/Interrupted insertion/);ResearchCatalogue.prototype.finishRecordChanges.mock.restore();assert.equal((await f.workspace.outline()).etag,before.etag);assert.ok(await new ResearchDrafts(f.workspace).read(draft.draft.id,{header:true}));
 const access=await createAccess('','new draft recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));const copied=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'recovered')),access,vault,f.vault),workspace=new Workspace(copied,vault),restored=new RecordDraftReview(workspace,media);
 assert.deepEqual(await restored.prepare(prepare(f,draft)),plan);const saved=await restored.apply(target(plan));assert.deepEqual(await restored.apply(target(plan)),saved);assert.equal(await new ResearchDrafts(workspace).read(draft.draft.id,{header:true}),null);
 await workspace.catalogue(async store=>{const snapshot=await store.snapshot(),row=await store.member(snapshot,record.id);assert.equal(snapshot.count,2);assert.equal(snapshot.nextPosition,2);assert.equal(row.position,1);assert.ok(row.collections);await withRecordDocument(store,row.id,row.revision,async doc=>{assert.equal((await doc.field(['sections','81','id'])).value,record.sections[81].id);assert.equal((await doc.field(['body'])).value,record.body);});await store.verifySnapshot(undefined,f.book.id);await verifyRecordDraftReviews(store);});
 assert.equal(await f.workspace.catalogue(async store=>store.member(await store.snapshot(),record.id)),null);
});
test('concurrent creation requires explicit whole-record review and rejects a changed target',async t=>{
 const f=await figureValueFixture();t.after(f.close);const record=newRecord(f),draft=await retainedDraft(f.workspace,f.book.id,null,record),review=new RecordDraftReview(f.workspace,media),initial=await review.prepare(prepare(f,draft));
 const rival={...record,title:'Independently saved creation'};await new ResearchRecords(f.workspace,media).save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:null,record:rival}]},{receipt:true});forbid(t);
 await assert.rejects(review.apply(target(initial)),{code:'RECORD_CHANGED'});let plan=await review.prepare(prepare(f,draft));assert.equal(plan.count,1);assert.deepEqual((await review.page({...target(plan),offset:0})).items[0].path,[]);assert.equal((await review.value({...target(plan),position:0,version:'base',offset:0})).missing,true);
 plan=await review.choose({...target(plan),position:0,version:'stored'});await review.apply(target(plan));ResearchCatalogue.prototype.record.mock.restore();await f.workspace.catalogue(async store=>{const snapshot=await store.snapshot(),row=await store.member(snapshot,record.id);assert.equal(snapshot.count,2);await withRecordDocument(store,row.id,row.revision,async doc=>assert.equal((await doc.field(['title'])).value,rival.title));await store.verifySnapshot(undefined,f.book.id);});
});
test('removed-record drafts require a restore decision, restore privately, and can keep the record absent',async t=>{
 const f=await figureValueFixture();t.after(f.close);const records=new ResearchRecords(f.workspace,media),record=newRecord(f);record.share=true;await records.save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:null,record}]},{receipt:true});
 const saved=(await f.workspace.read()).book.entries.find(r=>r.id===record.id),mine={...saved,title:'Recovered after removal'},draft=await retainedDraft(f.workspace,f.book.id,saved,mine),kept=await retainedDraft(f.workspace,f.book.id,saved,{...mine,title:'Discarded recovery'});await records.remove({workspaceId:f.book.id,recordId:record.id,expectedRevision:recordRevision(saved)});forbid(t);
 const review=new RecordDraftReview(f.workspace,media);let plan=await review.prepare(prepare(f,kept));assert.equal(plan.removedRecord,true);plan=await review.choose({...target(plan),position:0,version:'stored'});const command=target(plan),absent=await review.apply(command);assert.equal(absent.absent,true);assert.deepEqual(await review.apply(command),absent);
 plan=await review.prepare(prepare(f,draft));plan=await review.choose({...target(plan),position:0,version:'mine'});await review.apply(target(plan));ResearchCatalogue.prototype.record.mock.restore();await f.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),record.id);assert.equal(row.share,false);await withRecordDocument(store,row.id,row.revision,async doc=>assert.equal((await doc.field(['title'])).value,mine.title));await store.verifySnapshot(undefined,f.book.id);await verifyRecordDraftReviews(store);});
});

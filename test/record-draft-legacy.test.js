import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {figureValueFixture} from './record-figure-values-fixture.js';
import {retainedDraft} from './fixtures/record-draft-review.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {RecordDraftReview,verifyRecordDraftReviews} from '../src/record-draft-review.js';
import {RecordDraftRecoveryLedger} from '../src/record-draft-recovery-ledger.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {recordRevision} from '../src/research.js';
import {RecordValues} from '../src/record-values.js';
import {withRecordDocument} from '../src/record-document.js';
import {verifyResearchDrafts} from '../src/research-draft-verification.js';
import {digest,serialize} from '../src/storage-format.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';
const media={get:async()=>{throw Error('Unexpected media');}},target=plan=>({id:plan.id,workspaceId:plan.workspaceId,expectedRevision:plan.revision});
const command=(f,draft,position=0)=>({id:draft.draft.id,workspaceId:f.book.id,expectedRevision:draft.revision,position});
const pageCommand=(f,draft,offset=0)=>({id:draft.draft.id,workspaceId:f.book.id,expectedRevision:draft.revision,offset});
const fresh=(f,i)=>({...structuredClone(f.record),id:randomUUID(),title:'Checkpoint run '+i,body:'Retained run '+i,sections:[],figures:[],attachments:[],relations:[],results:{version:1,statements:[]},share:false,status:'draft'});
async function legacy(f,changes){const drafts=new ResearchDrafts(f.workspace),id=randomUUID();await drafts.write({id,workspaceId:f.book.id,expectedRevision:null,changes});return drafts.read(id,{expand:false,header:true});}
const forbid=t=>t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Recovery loaded a full saved record');});

test('legacy batches page records, retain the remaining drafts and resume after a fresh-key backup',async t=>{
 const f=await figureValueFixture();t.after(f.close);const records=Array.from({length:7},(_,i)=>fresh(f,i)),draft=await legacy(f,records.map(record=>({base:null,record,expectedRevision:null}))),review=new RecordDraftReview(f.workspace,media),read=command(f,draft);
 let page=await review.records(pageCommand(f,draft,4));assert.equal(page.total,7);assert.deepEqual(page.items.map(i=>i.title),records.slice(4).map(r=>r.title));
 forbid(t);let plan=await review.prepare({...read,position:6});assert.equal(plan.newRecord,true);assert.equal((await review.content({...target(plan),offset:0})).body,records[6].body);
 const receipt=await review.apply(target(plan));assert.deepEqual(await review.apply(target(plan)),receipt);assert.deepEqual(await review.prepare({...read,position:6}),{...plan,saved:receipt});
 page=await review.records(pageCommand(f,draft,4));assert.equal(page.items[2].recovered,true);assert.ok(await new ResearchDrafts(f.workspace).read(draft.draft.id,{expand:false,header:true}));ResearchCatalogue.prototype.record.mock.restore();
 const access=await createAccess('','legacy checkpoint backup'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));const copied=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'recovered')),access,vault,f.vault),workspace=new Workspace(copied,vault),restored=new RecordDraftReview(workspace,media);
 assert.equal((await restored.records(pageCommand(f,draft,4))).items[2].recovered,true);forbid(t);
 for(let position=0;position<6;position++){plan=await restored.prepare({...read,position});await restored.apply(target(plan));if(position<5)assert.ok(await new ResearchDrafts(workspace).read(draft.draft.id,{expand:false,header:true}));}
 assert.equal(await new ResearchDrafts(workspace).read(draft.draft.id,{header:true}),null);assert.deepEqual(await restored.apply(target(plan)),(await restored.apply(target(plan))));ResearchCatalogue.prototype.record.mock.restore();
 await workspace.catalogue(async store=>{const snapshot=await store.snapshot();assert.equal(snapshot.count,8);for(const record of records){const row=await store.member(snapshot,record.id);await withRecordDocument(store,row.id,row.revision,async doc=>assert.equal((await doc.field(['body'])).value,record.body));}await store.verifySnapshot(undefined,f.book.id);await verifyRecordDraftReviews(store);});
});

test('legacy inline bases keep their own meaning and recovery receipts roll back atomically',async t=>{
 const f=await figureValueFixture();t.after(f.close);const base={...f.record,title:'Baseline retained only in the old checkpoint'},mine={...base,title:'Legacy draft title'},draft=await legacy(f,[{base,record:mine,expectedRevision:recordRevision(base)},{base:null,record:fresh(f,1),expectedRevision:null}]),review=new RecordDraftReview(f.workspace,media);forbid(t);
 let plan=await review.prepare(command(f,draft));assert.equal(plan.count,1);assert.equal(JSON.parse((await review.value({...target(plan),position:0,version:'base',offset:0})).text),base.title);plan=await review.choose({...target(plan),position:0,version:'mine'});
 const before=await f.workspace.outline(),finish=RecordDraftRecoveryLedger.prototype.finish;t.mock.method(RecordDraftRecoveryLedger.prototype,'finish',async function(...args){await finish.apply(this,args);throw Error('Interrupted receipt');});
 await assert.rejects(review.apply(target(plan)),/Interrupted receipt/);RecordDraftRecoveryLedger.prototype.finish.mock.restore();assert.equal((await f.workspace.outline()).etag,before.etag);assert.equal((await review.records(pageCommand(f,draft))).items[0].recovered,false);
 await review.apply(target(plan));const values=new RecordValues(f.workspace),field={workspaceId:f.book.id,recordId:f.record.id,field:'title'},current=await values.read(field);await values.save({...field,expectedRevision:current.revision,value:{value:'Later writing'}});
 const saved=await review.prepare(command(f,draft));await review.apply(target(saved));assert.equal((await values.read(field)).value.value,'Later writing');
 const other=await review.prepare(command(f,draft,1));const replacement={...fresh(f,2),id:draft.draft.changes[1].record.id};await new ResearchDrafts(f.workspace).write({id:draft.draft.id,workspaceId:f.book.id,expectedRevision:draft.revision,changes:[{base:null,record:replacement,expectedRevision:null}]});await assert.rejects(review.apply(target(other)),{code:'DRAFT_CHANGED'});
 await f.workspace.catalogue(store=>verifyRecordDraftReviews(store));
});

test('compact and streamed legacy checkpoints recover through stored fields without expanding history',async t=>{
 const f=await figureValueFixture();t.after(f.close);const base=(await f.workspace.read()).book.entries[0],mine={...base,title:'Compact recovery'},revision=recordRevision(base),draft=await legacy(f,[{baseRevision:revision,expectedRevision:revision,record:mine}]),review=new RecordDraftReview(f.workspace,media);forbid(t);
 const oldHistory=await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{const index=store.historyIndex(base.id),head=await index.get(index.root),versions=[];for await(const item of index.items(await index.head()))versions.push({revision:item.revision,snapshotId:item.snapshotId});await index.saveHead({recordId:base.id,versions});return head;}));
 let plan=await review.prepare(command(f,draft));assert.equal(plan.count,0);await f.workspace.withLock(()=>f.workspace.catalogue(store=>store.historyIndex(base.id).saveHead(oldHistory)));await review.apply(target(plan));
 const record=fresh(f,3);record.sections=Array.from({length:83},(_,i)=>({id:randomUUID(),title:'Acquisition '+i,body:'Exact values '.repeat(2200)}));const retained=await retainedDraft(f.workspace,f.book.id,null,record);assert.ok(retained.draft.content.bytes>2*1024*1024);
 const {document,...old}=retained.draft;void document;old.formatVersion=3;const raw=serialize(old),streamed={draft:old,revision:digest(raw)};
 await f.workspace.withLock(async()=>{const drafts=new ResearchDrafts(f.workspace);await drafts.index.removeLocked(retained.draft);await f.workspace.writeMetadata('.observanda/drafts/'+old.id+'.json',raw);await drafts.index.putLocked(streamed,digest(serialize({text:raw})));});
 plan=await review.prepare(command(f,streamed));const preview=await review.content({...target(plan),offset:80});assert.equal(preview.sections.total,83);assert.equal(preview.sections.values[2].title,'Acquisition 82');assert.ok(JSON.stringify(preview).length<100000);
 await f.workspace.catalogue(store=>verifyResearchDrafts(store));await review.apply(target(plan));assert.equal(await new ResearchDrafts(f.workspace).read(old.id,{header:true}),null);
 await f.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),record.id);await withRecordDocument(store,row.id,row.revision,async doc=>assert.equal((await doc.field(['sections','82','body'])).value,record.sections[82].body));await verifyRecordDraftReviews(store);});
});

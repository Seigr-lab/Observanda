import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {RecordDraftReview,verifyRecordDraftReviews} from '../src/record-draft-review.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {Workspace} from '../src/storage.js';
import {retainedDraft} from './fixtures/record-draft-review.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {withRecordDocument} from '../src/record-document.js';
import {RecordValues} from '../src/record-values.js';
const media={get:async()=>{throw Error('Unexpected media');}};
const target=plan=>({id:plan.id,workspaceId:plan.workspaceId,expectedRevision:plan.revision});
test('paged checkpoint review retains decisions, composes independent changes and recovers without full records',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-review-blocks-')),book=sampleNotebook(),base=book.entries[0];
 base.sections=Array.from({length:68},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Original '+i+' '+('x'.repeat(28000))}));
 const mine=structuredClone(base),stored=structuredClone(base);mine.title='Draft title';stored.outcome='Independent saved outcome';
 for(let i=0;i<7;i++){mine.sections[i].body='Draft '+i+' '+('a'.repeat(29000));stored.sections[i].body='Saved '+i+' '+('b'.repeat(28000));}
 mine.sections.push(...Array.from({length:12},(_,i)=>({id:randomUUID(),title:'Added '+i,body:'z'.repeat(28000)})));
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const draft=await retainedDraft(f.workspace,book.id,base,mine);assert.ok(draft.draft.content.bytes>2*1024*1024);
 await new ResearchRecords(f.workspace,media).save({workspaceId:book.id,changes:[{id:base.id,expectedRevision:recordRevision(base),record:stored}]},{receipt:true});
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Recovery reconstructed a full record');});
 const review=new RecordDraftReview(f.workspace,media),prepare={workspaceId:book.id,id:draft.draft.id,expectedRevision:draft.revision};let plan=await review.prepare(prepare);
 assert.equal(plan.count,7);assert.deepEqual(await review.prepare(prepare),plan);assert.equal((await review.page({...target(plan),offset:4})).items.length,3);
 const part=await review.value({...target(plan),position:6,version:'mine',offset:0});assert.equal(part.text.length,4096);assert.equal(part.next,4096);
 let text=part.text,next=part.next;while(next!==null){const value=await review.value({...target(plan),position:6,version:'mine',offset:next});text+=value.text;next=value.next;}assert.equal(JSON.parse(text),mine.sections[6].body);
 await assert.rejects(review.apply(target(plan)),{code:'INVALID'});
 for(let position=0;position<7;position++){plan=await review.choose({...target(plan),position,version:position===6?'stored':'mine'});if(position===3)assert.deepEqual(await new RecordDraftReview(f.workspace,media).prepare(prepare),plan);}
 const command=target(plan),saved=await review.apply(command);assert.deepEqual(await review.apply(command),saved);assert.equal(await new ResearchDrafts(f.workspace).read(draft.draft.id,{header:true}),null);
 await f.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),base.id);await withRecordDocument(store,row.id,row.revision,async document=>{
  assert.equal((await document.field(['title'])).value,mine.title);assert.equal((await document.field(['outcome'])).value,stored.outcome);assert.equal(await document.tree.arrayLength(document.root,['sections']),80);
  assert.equal((await document.field(['sections','0','body'])).value,mine.sections[0].body);assert.equal((await document.field(['sections','6','body'])).value,stored.sections[6].body);assert.equal((await document.field(['sections','79','body'])).value,mine.sections[79].body);
 });});
});
test('stale and failed recovery retain checkpoints and all saved review choices',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-review-conflict-')),book=sampleNotebook(),base=book.entries[0],mine={...base,title:'Recovered title'};
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const draft=await retainedDraft(f.workspace,book.id,base,mine),review=new RecordDraftReview(f.workspace,media),prepare={workspaceId:book.id,id:draft.draft.id,expectedRevision:draft.revision};
 let plan=await review.prepare(prepare);const before=await f.workspace.outline(),finish=ResearchCatalogue.prototype.finishRecordChanges;
 t.mock.method(ResearchCatalogue.prototype,'finishRecordChanges',async function(...args){await finish.apply(this,args);throw Error('Injected failure');});
 await assert.rejects(review.apply(target(plan)),/Injected failure/);ResearchCatalogue.prototype.finishRecordChanges.mock.restore();
 assert.equal((await f.workspace.outline()).etag,before.etag);assert.ok(await new ResearchDrafts(f.workspace).read(draft.draft.id,{header:true}));assert.deepEqual(await review.prepare(prepare),plan);
 const values=new RecordValues(f.workspace),valueTarget={workspaceId:book.id,recordId:base.id,field:'title'},value=await values.read(valueTarget);
 await values.save({...valueTarget,expectedRevision:value.revision,value:{value:'Concurrent title'}});await assert.rejects(review.apply(target(plan)),{code:'RECORD_CHANGED'});
 plan=await review.prepare(prepare);assert.equal(plan.count,1);plan=await review.choose({...target(plan),position:0,version:'mine'});await review.apply(target(plan));assert.equal((await values.read(valueTarget)).value.value,mine.title);
});

test('review decisions survive a fresh-key backup and verification rejects contradictory conflicts',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-review-backup-')),book=sampleNotebook(),base=book.entries[0],mine={...base,title:'Draft title'};
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const draft=await retainedDraft(f.workspace,book.id,base,mine),review=new RecordDraftReview(f.workspace,media),prepare={workspaceId:book.id,id:draft.draft.id,expectedRevision:draft.revision};
 await new ResearchRecords(f.workspace,media).save({workspaceId:book.id,changes:[{id:base.id,expectedRevision:recordRevision(base),record:{...base,title:'Saved title'}}]},{receipt:true});
 let plan=await review.prepare(prepare);const choose={...target(plan),position:0,version:'mine'};plan=await review.choose(choose);assert.deepEqual(await review.choose(choose),plan);
 await assert.rejects(review.choose({...choose,version:'stored'}),{code:'DRAFT_CHANGED'});
 await f.workspace.catalogue(store=>verifyRecordDraftReviews(store));
 const access=await createAccess('','retained review backup'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const copied=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'backup')),access,vault,f.vault),workspace=new Workspace(copied,vault),restored=new RecordDraftReview(workspace,media);
 assert.deepEqual(await restored.prepare(prepare),plan);await restored.apply(target(plan));await workspace.catalogue(store=>verifyRecordDraftReviews(store));
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const key='record-draft-review:'+plan.id,original=await store.object(key);await store.putObject(key,{...original,count:2});
  await assert.rejects(verifyRecordDraftReviews(store),{code:'CATALOGUE_DAMAGED'});await store.putObject(key,original);
 }));
});

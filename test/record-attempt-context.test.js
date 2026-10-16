import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {attemptWindowFixture} from './record-attempt-window-fixture.js';
import {RecordValues} from '../src/record-values.js';
import {RecordDocument,withRecordDocument} from '../src/record-document.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {RecordValueDrafts} from '../src/record-value-drafts.js';
import {RecordDraftReview} from '../src/record-draft-review.js';
import {retainedDraft} from './fixtures/record-draft-review.js';
import {event,preparation} from './fixtures/attempts.js';

test('selected attempt context stays bounded, pinned and recoverable without complete history reads',async t=>{
 const f=await attemptWindowFixture();t.after(f.close);const values=new RecordValues(f.workspace),forbidden=new Set(),target=(kind,id)=>({workspaceId:f.book.id,recordId:f.record.id,field:'attempt:'+kind+':'+id});
 await f.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),f.record.id);await withRecordDocument(store,row.id,row.revision,async document=>{for(const path of [['attempt'],['attempt','preparations'],['attempt','events'],['attempt','assessments']])forbidden.add(await document.reference(path));});});
 const read=RecordValueTree.prototype.read,field=RecordDocument.prototype.field;
 t.mock.method(RecordValueTree.prototype,'read',function(ref){assert.ok(!forbidden.has(ref),'Assembled a run-history collection');return read.call(this,ref);});
 t.mock.method(RecordDocument.prototype,'field',function(path,...args){assert.notDeepEqual(path,['attempt']);return field.call(this,path,...args);});
 const id=randomUUID(),base=await values.read(target('event',id));assert.equal(base.definition.attempt.events.length,0);assert.equal(base.definition.attempt.assessments.length,0);assert.equal(base.definition.attempt.preparations.length,1);assert.equal(base.definition.totals.events,15);assert.equal(base.definition.preparations.items.length,4);
 const command={...target('event',id),storageRevision:base.storageRevision,prior:f.record.attempt.events[0].id,preparationId:null,offset:8},context=await values.attemptContext(command);
 assert.equal(context.correctionId,f.record.attempt.events[14].id);assert.equal(context.attempt.events.length,2);assert.equal(context.attempt.preparations.length,1);assert.equal(context.preparations.items.length,1);assert.equal(context.preparations.items[0].position,8);assert.equal(context.preparations.total,9);
 const latest=f.record.attempt.preparations[8],amended={...preparation(),supersedes:latest.id,reason:'New setup',applicability:'A later preparation'},prepBase=await values.read(target('preparation',amended.id));await values.save({...target('preparation',amended.id),expectedRevision:prepBase.revision,value:{value:amended}});
 assert.deepEqual(await values.attemptContext(command),context,'An open form changed with the moving head');
 const item=event(f.record.attempt.preparations[1],{id,label:'Selected older preparation'}),drafts=new RecordValueDrafts(f.workspace),draft={id:randomUUID(),workspaceId:f.book.id,recordId:f.record.id,expectedRevision:null,selection:{field:base.field,revision:base.revision,storageRevision:base.storageRevision},value:{value:item}};
 const receipt=await drafts.write(draft),recovered=await drafts.read({id:draft.id,workspaceId:f.book.id,expectedRevision:receipt.revision});assert.deepEqual(recovered.value,{value:item});
 const selected=await values.attemptContext({...command,prior:null,preparationId:item.preparationId});assert.equal(selected.attempt.preparations[0].id,item.preparationId);assert.equal(selected.positions[item.preparationId],1);
 await values.save({...target('event',id),expectedRevision:base.revision,value:recovered.value});assert.deepEqual((await values.read(target('event',id))).value,recovered.value);
 await assert.rejects(values.attemptContext({...command,offset:-1}),{code:'INVALID'});await assert.rejects(values.attemptContext({...command,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});await assert.rejects(values.attemptContext({...command,preparationId:randomUUID()}),{code:'MISSING'});
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(values.attemptContext(command,{signal:cancelled.signal}),{name:'AbortError'});
 t.mock.restoreAll();await f.workspace.catalogue(store=>store.verifySnapshot(undefined,f.book.id));
});

test('checkpoint preparation choices use the edited checkpoint rather than the saved run',async t=>{
 const f=await attemptWindowFixture();t.after(f.close);const mine=structuredClone(f.record),p={...preparation(),supersedes:mine.attempt.preparations.at(-1).id,reason:'Unfinished preparation',applicability:'Checkpoint-only setup'};mine.attempt.preparations.push(p);
 const e=event(p);mine.attempt.events.push(e);const draft=await retainedDraft(f.workspace,f.book.id,f.record,mine),review=new RecordDraftReview(f.workspace,{get(){throw Error('No media expected');}});
 const plan=await review.prepare({id:draft.draft.id,workspaceId:f.book.id,expectedRevision:draft.revision}),command={id:plan.id,workspaceId:plan.workspaceId,expectedRevision:plan.revision,field:'attempt:event:'+e.id,prior:null,preparationId:p.id,offset:8};
 const context=await review.editAttempts(command);assert.equal(context.preparations.total,10);assert.equal(context.preparations.items[1].applicability,'Checkpoint-only setup');assert.equal(context.positions[p.id],9);
 const selected=await review.editRead({...command,field:'attempt:preparation:'+p.id});await review.editWrite({id:plan.id,workspaceId:plan.workspaceId,expectedRevision:plan.revision,field:selected.field,value:{value:{...selected.value.value,applicability:'Corrected checkpoint context'}},valueRevision:selected.revision,editRevision:selected.editRevision,operationId:randomUUID()});
 assert.equal((await review.editAttempts(command)).preparations.items[1].applicability,'Corrected checkpoint context');
});

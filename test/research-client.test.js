import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordDraftTracker,recordSaveRequest,retainPendingEdits} from '../src/web/research-client.js';
import {workspaceSaveRequest} from '../src/web/workspace-edits.js';

function fixture(count=4){
 const before={id:'workspace',formatVersion:21,title:'Studio',projects:[],entries:Array.from({length:count},(_,i)=>({id:'record-'+i,title:'Take '+i,body:'Original '+i,createdAt:'before',updatedAt:'before'}))};
 const draft=structuredClone(before),revisions=Object.fromEntries(before.entries.map(r=>[r.id,'revision-'+r.id])),tracker=recordDraftTracker();
 tracker.reset(before,revisions);return {before,draft,revisions,tracker};
}

for(const count of [32,320])test('record edits, checkpoints and submissions leave unrelated bodies untouched at '+count+' records',()=>{
 const {before,draft,revisions,tracker}=fixture(count),bases=Object.fromEntries(before.entries.map(r=>[r.id,r]));
 for(const book of [before,draft])for(const record of book.entries.slice(1)){
  Object.defineProperty(record,'body',{enumerable:true,get(){throw Error('Unrelated body inspected: '+record.id);}});
 }
 draft.entries[0].title='Edited take';assert.equal(tracker.updateRecord(draft,'record-0'),true);
 const checkpoint=tracker.checkpoint(bases);assert.equal(checkpoint.length,1);assert.equal(checkpoint[0].base,before.entries[0]);
 assert.notEqual(checkpoint[0].record,draft.entries[0]);assert.equal(checkpoint[0].expectedRevision,revisions['record-0']);
 const submitted=tracker.submission(draft);
 assert.equal(submitted.command.changes.length,1);assert.equal(submitted.book.entries[0].title,'Edited take');
 assert.notEqual(submitted.book.entries[0],draft.entries[0]);assert.equal(submitted.book.entries[1],before.entries[1]);
 draft.entries[0].title='Later edit';assert.equal(checkpoint[0].record.title,'Edited take');assert.equal(submitted.book.entries[0].title,'Edited take');
 draft.entries[0].title=before.entries[0].title;assert.equal(tracker.updateRecord(draft,'record-0'),false);assert.equal(tracker.command(),null);
});

test('multiple changes and reverts retain only changed identities and read current expected revisions',()=>{
 const {before,draft,revisions,tracker}=fixture();
 draft.entries[0].title='Changed';draft.entries[2].body='New evidence';
 tracker.updateRecord(draft,'record-0');tracker.updateRecord(draft,'record-2');
 assert.deepEqual(tracker.command().changes.map(c=>c.id),['record-0','record-2']);
 draft.entries[0].title=before.entries[0].title;tracker.updateRecord(draft,'record-0');
 revisions['record-2']='retained-conflict-base';
 assert.equal(tracker.command().changes[0].expectedRevision,'retained-conflict-base');
 assert.equal(tracker.command().changes.length,1);
 tracker.reset(before,{});tracker.updateRecord(draft,'record-2');
 assert.equal(tracker.command(),null);assert.equal(tracker.checkpoint({}),null);
 tracker.reset(null);assert.equal(tracker.command(),null);
});

test('generic changes preserve metadata, addition, removal and ordering boundaries',()=>{
 const {before,draft,revisions,tracker}=fixture();
 draft.entries.push({id:'new',title:'New take'});assert.equal(tracker.inspect(draft),true);
 assert.equal(tracker.command().changes[0].expectedRevision,null);
 draft.entries.at(-1).title='New take revised';tracker.updateRecord(draft,'new');
 assert.equal(tracker.command().changes[0].record.title,'New take revised');
 draft.title='Pending workspace title';assert.equal(tracker.inspect(draft),true);assert.equal(tracker.command(),null);
 draft.entries[0].title='Changed too';tracker.updateRecord(draft,'record-0');assert.equal(tracker.command(),null);
 const mixed=tracker.submission(draft);assert.equal(mixed.command,null);assert.deepEqual(mixed.book,draft);assert.notEqual(mixed.book.entries[1],draft.entries[1]);
 draft.title=before.title;tracker.inspect(draft);assert.equal(tracker.command().changes.length,2);
 draft.entries.shift();tracker.inspect(draft);assert.equal(tracker.command(),null);
 const reordered=structuredClone(before);reordered.entries.reverse();reordered.entries[0].title='Reordered';
 assert.equal(recordSaveRequest(before,reordered,revisions),null);
 assert.equal(tracker.inspect(structuredClone(before)),false);assert.equal(tracker.command(),null);
});

test('submitted bases survive later edits to changed and previously unchanged records',()=>{
 const {before,draft,tracker}=fixture();
 draft.entries[0].title='Sent title';tracker.updateRecord(draft,'record-0');
 const submitted=tracker.submission(draft),server=structuredClone(submitted.book);
 server.entries[0].updatedAt='committed';server.entries[2].title='Other window';
 draft.entries[0].body='Typed after send';draft.entries[1].body='Started while saving';
 tracker.updateRecord(draft,'record-0');tracker.updateRecord(draft,'record-1');
 assert.equal(submitted.book.entries[0].body,before.entries[0].body);
 assert.equal(submitted.book.entries[1].body,before.entries[1].body);
 const merged=retainPendingEdits(submitted.book,draft,server);
 assert.equal(merged.entries[0].title,'Sent title');assert.equal(merged.entries[0].body,'Typed after send');
 assert.equal(merged.entries[0].updatedAt,'committed');assert.equal(merged.entries[1].body,'Started while saving');
 assert.equal(merged.entries[2].title,'Other window');assert.deepEqual(before.entries[1],submitted.book.entries[1]);
 tracker.reset(server,Object.fromEntries(server.entries.map(r=>[r.id,'new-'+r.id])));tracker.inspect(merged);
 assert.deepEqual(tracker.command().changes.map(c=>c.id),['record-0','record-1']);
});

test('mixed authoring skips serializing entries and projects as metadata',()=>{
 const {before,draft,revisions}=fixture();draft.title='New studio title';draft.entries[1].title='New take';
 for(const book of [before,draft])for(const key of ['entries','projects'])Object.defineProperty(book[key],'toJSON',{value(){throw Error('Whole collection serialized as metadata');}});
 const result=workspaceSaveRequest(before,draft,revisions);
 assert.deepEqual(result.metadata,{title:'New studio title'});assert.equal(result.changes.length,1);assert.equal(result.changes[0].id,'record-1');
});

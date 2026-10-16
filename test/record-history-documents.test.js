import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {RecordHistory} from '../src/record-history.js';
import {RecordValues} from '../src/record-values.js';
import {RecordWriting} from '../src/record-writing.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {withRecordDocument} from '../src/record-document.js';
import {attemptFixture} from './fixtures/attempts.js';

const media={get:async()=>{throw Error('Unexpected media access');}};
test('large record history inspects selected windows and restores retained blocks with exact retry',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-history-doc-')),book=sampleNotebook(),record=book.entries[0];
 record.sections=Array.from({length:73},(_,i)=>({id:randomUUID(),title:'Observation '+i,body:'Recorded '+i+' '+('exact'.repeat(5600))}));
 record.contributors=Array.from({length:73},(_,i)=>({id:randomUUID(),name:'Observer '+i,role:'Acquisition'}));
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const history=new RecordHistory(f.workspace,media),values=new RecordValues(f.workspace),target={workspaceId:book.id,recordId:record.id};
 const writing=new RecordWriting(f.workspace),summary=await writing.read({...target,sectionId:null});record.body='Extended observations '.repeat(2500);
 await writing.save({...target,sectionId:null,expectedRevision:summary.revision,value:{body:record.body}});
 assert.ok(Buffer.byteLength(JSON.stringify(record))>2*1024*1024);
 const base=await values.read({...target,field:'title'});await values.save({...target,field:'title',expectedRevision:base.revision,value:{value:'Current interpretation'}});
 const original=ResearchCatalogue.prototype.record;
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('History reconstructed a complete record');});
 const listing=await history.list(target),old=listing.versions.find(v=>!v.current),review=await history.read({...target,...old,paged:true,offset:69,windows:{contributors:69}});
 assert.equal(review.paged,true);assert.deepEqual(review.changed,['title']);assert.equal(review.previous.sections.total,73);assert.deepEqual(review.record.sections,record.sections.slice(69));assert.deepEqual(review.record.contributors,record.contributors.slice(69));
 assert.equal(review.current.title,'Current interpretation');
 const command={...target,source:old.source,revision:old.revision,expectedRevision:review.currentRevision},restored=await history.restore(command,{receipt:true});
 assert.equal(restored.historyReceipt,true);assert.deepEqual(await history.restore(command,{receipt:true}),restored);assert.equal((await history.list(target)).versions.length,4);
 const current=await history.list(target),view=await history.read({...target,...current.versions[0],paged:true,offset:70});assert.equal(view.record.title,record.title);assert.equal(view.record.share,false);assert.deepEqual(view.record.sections,record.sections.slice(70));
 const state=await f.workspace.outline();await assert.rejects(history.restore({...command,expectedRevision:'0'.repeat(64)},{receipt:true}),{code:'RECORD_CHANGED'});assert.equal((await f.workspace.outline()).etag,state.etag);
 ResearchCatalogue.prototype.record.mock.restore();
 // Independent verification may read the other small sample records, but the
 // growing record and every one of its versions must remain block-backed.
 t.mock.method(ResearchCatalogue.prototype,'record',function(id,...args){if(id===record.id)throw Error('Verification reconstructed the growing record');return original.call(this,id,...args);});
 await f.workspace.catalogue(store=>store.verify({format:'observanda-research-catalogue',version:2,workspaceId:book.id}));
});

test('restoration keeps current notebook keys and execution facts after a record moves',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-history-moved-')),book=sampleNotebook(),record=book.entries[0],other={...book.notebooks[0],id:randomUUID(),title:'Current location'};book.notebooks.push(other);
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const records=new ResearchRecords(f.workspace,media),history=new RecordHistory(f.workspace,media),target={workspaceId:book.id,recordId:record.id},attempt=attemptFixture();
 await records.save({workspaceId:book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Later version',notebookId:other.id,attempt}}]},{receipt:true});
 const listing=await history.list(target),old=listing.versions.find(v=>!v.current);
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Moved restore reconstructed a full record');});
 await history.restore({...target,...old,expectedRevision:listing.currentRevision},{receipt:true});
 await f.workspace.catalogue(async store=>{
  const row=await store.member(await store.snapshot(),record.id);assert.equal(row.notebookId,other.id);
  await withRecordDocument(store,row.id,row.revision,async document=>{assert.equal(document.blocks.scopeId,other.id);assert.deepEqual((await document.field(['attempt'])).value,attempt);assert.equal((await document.field(['title'])).value,record.title);});
  ResearchCatalogue.prototype.record.mock.restore();
  await store.verify({format:'observanda-research-catalogue',version:2,workspaceId:book.id});
 });
});

test('failed block restoration rolls back its current version, history and retry receipt',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-history-rollback-')),book=sampleNotebook(),record=book.entries[0];
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const values=new RecordValues(f.workspace),history=new RecordHistory(f.workspace,media),target={workspaceId:book.id,recordId:record.id},before=await values.read({...target,field:'title'});
 await values.save({...target,field:'title',expectedRevision:before.revision,value:{value:'Current title'}});
 const listing=await history.list(target),old=listing.versions.find(version=>!version.current),command={...target,...old,expectedRevision:listing.currentRevision},state=await f.workspace.outline();
 const finish=ResearchCatalogue.prototype.finishRecordChanges;
 t.mock.method(ResearchCatalogue.prototype,'finishRecordChanges',async function(...args){await finish.apply(this,args);throw Error('Injected publication failure');});
 await assert.rejects(history.restore(command,{receipt:true}),/Injected publication failure/);
 ResearchCatalogue.prototype.finishRecordChanges.mock.restore();
 assert.equal((await f.workspace.outline()).etag,state.etag);const after=await history.list(target);assert.deepEqual(after.versions,listing.versions);assert.equal(after.currentRevision,listing.currentRevision);assert.equal(after.total,listing.total);
 assert.equal((await values.read({...target,field:'title'})).value.value,'Current title');
 const saved=await history.restore(command,{receipt:true});assert.equal(saved.saved,true);assert.equal((await values.read({...target,field:'title'})).value.value,record.title);
 assert.deepEqual(await history.restore(command,{receipt:true}),saved);
});

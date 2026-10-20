import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {RecordWriting} from '../src/record-writing.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {RecordQuery} from '../src/record-query.js';
import {recordBrowse} from '../src/web/record-query.js';
import {RecordContent} from '../src/record-content.js';
import {RecordWritingDrafts} from '../src/record-writing-drafts.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {verifyWritingDraft} from '../src/record-writing-drafts.js';
import {withDraftDocument} from '../src/record-draft-document.js';
import {RecordDocument} from '../src/record-document.js';
import {Workspace} from '../src/storage.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {serialize} from '../src/storage-format.js';
import {catalogueFormat,catalogueRequiresSourcePublicationControls} from '../src/catalogue-format.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-writing-')),book=sampleNotebook(),record=book.entries[0];
 record.sections=Array.from({length:40},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Original '+i+' '+('retained '.repeat(1000))}));
 const f=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 return {...f,book,record,writing:new RecordWriting(f.workspace),target:i=>({workspaceId:book.id,recordId:record.id,sectionId:i===null?null:record.sections[i].id})};
}
test('selected writing edits retain other sections, compose concurrent edits, reject conflicts and update search/history',async t=>{
 const f=await fixture(t),before=(await f.workspace.outline()).etag;
 const [first,last]=await Promise.all([f.writing.read(f.target(0)),f.writing.read(f.target(39))]);
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Writing assembled a whole record');});
 const save=(view,value)=>f.writing.save({workspaceId:view.workspaceId,recordId:view.recordId,sectionId:view.sectionId,expectedRevision:view.revision,value});
 const a=await save(first,{title:'Revised opening',body:'The first independent edit.'});
 const b=await save(last,{title:'Late section',body:'Unambiguous late observation.'});
 assert.notEqual(a.etag,b.etag);assert.equal((await f.writing.read(f.target(0))).value.title,'Revised opening');
 assert.equal((await save(last,{title:'Late section',body:'Unambiguous late observation.'})).etag,b.etag,'Lost-response retry must not create another revision');
 await assert.rejects(save(last,{title:'Conflicting replacement',body:'Must not overwrite'}),{code:'RECORD_CHANGED'});
 const current=await f.writing.read(f.target(39));
 await assert.rejects(save(current,{title:'',body:'Invalid title'}),{code:'INVALID'});
 assert.equal((await f.workspace.outline()).etag,b.etag);
 const page=await new RecordQuery(f.workspace).list({workspaceId:f.book.id,query:{projectId:null,notebookId:null,filter:'all',search:'unambiguous late observation',browse:recordBrowse()},limit:10});
 assert.deepEqual(page.records.map(r=>r.id),[f.record.id]);
 const old=await new RecordContent(f.workspace).read({workspaceId:f.book.id,recordId:f.record.id,snapshotId:before,offset:39,header:false});
 assert.equal(old.sections.values[0].body,f.record.sections[39].body);
 await f.workspace.catalogue(store=>store.verifyRecordHistory(f.record.id));
 t.mock.restoreAll();await f.workspace.catalogue(store=>store.verifySnapshot(undefined,f.book.id));
 const untouched=await new RecordContent(f.workspace).read({workspaceId:f.book.id,recordId:f.record.id,offset:17,header:false});
 assert.deepEqual(untouched.sections.values,f.record.sections.slice(17,21));
 await assert.rejects(f.writing.read({...f.target(39),workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
 await assert.rejects(f.writing.read({...f.target(39),sectionId:randomUUID()}),{code:'MISSING'});
 await assert.rejects(f.writing.save({...f.target(39),expectedRevision:current.revision,value:{id:randomUUID(),title:'Illegal identity replacement',body:''}}),{code:'INVALID'});
});

test('a selected edit can cross the old record envelope budget and survive verified normal and fresh-key recovery',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-writing-capacity-')),book=sampleNotebook(),record=book.entries[2];
 book.entries=[record];record.body='';record.sections=Array.from({length:39},(_,i)=>({id:randomUUID(),title:'Section '+i,body:i<37?'e'.repeat(55000):''}));
 assert.ok(Buffer.byteLength(serialize(record))<2*1024*1024);
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const writing=new RecordWriting(f.workspace),target={workspaceId:book.id,recordId:record.id,sectionId:record.sections[38].id},base=await writing.read(target);
 const drafts=new RecordWritingDrafts(f.workspace),command={id:randomUUID(),workspaceId:book.id,recordId:record.id,expectedRevision:null,writing:{sectionId:target.sectionId,revision:base.revision,storageRevision:base.storageRevision},value:{title:'Beyond the old envelope',body:'v'.repeat(60000),share:false}};
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Capacity or recovery assembled a whole original');});
 const checkpoint=await drafts.write(command),saved=await writing.save({...target,expectedRevision:base.revision,value:command.value});
 const size=await f.workspace.catalogue(async store=>(await store.member(await store.snapshot(),record.id)).bytes);assert.ok(size>2*1024*1024,size+' retained bytes');
 const copied=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'backup')),{vault:f.vault}),restored=new Workspace(copied,f.vault);
 const access=await createAccess('','synthetic selected-writing recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const portable=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'fresh')),access,vault,f.vault),fresh=new Workspace(portable,vault);
 for(const workspace of [restored,fresh]){
  const result=await new RecordWriting(workspace).read(target);assert.deepEqual(result.value,command.value);assert.equal(result.revision,saved.revision);
  const recovered=await new RecordWritingDrafts(workspace).read({id:command.id,workspaceId:book.id,expectedRevision:checkpoint.revision});assert.deepEqual(recovered.value,command.value);
  assert.equal(await workspace.catalogue(async store=>catalogueRequiresSourcePublicationControls(await catalogueFormat(store.db))),true);
  await workspace.catalogue(store=>store.verifyRecordHistory(record.id));
 }
 t.diagnostic(JSON.stringify({recordBytes:size,writeRequestBytes:Buffer.byteLength(JSON.stringify({...target,expectedRevision:base.revision,value:command.value})),wholeRecordReads:0}));
});

test('selected writing checkpoints preserve their exact base and reject unselected changes',async t=>{
 const f=await fixture(t),base=await f.writing.read(f.target(39)),service=new RecordWritingDrafts(f.workspace),drafts=new ResearchDrafts(f.workspace);
 const command={id:randomUUID(),workspaceId:f.book.id,recordId:f.record.id,expectedRevision:null,writing:{sectionId:base.sectionId,revision:base.revision,storageRevision:base.storageRevision},value:{title:'Unfinished title',body:'Unfinished selected writing'}};
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Checkpoint loaded a complete original');});
 const receipt=await service.write(command);assert.deepEqual(await service.write(command),receipt);
 assert.equal((await drafts.list({workspaceId:f.book.id})).drafts.length,1);
 const selected={id:command.id,workspaceId:f.book.id,expectedRevision:receipt.revision};
 assert.deepEqual((await service.read(selected)).value,command.value);
 const current=await f.writing.read(f.target(0));
 await f.writing.save({...f.target(0),expectedRevision:current.revision,value:{title:'A different change',body:'Unrelated work'}});
 assert.deepEqual((await service.read(selected)).value,command.value,'Retained base is independent of the current head');
 await assert.rejects(service.write({...command,value:{...command.value,body:'Wrong revision'}}),{code:'DRAFT_CHANGED'});
 const retained=await drafts.read(command.id,{header:true});
 await f.workspace.withLock(()=>f.workspace.catalogue(store=>withDraftDocument(store,retained.draft,async document=>{
  const altered=await new RecordDocument(document.blocks,document.root,{mutable:true}).replace(['sections','0','body'],'Tampered unselected content');await altered.blocks.flush();
  await assert.rejects(verifyWritingDraft(store,{...retained.draft,document:{...retained.draft.document,root:altered.root}}),{code:'CATALOGUE_DAMAGED'});
 })));
 await drafts.remove(selected);assert.equal((await drafts.list({workspaceId:f.book.id})).drafts.length,0);
});

test('a failed selected-writing commit keeps the saved head and history intact and the checkpoint recoverable',async t=>{
 const f=await fixture(t),base=await f.writing.read(f.target(39)),drafts=new RecordWritingDrafts(f.workspace);
 const value={title:'Recovered after interruption',body:'An unpublished result',share:false};
 const command={id:randomUUID(),workspaceId:f.book.id,recordId:f.record.id,expectedRevision:null,writing:{sectionId:base.sectionId,revision:base.revision,storageRevision:base.storageRevision},value};
 const receipt=await drafts.write(command),before=await f.workspace.catalogue(async store=>({head:await store.head(),history:await store.historyIndex(f.record.id).head()}));
 t.mock.method(ResearchCatalogue.prototype,'finishRecordChanges',()=>{throw new Error('Synthetic index failure after retained writing');});
 await assert.rejects(f.writing.save({...f.target(39),expectedRevision:base.revision,value}),/Synthetic index failure/);t.mock.restoreAll();
 const after=await f.workspace.catalogue(async store=>({head:await store.head(),history:await store.historyIndex(f.record.id).head()}));assert.deepEqual(after,before);
 assert.deepEqual((await f.writing.read(f.target(39))).value,base.value);
 assert.deepEqual((await drafts.read({id:command.id,workspaceId:f.book.id,expectedRevision:receipt.revision})).value,value);
 await f.writing.save({...f.target(39),expectedRevision:base.revision,value});
 assert.deepEqual((await f.writing.read(f.target(39))).value,value);await f.workspace.catalogue(store=>store.verifySnapshot(undefined,f.book.id));
});

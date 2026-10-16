import {RECORD_TYPES} from '../src/web/record-types.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {RecordQuery} from '../src/record-query.js';
import {RecordTypeQuery} from '../src/record-type-query.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {recordBrowse} from '../src/web/record-query.js';
import {lookupRecordTypes} from '../src/web/record-type-lookup.js';
test('record pages omit the type catalogue; independent discovery is scoped, pinned and body-free',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-types-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.notebooks.push({...structuredClone(book.notebooks[0]),id:randomUUID(),title:'Second book'});
 book.entries=Array.from({length:65},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Take '+i,notebookId:book.notebooks[i%2].id,body:'Private original',sections:[],attachments:[],figures:[],relations:[],
  template:{id:randomUUID(),profileId:null,label:'Type '+i,description:'',fields:[],values:{}}}));
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const records=new RecordQuery(f.workspace),types=new RecordTypeQuery(f.workspace),query={projectId:null,notebookId:null,filter:'all',search:'',browse:recordBrowse()},etag=await f.workspace.catalogue(s=>s.head());
 const command={workspaceId:book.id,etag,projectId:null,notebookId:null,selected:'all',limit:25,search:'',cursor:null};
 const methods={record:ResearchCatalogue.prototype.record,read:ResearchCatalogue.prototype.read};let first,second;
 ResearchCatalogue.prototype.record=ResearchCatalogue.prototype.read=()=>{throw Error('Originals loaded while filtering');};
 try{
  const page=await records.list({workspaceId:book.id,query});assert.deepEqual(page.recordTypes,[]);assert.equal(page.snapshotId,etag);assert.equal(page.records.length,25);
  first=await types.read(command);second=await types.read({...command,cursor:first.nextCursor});assert.equal(first.total,65+RECORD_TYPES.length);assert.equal(first.items.length,25);assert.equal(second.offset,25);
  assert.deepEqual((await types.read({...command,cursor:second.previousCursor})).items,first.items);
  const selected=book.entries.at(-1).template,search=await types.read({...command,selected:'template:'+selected.id,search:'Type 10'});
  assert.equal(search.items[0].label,'Type 10');assert.equal(search.selected.label,selected.label);
  const scoped=await types.read({...command,notebookId:book.notebooks[0].id,search:'Type'});assert.equal(scoped.total,33);
  await assert.rejects(types.read({...command,projectId:book.projects[0].id,notebookId:book.notebooks[0].id}),{code:'INVALID'});
  await assert.rejects(types.read({...command,notebookId:randomUUID()}),{code:'RECORD_VIEW_SCOPE'});
  await assert.rejects(types.read({...command,cursor:first.nextCursor,notebookId:book.notebooks[0].id}),{code:'RECORD_QUERY_CURSOR'});
  await assert.rejects(types.read({...command,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
  await assert.rejects(types.read(command,{signal:AbortSignal.abort()}),{name:'AbortError'});
 }finally{Object.assign(ResearchCatalogue.prototype,methods);}
 const record=book.entries[0];await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Changed'}}]},{compact:true});
 const anchored=await types.read({...command,cursor:first.nextCursor});
 for(const key of ['items','total','offset','selected','etag'])assert.deepEqual(anchored[key],second[key]);
 const valid={...command};assert.deepEqual(await lookupRecordTypes(async()=>first,valid),first);
 await assert.rejects(lookupRecordTypes(async()=>({...first,items:Array(26).fill(first.items[0])}),valid),/record type response is invalid/);
 await assert.rejects(lookupRecordTypes(async()=>({...first,selected:{value:'note',label:'Wrong selection'}}),valid),/record type response is invalid/);
});

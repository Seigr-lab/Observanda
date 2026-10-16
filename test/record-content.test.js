import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {RecordContent} from '../src/record-content.js';
import {RecordValueTree} from '../src/record-value-tree.js';

test('section reading seeks stored blocks, pins revisions and cannot leak another workspace',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-content-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0];
 record.sections=Array.from({length:1025},(_,i)=>({id:randomUUID(),title:'Visit '+i,body:'Retained measurement '+i+' '+('Exact '.repeat(100))}));
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const reader=new RecordContent(f.workspace),command={workspaceId:book.id,recordId:record.id,offset:1021},etag=(await f.workspace.outline()).etag;
 const complete=async request=>{let result=await reader.read(request);while(result.search?.nextCursor)result=await reader.read({...request,snapshotId:result.etag,cursor:result.search.nextCursor});return result;};
 const originalRead=RecordValueTree.prototype.read,reads=[];
 RecordValueTree.prototype.read=async function(revision){const node=await this.node(revision);assert.notEqual(node.type,'array','a whole section array was materialized');reads.push(revision);return originalRead.call(this,revision);};
 let result;try{result=await reader.read(command);}finally{RecordValueTree.prototype.read=originalRead;}
 assert.equal(result.sections.total,1025);assert.deepEqual(result.sections.values,record.sections.slice(1021));assert.ok(reads.length<80,reads.length+' value reads');
 assert.equal(Object.hasOwn(result.header,'sections'),false);assert.equal(result.header.title,record.title);assert.equal(result.etag,etag);
 assert.equal(result.revision,recordRevision(record));
 const searching=await reader.read({...command,search:'Visit 1000'});assert.equal(searching.search.scanned,64);assert.equal(searching.header,undefined);assert.equal(searching.sections,undefined);
 await assert.rejects(reader.read({...command,search:'different',cursor:searching.search.nextCursor}),{code:'WORKSPACE_READ_CURSOR'});
 await assert.rejects(reader.read({...command,search:'Visit 1000',cursor:'invalid'}),{code:'WORKSPACE_READ_CURSOR'});
 assert.equal((await complete({...command,anchor:record.sections[777].id})).sections.offset,777);
 assert.equal((await complete({...command,search:'Visit 1000'})).found,1000);
 assert.equal((await complete({...command,search:'missing'})).found,null);
 const continuation=await reader.read({...command,header:false,snapshotId:etag});assert.equal(continuation.header,null);assert.deepEqual(continuation.sections,result.sections);
 const next=structuredClone(record);next.sections[1024].body='Later amendment';
 await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:next}]},{receipt:true});
 assert.equal((await reader.read(command)).sections.values[3].body,'Later amendment');
 const saved=await f.workspace.catalogue(store=>store.recordSelection([record.id]));
 assert.equal((await reader.read({...command,pagedHeader:true})).revision,recordRevision(saved.book.entries[0]));
 assert.equal((await reader.read({...command,snapshotId:etag,pagedHeader:true})).revision,recordRevision(record));
 assert.equal((await reader.read({...command,snapshotId:etag})).sections.values[3].body,record.sections[1024].body);
 await assert.rejects(reader.read({...command,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
 await assert.rejects(reader.read({...command,recordId:randomUUID()}),{code:'MISSING'});
 for(const bad of [{offset:-1},{offset:1.5},{snapshotId:'bad'},{extra:'bad'},{search:''},{anchor:'../../private'}])await assert.rejects(reader.read({...command,...bad}),{code:'INVALID'});
 const controller=new AbortController();controller.abort();await assert.rejects(reader.read(command,{signal:controller.signal}),{name:'AbortError'});
});

test('small envelope records use the same reading contract without a storage upgrade',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-small-record-content-')),book=upgradeNotebook(sampleNotebook()),f=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const record=book.entries[0],result=await new RecordContent(f.workspace).read({workspaceId:book.id,recordId:record.id});
 const {sections,...header}=record;assert.deepEqual(result.header,header);assert.deepEqual(result.sections.values,sections.slice(0,4));
});

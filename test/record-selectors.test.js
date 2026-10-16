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
import {RecordSelectors} from '../src/record-selectors.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {bookSelectors} from '../src/web/book-selectors.js';
test('saved reference destinations bind cursors to workspace, snapshot, record and search',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-selectors-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0];
 record.sections=Array.from({length:67},(_,i)=>({id:randomUUID(),title:'Visit '+i,body:'Kept observations '.repeat(200)}));
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const reader=new RecordSelectors(f.workspace),command={workspaceId:book.id,recordId:record.id},read=RecordValueTree.prototype.read;
 t.mock.method(RecordValueTree.prototype,'read',async function(ref){assert.notEqual((await this.node(ref)).type,'array','Hydrated full collection');return read.call(this,ref);});
 const first=await reader.read(command);assert.equal(first.revision,recordRevision(record));assert.deepEqual(first.items,bookSelectors(record).slice(0,20));
 const next={...command,snapshotId:first.etag,cursor:first.next};assert.deepEqual((await reader.read(next)).items,bookSelectors(record).slice(20,40));
 for(const wrong of [{search:'different'},{recordId:book.entries[1].id},{cursor:'bad'}])await assert.rejects(reader.read({...next,...wrong}),{code:'WORKSPACE_READ_CURSOR'});
 await assert.rejects(reader.read({...next,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
 for(const wrong of [{snapshotId:'bad'},{cursor:first.next},{extra:true},{search:[]},{search:'x'.repeat(161)}])await assert.rejects(reader.read({...command,...wrong}),{code:'INVALID'});
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(reader.read(command,{signal:cancelled.signal}),{name:'AbortError'});
 RecordValueTree.prototype.read.mock.restore();
 const changed={...record,sections:record.sections.map(s=>({...s,title:'Amended '+s.title}))};await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:changed}]},{receipt:true});
 assert.deepEqual((await reader.read(next)).items,bookSelectors(record).slice(20,40));
 const saved=(await f.workspace.read()).book.entries.find(item=>item.id===record.id),latest=await reader.read(command);assert.equal(latest.revision,recordRevision(saved));assert.equal(latest.items[0].label,changed.sections[0].title);
 await assert.rejects(reader.read({...next,snapshotId:latest.etag}),{code:'WORKSPACE_READ_CURSOR'});
});
test('small original envelopes and empty records use the same reference contract',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-small-selectors-')),book=upgradeNotebook(sampleNotebook()),f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const reader=new RecordSelectors(f.workspace);for(const record of book.entries){const page=await reader.read({workspaceId:book.id,recordId:record.id});assert.deepEqual(page.items,bookSelectors(record));assert.equal(page.next,null);}
});

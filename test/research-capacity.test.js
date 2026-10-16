import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {largeRecordBook} from './record-capacity-fixture.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {Workspace} from '../src/storage.js';
import {clearVault} from '../src/encryption.js';
import {validateCatalogueMetadata} from '../src/model.js';
import {startServer} from '../src/server.js';
import {researchBytes,researchCapacityIssue,researchRequestCapacity,MAX_RECORD_BYTES,MAX_RECORD_COMMAND_BYTES} from '../src/web/research-capacity.js';
import {researchCapacityMessage} from '../src/web/research-capacity-message.js';

test('capacity preflight uses UTF-8 storage bytes and separates record, checkpoint and request owners',()=>{
 assert.equal(researchBytes('界'),Buffer.byteLength(JSON.stringify('界',null,2)+'\n'));
 assert.equal(researchCapacityIssue('record',MAX_RECORD_BYTES),null);
 const issue=researchCapacityIssue('record',MAX_RECORD_BYTES+1,{recordId:randomUUID()});
 assert.equal(issue.details[0].requestedBytes,MAX_RECORD_BYTES+1);assert.equal(issue.details[0].limitBytes,MAX_RECORD_BYTES);
 assert.match(researchCapacityMessage(issue),/Record content needs 2097153 bytes/);assert.doesNotMatch(researchCapacityMessage(issue),/divide|split/i);
 assert.equal(researchCapacityMessage({details:{}}),null);assert.equal(researchCapacityMessage({details:[{kind:'research-capacity',owner:'unknown'}]}),null);
 const record={body:'界'.repeat(Math.ceil(MAX_RECORD_BYTES/3))},change={id:randomUUID(),record};
 assert.equal(researchRequestCapacity('/api/research/records/save',{changes:[change]}).code,'RECORD_SIZE_LIMIT');
 assert.equal(researchRequestCapacity('/api/research/records/save',{changes:[]},'x'.repeat(MAX_RECORD_COMMAND_BYTES+1)).code,'RECORD_COMMAND_LIMIT');
 assert.equal(researchRequestCapacity('/unrelated',{changes:[change]}),null);
});

test('an oversized research save preserves its durable draft; a larger rejected checkpoint preserves the prior revision',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-capacity-')),book=largeRecordBook(),f=await encryptedFixture(directory,book),base=book.entries[0],drafts=new ResearchDrafts(f.workspace),source=await f.workspace.outline();
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const draftRecord={...base,body:'界'.repeat(50000)},change={record:draftRecord,expectedRevision:recordRevision(base),baseRevision:recordRevision(base)},command={id:randomUUID(),workspaceId:book.id,expectedRevision:null,changes:[change]};
 assert.ok(researchBytes(draftRecord)>MAX_RECORD_BYTES);assert.equal(researchRequestCapacity('/api/research/drafts/write',command),null);
 const saved=await drafts.write(command);
 await assert.rejects(new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:base.id,expectedRevision:recordRevision(base),record:draftRecord}]},{receipt:true}),error=>{
  assert.equal(error.code,'RECORD_SIZE_LIMIT');assert.deepEqual(error.details,researchCapacityIssue('record',researchBytes(draftRecord),{recordId:base.id}).details);return true;
 });
 assert.equal((await f.workspace.outline()).etag,source.etag);
 const excessive={...command,expectedRevision:saved.revision,changes:[{...change,record:{...draftRecord,sections:Array.from({length:20},()=>({id:randomUUID(),title:'Original observations',body:'界'.repeat(60000)}))}}]};
 const issue=researchRequestCapacity('/api/research/drafts/write',excessive);assert.equal(issue.code,'DRAFT_SIZE_LIMIT');assert.equal(issue.details[0].owner,'recordCheckpoint');
 await assert.rejects(drafts.write(excessive),error=>{assert.equal(error.code,issue.code);assert.deepEqual(error.details,issue.details);return true;});
 const reopened=await new ResearchDrafts(new Workspace(f.workspace.root,f.vault)).read(command.id);
 assert.equal(reopened.revision,saved.revision);assert.deepEqual(reopened.draft.changes[0].record,draftRecord);assert.deepEqual(reopened.draft.changes[0].base,base);
 // The rejected request must not prevent a corrected draft from checkpointing.
 const corrected={...command,expectedRevision:saved.revision,changes:[{...change,record:{...draftRecord,title:'Corrected after capacity refusal'}}]};
 assert.notEqual((await drafts.write(corrected)).revision,saved.revision);
 assert.throws(()=>validateCatalogueMetadata({...source.metadata,entries:[],description:'x'.repeat(MAX_RECORD_BYTES)}),error=>{assert.equal(error.code,'WORKSPACE_METADATA_LIMIT');assert.equal(error.details[0].owner,'metadata');return true;});
});

test('HTTP capacity admission returns operation details before a write and keeps saved data intact',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-capacity-http-')),f=await encryptedFixture(directory,largeRecordBook()),app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});
 t.after(async()=>{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const response=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})}),cookie=response.headers.get('set-cookie').split(';')[0],before=await f.workspace.outline();
 for(const [route,code,owner] of [['/api/research/records/save','RECORD_COMMAND_LIMIT','recordCommand'],['/api/research/drafts/write','DRAFT_SIZE_LIMIT','checkpointRequest']]){
  const body=JSON.stringify({padding:'界'.repeat(Math.ceil(MAX_RECORD_COMMAND_BYTES/3))});
  const result=await fetch(app.origin+route,{method:'POST',headers:{Cookie:cookie,Origin:app.origin,'Content-Type':'application/json'},body});
  assert.equal(result.status,413);const error=await result.json();assert.equal(error.code,code);assert.equal(error.details[0].owner,owner);assert.equal(error.details[0].requestedBytes,Buffer.byteLength(body));
 }
 assert.equal((await f.workspace.outline()).etag,before.etag);assert.equal((await new ResearchDrafts(f.workspace).list()).drafts.length,0);
});

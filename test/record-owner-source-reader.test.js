import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {intakeFixture} from './fixtures/local-intake.js';
import {digest} from '../src/storage-format.js';
import {RecordOwnerTransfer} from '../src/record-owner-transfer.js';
import {recordOwnerTransferFingerprint,readRecordOwnerTransfer,writeRecordOwnerTransfer} from '../src/record-owner-transfer-state.js';

test('record transfer pins source reads while seeing current cancellation and closes both readers',{timeout:60000},async t=>{
 const f=await intakeFixture(t),sourceOwner={projectId:null,labBookId:null,workspaceId:f.book.id},targetOwner={projectId:null,labBookId:null,workspaceId:randomUUID()},id=randomUUID();
 const command={id,workspaceId:f.book.id,recordId:f.record.id,sourceNotebookId:f.record.notebookId,expectedStorageRevision:digest('synthetic revision'),targetWorkspaceId:targetOwner.workspaceId,targetNotebookId:randomUUID()},stamp=new Date().toISOString();
 const receipt={version:1,id,command,sourceOwner,targetOwner,fingerprint:recordOwnerTransferFingerprint(command,sourceOwner,targetOwner),phase:'copying',sourceSnapshotId:await f.ws.catalogue(store=>store.head()),createdAt:stamp,updatedAt:stamp,progress:{},result:null};
 await f.ws.withLock(()=>f.ws.catalogue(store=>writeRecordOwnerTransfer(store,receipt)));
 let active=0;const open=f.ws.openCatalogue.bind(f.ws);
 f.ws.openCatalogue=async()=>{const db=await open();active++;const close=db.close.bind(db);db.close=async()=>{try{return await close();}finally{active--;}};return db;};
 const context={source:f.ws,performWithSourceReader:async(selected,options,read)=>{
  assert.equal(selected,id);assert.equal((await f.ws.catalogue(store=>readRecordOwnerTransfer(store,id))).phase,'copying');
  await f.ws.withLock(()=>f.ws.catalogue(store=>writeRecordOwnerTransfer(store,{...receipt,phase:'cancelled'})));
  assert.equal((await read()).phase,'cancelled');
  assert.equal((await f.ws.catalogue(store=>readRecordOwnerTransfer(store,id))).phase,'copying');
 }};
 await RecordOwnerTransfer.prototype.perform.call(context,id);assert.equal(active,0);
 context.performWithSourceReader=async()=>{throw new Error('Interrupted transfer');};
 await assert.rejects(RecordOwnerTransfer.prototype.perform.call(context,id),/Interrupted transfer/);assert.equal(active,0);
 f.ws.openCatalogue=open;
});

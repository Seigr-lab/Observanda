import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {intakeFixture,hash} from './fixtures/local-intake.js';
import {RunReceiptStore,verifyRunReceiptStores} from '../src/run-receipt-store.js';
import {RunReadiness} from '../src/run-readiness.js';
import {RecordValues} from '../src/record-values.js';
import {withWorkspaceMetadataBatch} from '../src/metadata-batch.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {catalogueFormat} from '../src/catalogue-format.js';
import {encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';

const receipt=(revision,evidenceRevision,index)=>({id:randomUUID(),kind:'validation',recordRevision:revision,evidenceRevision,recordedAt:new Date(Date.UTC(2020,0,1)+index*1000).toISOString(),statement:'Declared inspection scope. '.repeat(70),declared:true});
test('receipt count and total size grow independently of readiness reads, policy and history pages',async t=>{
 const f=await intakeFixture(t),ready=new RunReadiness(f.ws),store=new RunReceiptStore(f.ws,f.record.id),view=await ready.view(f.command),receipts=Array.from({length:620},(_,i)=>receipt(i?hash('earlier record'):view.revision,view.evidenceRevision,i));
 assert.ok(Buffer.byteLength(JSON.stringify(receipts))>1024*1024);
 await f.ws.withLock(()=>withWorkspaceMetadataBatch(f.ws,async()=>{for(const value of receipts)await store.appendLocked(value);}));
 await ready.setPolicy({...f.command,expectedPolicy:view.policy.etag,required:['validation']});
 let itemReads=0;const read=f.ws.readMetadata;t.mock.method(f.ws,'readMetadata',function(name,...args){if(name.startsWith(store.root+'/items/'))itemReads++;return read.call(this,name,...args);});
 const first=await ready.view(f.command);assert.equal(first.receipts.length,20);assert.equal(first.receiptPage.total,620);assert.deepEqual(first.missing,[]);assert.ok(first.receipts.every(r=>!r.current));assert.ok(itemReads<=25,'Readiness read '+itemReads+' receipt objects');f.ws.readMetadata.mock.restore();
 const ids=new Set();let cursor=null,last;
 do{last=await store.page({cursor});assert.ok(last.items.length<=20);for(const item of last.items){assert.ok(!ids.has(item.id));ids.add(item.id);}cursor=last.next;}while(cursor);assert.equal(ids.size,620);assert.equal(last.items.at(-1).id,receipts[0].id);
 await assert.rejects(new RunReceiptStore(f.ws,f.book.entries[1].id).page({cursor:first.receiptPage.next}),{code:'INVALID'});
 const values=new RecordValues(f.ws),target={workspaceId:f.book.id,recordId:f.record.id,field:'status'},base=await values.read(target);await values.save({...target,expectedRevision:base.revision,value:{value:'completed'}});assert.deepEqual((await ready.view(f.command)).missing,[]);
 await f.ws.catalogue(()=>verifyRunReceiptStores(f.ws));
 const backup=await copyWorkspace(await copyPlan(f.ws.root,path.join(f.directory,'receipt-backup')),{vault:f.vault}),restored=new RunReceiptStore(new Workspace(backup,f.vault),f.record.id);assert.deepEqual(await restored.page({cursor:first.receiptPage.next}),await store.page({cursor:first.receiptPage.next}));assert.equal(await restored.lookup('validation',view.revision,view.evidenceRevision),true);
 const link=store.basis(receipts[0]);await f.ws.withLock(()=>f.ws.writeMetadata(link,JSON.stringify({id:receipts[0].id,sha256:hash('wrong receipt')})));await assert.rejects(ready.view(f.command),{code:'CATALOGUE_DAMAGED'});await assert.rejects(f.ws.catalogue(()=>verifyRunReceiptStores(f.ws)),{code:'CATALOGUE_DAMAGED'});
});

test('legacy receipt conversion and failed appends commit atomically without losing old entries',async t=>{
 const f=await intakeFixture(t),store=new RunReceiptStore(f.ws,f.record.id),format=await f.ws.catalogue(store=>catalogueFormat(store.db)),legacy='.observanda/run-readiness/records/'+f.record.id+'.json',old=[receipt(f.manifest.expectedRevision,hash('evidence'),0),receipt(f.manifest.expectedRevision,hash('evidence'),1)];delete old[0].evidenceRevision;
 await f.ws.withLock(()=>f.ws.writeMetadata(legacy,JSON.stringify(old)));
 const write=f.ws.writeMetadata;t.mock.method(f.ws,'writeMetadata',async function(name,text){await write.call(this,name,text);if(name===store.marker)throw Error('Interrupted receipt index');});await assert.rejects(store.ensure(),/Interrupted receipt index/);f.ws.writeMetadata.mock.restore();
 assert.deepEqual(JSON.parse(await f.ws.readMetadata(legacy,1024*1024)),old);assert.equal(await store.metadata(),null);assert.equal(await store.stored(old[0].id),null);assert.equal(await f.ws.catalogue(store=>catalogueFormat(store.db)),format);
 await store.ensure();assert.equal(await f.ws.catalogue(store=>catalogueFormat(store.db)),Math.max(format,9));assert.equal(await f.ws.readMetadata(legacy,1024*1024),null);assert.deepEqual((await store.page()).items,[old[1],old[0]]);assert.deepEqual(await store.get(old[0].id),old[0]);
 const next=receipt(f.manifest.expectedRevision,hash('evidence'),2);t.mock.method(f.ws,'writeMetadata',async function(name,text){await write.call(this,name,text);if(name===store.marker)throw Error('Interrupted receipt append');});await assert.rejects(f.ws.withLock(()=>store.appendLocked(next)),/Interrupted receipt append/);f.ws.writeMetadata.mock.restore();assert.equal(await store.get(next.id),null);assert.equal((await store.page()).total,2);
 await f.ws.withLock(()=>store.appendLocked(next));assert.deepEqual(await f.ws.withLock(()=>store.appendLocked(next)),next);assert.equal((await store.page()).total,3);await assert.rejects(f.ws.withLock(()=>store.appendLocked({...next,statement:'Different request'})),{code:'INTAKE_CHANGED'});
 await f.ws.catalogue(()=>verifyRunReceiptStores(f.ws));
 const access=await createAccess('','Receipt recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));const copied=await encryptedCopy(await copyPlan(f.ws.root,path.join(f.directory,'fresh-key-receipts')),access,vault,f.vault),workspace=new Workspace(copied,vault),restored=new RunReceiptStore(workspace,f.record.id);assert.equal(await workspace.catalogue(store=>catalogueFormat(store.db)),Math.max(format,9));assert.deepEqual(await restored.page(),await store.page());
 await f.ws.withLock(()=>f.ws.removeMetadata(store.feed.order+'/'+store.feed.key({id:next.id,createdAt:next.recordedAt})));await assert.rejects(f.ws.catalogue(()=>verifyRunReceiptStores(f.ws)),{code:'CATALOGUE_DAMAGED'});
});

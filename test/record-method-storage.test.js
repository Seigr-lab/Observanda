import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault,seal} from '../src/encryption.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {RecordValues} from '../src/record-values.js';
import {RecordMethodIndex} from '../src/record-method-index.js';
import {recordRunComparison} from '../src/record-run-comparison.js';
import {withRecordDocument} from '../src/record-document.js';
import {withStoredRecord,verifyStoredRecord} from '../src/record-storage.js';
import {RecordBlockStore} from '../src/record-block-store.js';
import {serialize} from '../src/storage-format.js';
import {recordRevision} from '../src/research.js';
import {researchReference} from '../src/web/research-reference.js';
import {catalogueFormat} from '../src/catalogue-format.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-method-storage-')),book=sampleNotebook(),record=book.entries[2];record.status='draft';record.sections=Array.from({length:67},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Unchanged narrative '+i}));book.entries[1].type='protocol';
 const f=await encryptedFixture(directory,book),ready=await f.workspace.read(),method=ready.book.entries[1],linkId=randomUUID(),values=new RecordValues(f.workspace),target={workspaceId:book.id,recordId:record.id,field:'relation:'+linkId};
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const base=await values.read(target),command={...target,expectedRevision:base.revision,value:{value:{type:'Uses method',label:'Pinned method',role:'uses-method',reference:researchReference({workspaceId:book.id,kind:'record',id:method.id,revision:recordRevision(method)})}}};
 return {...f,directory,book,record,method,values,target,command};
}
async function selected(workspace,id,consume,snapshotId){return workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(snapshotId),id);return withRecordDocument(store,id,row.revision,doc=>consume(doc,row,store));});}

test('first method indexing rolls back atomically, retains old comparisons and survives both copy modes',async t=>{
 const f=await fixture(t),before=await f.workspace.catalogue(store=>catalogueFormat(store.db)),head=(await f.workspace.outline()).etag;assert.ok(before<14);
 const finish=ResearchCatalogue.prototype.finishRecordChanges;t.mock.method(ResearchCatalogue.prototype,'finishRecordChanges',async function(...args){await finish.apply(this,args);assert.equal(await catalogueFormat(this.db),20);throw Error('Interrupted method index upgrade');});
 await assert.rejects(f.values.save(f.command),/Interrupted method index upgrade/);ResearchCatalogue.prototype.finishRecordChanges.mock.restore();assert.equal((await f.workspace.outline()).etag,head);assert.equal(await f.workspace.catalogue(store=>catalogueFormat(store.db)),before);
 const first=await f.values.save(f.command);assert.deepEqual(await f.values.save(f.command),first);assert.equal(await f.workspace.catalogue(store=>catalogueFormat(store.db)),20);
 const index=await selected(f.workspace,f.record.id,doc=>doc.methodIndex);assert.ok(index);const pinned=await selected(f.workspace,f.record.id,doc=>recordRunComparison(doc));assert.deepEqual(pinned.methods,[{label:'Pinned method',revision:recordRevision(f.method)}]);
 await selected(f.workspace,f.record.id,async doc=>{doc.items=()=>{throw Error('Unchanged method owner scanned');};assert.deepEqual(await RecordMethodIndex.retain(doc),index);});
 const title={workspaceId:f.book.id,recordId:f.record.id,field:'title'},base=await f.values.read(title);await f.values.save({...title,expectedRevision:base.revision,value:{value:'Later explanation'}});assert.deepEqual(await selected(f.workspace,f.record.id,doc=>doc.methodIndex),index);
 const link=await f.values.read(f.target);await f.values.save({...f.target,expectedRevision:link.revision,value:{value:{...link.value.value,label:'Reviewed method label'}}});assert.equal((await selected(f.workspace,f.record.id,doc=>recordRunComparison(doc))).methods[0].label,'Reviewed method label');assert.deepEqual(await selected(f.workspace,f.record.id,doc=>recordRunComparison(doc),first.etag),pinned);
 const copied=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'copy')),{vault:f.vault}),access=await createAccess('','synthetic indexed methods recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'fresh')),access,vault,f.vault);
 for(const workspace of [new Workspace(copied,f.vault),new Workspace(fresh,vault)]){
  assert.equal(await workspace.catalogue(store=>catalogueFormat(store.db)),20);assert.deepEqual(await selected(workspace,f.record.id,doc=>recordRunComparison(doc),first.etag),pinned);await workspace.catalogue(store=>store.verifySnapshot(undefined,f.book.id));
 }
});

test('method manifests reject downgraded generations, damaged sources and missing derivatives while old manifests remain readable',async t=>{
 const f=await fixture(t),saved=await f.values.save(f.command),expected=await selected(f.workspace,f.record.id,doc=>recordRunComparison(doc));
 const mutate=async(change,check)=>f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const row=await store.member(await store.snapshot(),f.record.id);
  await withStoredRecord(store,row.id,row.revision,async({value,key,row:stored,blocks})=>{await change(value,store,blocks);await store.db.run('UPDATE records SET payload=$1 WHERE id=$2 AND revision=$3',seal(Buffer.from(serialize(value)),key,store.recordAAD(row.id,row.revision,stored.scope_id,stored.generation)),row.id,row.revision);});
  await check(store,row);throw Error('Rollback synthetic representation');
 }));
 for(const change of [async(v,store)=>store.db.run('UPDATE catalogue_format SET version=13'),v=>v.methodIndex.source='0'.repeat(64),v=>v.methodIndex.relations++,v=>v.methodIndex.root=null])await assert.rejects(mutate(change,(store,row)=>verifyStoredRecord(store,row.id,row.revision)),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(mutate(v=>{delete v.methodIndex;v.version=1;},async(store,row)=>{
  assert.deepEqual(await withRecordDocument(store,row.id,row.revision,doc=>recordRunComparison(doc)),expected);await verifyStoredRecord(store,row.id,row.revision);
 }),/Rollback synthetic representation/);
 // The derivative cannot be decrypted using another notebook's scope key.
 await f.workspace.withLock(()=>selected(f.workspace,f.record.id,async(doc,row,store)=>{const other=randomUUID(),key=await store.scopeKey(other,1,{create:true});try{const wrong=new RecordBlockStore(store,other,1,key);await assert.rejects(wrong.read('index',doc.methodIndex.root.hash));}finally{key.fill(0);}}));
 assert.equal((await f.workspace.outline()).etag,saved.etag);await f.workspace.catalogue(store=>store.verifySnapshot(undefined,f.book.id));
});

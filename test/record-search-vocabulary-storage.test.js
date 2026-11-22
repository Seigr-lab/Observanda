import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {TestDeviceStore} from './device-fixture.js';
import {RecordValues} from '../src/record-values.js';
import {RecordQuery} from '../src/record-query.js';
import {recordBrowse,recordSearchText} from '../src/web/record-query.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {catalogueFormat} from '../src/catalogue-format.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {pinnedQueryResults} from '../src/pinned-query-result.js';
import {Workspace} from '../src/storage.js';
import {withQueryValue} from '../src/record-query-storage.js';
import {retainSearchVocabulary,verifySearchVocabulary} from '../src/record-search-vocabulary.js';
import {attemptFixture} from './fixtures/attempts.js';
import {withRecordDocument} from '../src/record-document.js';
import {withRecordProjectionScratch} from '../src/record-projection-scratch.js';
import {RetainedTableIndex} from '../src/retained-table-index.js';
import {RecordQueryDocuments} from '../src/record-query-documents.js';
import {verifyRecordVocabulary} from '../src/record-document-verification.js';
import {digest,serialize} from '../src/storage-format.js';
const search=(workspace,workspaceId,text)=>new RecordQuery(workspace).list({workspaceId,query:{projectId:null,notebookId:null,filter:'all',search:text,browse:recordBrowse()}});

test('query descriptors bind their joined search text and refuse versions no release writes',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-query-descriptor-')),book=sampleNotebook(),record=book.entries[0];book.entries=[record];record.figures=[];record.attachments=[];record.relations=[];record.sections=[];
 record.attempt=attemptFixture();
 const f=await encryptedFixture(directory,book);t.after(async()=>{await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(),row=await store.member(snapshot,record.id),queries=new RecordQueryDocuments(store);
  await withRecordDocument(store,row.id,row.revision,async document=>{
   const revisions=await queries.retainDocument(document,(await document.encoding()).contentRevision),current={...row,...revisions};assert.ok(await catalogueFormat(store.db)>=20);
   assert.equal((await Array.fromAsync(queries.read([current],snapshot.metadata)))[0].searchText,recordSearchText(await document.tree.read(document.root)));await verifyRecordVocabulary(store,current);
   const source={revision:revisions.queryRevision,slot:'record-query:'+row.id+':'+revisions.queryRevision},payload=await store.db.get('SELECT payload FROM state WHERE slot=$1',source.slot),descriptor=store.decode('state',source.slot,payload.payload);assert.equal(descriptor.version,6);
   // Versions 2 to 5 were written only before alpha.29; they are damage now.
   for(const version of [2,3,4,5]){const retired={...descriptor,version};await assert.rejects(withQueryValue(store,retired,{revision:digest(serialize(retired))},row,()=>assert.fail('Retired query version was accepted')),{code:'CATALOGUE_DAMAGED'});}
   const bad={...descriptor,vocabulary:{...descriptor.vocabulary,text:await document.tree.retain('Unrelated text')}};await document.blocks.flush();
   await assert.rejects(withQueryValue(store,bad,{revision:digest(serialize(bad))},row,()=>assert.fail('Unbound search text was accepted')),{code:'CATALOGUE_DAMAGED'});
  },{mutable:true});
 }));
});

test('verification reads vocabulary contributions even for small records without collection references',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-small-vocabulary-')),book=sampleNotebook(),record=book.entries[0];book.entries=[record];record.figures=[];record.attachments=[];record.relations=[];record.sections=[];
 const f=await encryptedFixture(directory,book);t.after(async()=>{await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const values=new RecordValues(f.workspace),target={workspaceId:book.id,recordId:record.id,field:'title'},base=await values.read(target);await values.save({...target,expectedRevision:base.revision,value:{value:'Small retained vocabulary'}});
 await f.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),record.id);assert.ok(row.bytes<65535);assert.equal(row.collections,undefined);await store.verifySnapshot(undefined,book.id);});
 await assert.rejects(f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const row=await store.member(await store.snapshot(),record.id),source={revision:row.queryRevision,slot:'record-query:'+record.id+':'+row.queryRevision},found=await store.db.get('SELECT payload FROM state WHERE slot=$1',source.slot);
  await withQueryValue(store,store.decode('state',source.slot,found.payload),source,row,async({value,tree})=>{const first=await tree.index.entryAt({root:value.vocabulary.parts},0);await store.db.run('DELETE FROM state WHERE slot=$1',tree.storage.slot('value',first.revision));});
  await store.verifySnapshot(undefined,book.id);
 })),{code:'CATALOGUE_DAMAGED'});
 await f.workspace.catalogue(store=>store.verifySnapshot(undefined,book.id));
});

test('selected text saves use retained vocabulary and recover exact searches through both copy modes',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-vocabulary-storage-')),book=sampleNotebook(),record=book.entries[0];book.entries=[record];record.figures=[];record.attachments=[];record.relations=[];record.title='Original quartz';record.sections=Array.from({length:72},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Repeated quartz observation'}));
 const f=await encryptedFixture(directory,book);t.after(async()=>{await pinnedQueryResults.clear();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const values=new RecordValues(f.workspace),target={workspaceId:book.id,recordId:record.id,field:'title'},base=await values.read(target),before=(await f.workspace.outline()).etag,generation=await f.workspace.catalogue(s=>catalogueFormat(s.db));
 const finish=ResearchCatalogue.prototype.finishRecordChanges;t.mock.method(ResearchCatalogue.prototype,'finishRecordChanges',async function(...args){await finish.apply(this,args);throw Error('Interrupted vocabulary save');});
 await assert.rejects(values.save({...target,expectedRevision:base.revision,value:{value:'Interim quartz'}}),/Interrupted vocabulary save/);ResearchCatalogue.prototype.finishRecordChanges.mock.restore();assert.equal((await f.workspace.outline()).etag,before);assert.equal(await f.workspace.catalogue(s=>catalogueFormat(s.db)),generation);
 await values.save({...target,expectedRevision:base.revision,value:{value:'Interim quartz'}});
 const first=await values.read(target),text=RecordValueTree.prototype.text;t.mock.method(RecordValueTree.prototype,'text',function(root,path,...rest){if(path[0]==='searchText')throw Error('Search update scanned complete text');return text.call(this,root,path,...rest);});
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Search edit reconstructed original record');});
 const command={...target,expectedRevision:first.revision,value:{value:'Revised zirconium 🌿'}},saved=await values.save(command);assert.deepEqual(await values.save(command),saved);RecordValueTree.prototype.text.mock.restore();ResearchCatalogue.prototype.record.mock.restore();
 assert.equal((await search(f.workspace,book.id,'zirconium 🌿')).total,1);assert.equal((await search(f.workspace,book.id,'quartz')).total,1);assert.equal((await search(f.workspace,book.id,'Interim')).total,0);
 await f.workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(),row=await store.member(snapshot,record.id),source={revision:row.queryRevision,slot:'record-query:'+record.id+':'+row.queryRevision},found=await store.db.get('SELECT payload FROM state WHERE slot=$1',source.slot),descriptor=store.decode('state',source.slot,found.payload);
  await withQueryValue(store,descriptor,source,row,async({value,tree})=>{
   assert.equal(value.version,6);
   await withRecordDocument(store,row.id,row.revision,document=>withRecordProjectionScratch(document,async projected=>{
    const expected=await retainSearchVocabulary(projected),index=new RetainedTableIndex(projected.blocks,{namespace:'index',allowSparseBranches:true}),root=await index.change(value.vocabulary.terms,'ffff','1'.padStart(64,'0'));await index.flush(root);
    await verifySearchVocabulary(tree.storage,value.vocabulary,projected.blocks,expected);await assert.rejects(verifySearchVocabulary(projected.blocks,{...value.vocabulary,terms:root},projected.blocks,expected),{code:'CATALOGUE_DAMAGED'});
   }));
  });
  await store.verifySnapshot(undefined,book.id);
 });
 await assert.rejects(f.workspace.withLock(()=>f.workspace.catalogue(async store=>{await store.db.run('UPDATE catalogue_format SET version=19');await search(f.workspace,book.id,'zirconium');})),{code:'CATALOGUE_DAMAGED'});
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'copy'),{vault:f.vault}),{vault:f.vault}),access=await createWorkspaceAccess('','Synthetic search recovery',new TestDeviceStore({file:path.join(directory,'device.key')})),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'fresh'),{vault:f.vault}),access,vault,f.vault);
 for(const workspace of [new Workspace(copy,f.vault),new Workspace(fresh,vault)]){
  assert.equal((await search(workspace,book.id,'zirconium 🌿')).total,1);assert.equal((await search(workspace,book.id,'quartz')).total,1);await workspace.catalogue(store=>store.verifySnapshot(undefined,book.id));
 }
});

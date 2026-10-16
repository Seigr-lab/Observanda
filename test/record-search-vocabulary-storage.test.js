import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {RecordValues} from '../src/record-values.js';
import {RecordQuery} from '../src/record-query.js';
import {recordBrowse,recordSearchText} from '../src/web/record-query.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {catalogueFormat,requireSearchVocabulary,requireJoinedQueryText,requireKeyedQueryArrays,requireReferenceQueries} from '../src/catalogue-format.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {withQueryValue} from '../src/record-query-storage.js';
import {retainSearchVocabulary,verifySearchVocabulary} from '../src/record-search-vocabulary.js';
import {retainReferenceIndex} from '../src/record-reference-index.js';
import {attemptFixture} from './fixtures/attempts.js';
import {withRecordDocument} from '../src/record-document.js';
import {withRecordProjectionScratch} from '../src/record-projection-scratch.js';
import {RetainedTableIndex} from '../src/retained-table-index.js';
import {RecordQueryDocuments} from '../src/record-query-documents.js';
import {retainedQueryProjection} from '../src/record-query-projection.js';
import {verifyRecordVocabulary} from '../src/record-document-verification.js';
import {digest,serialize} from '../src/storage-format.js';
const search=(workspace,workspaceId,text)=>new RecordQuery(workspace).list({workspaceId,query:{projectId:null,notebookId:null,filter:'all',search:text,browse:recordBrowse()}});

test('old flattened queries retain their exact searches and upgrade on the next edit with strict joined-text binding',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-legacy-query-')),book=sampleNotebook(),record=book.entries[0];book.entries=[record];record.figures=[];record.attachments=[];record.relations=[];record.sections=[];
 record.attempt=attemptFixture();
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(),row=await store.member(snapshot,record.id),queries=new RecordQueryDocuments(store);
  await withRecordDocument(store,row.id,row.revision,async document=>{
   const projection=await retainedQueryProjection(document,(await document.encoding()).contentRevision),flat=await document.tree.retain(await document.tree.read(projection.root)),base={format:'observanda-record-query-blocks',version:1,id:row.id,notebookId:row.notebookId,generation:document.blocks.generation};
   // Earlier writers used ordinary arrays, with either flattened or joined text.
   for(const version of [2,3,4,5]){
   const vocabulary=await retainSearchVocabulary(document,{version:version===2?1:2}),referenceIndex=version===5?await retainReferenceIndex(document,{version:1}):null;
   let root=version===2?flat:await document.replaceReference(version>=4?projection.root:flat,['searchText'],vocabulary.text);if(referenceIndex)root=await document.replaceReference(root,['referenceTargets'],referenceIndex.root);await document.blocks.flush();
   await ({2:requireSearchVocabulary,3:requireJoinedQueryText,4:requireKeyedQueryArrays,5:requireReferenceQueries}[version])(store.db);
   const legacy={...base,version,root,vocabulary,...(referenceIndex?{referenceIndex}:{})},revisions=await queries.retainValues(row.id,legacy,{...base,root:projection.summaryRoot}),oldRow={...row,...revisions};
   const exact=recordSearchText(await document.tree.read(document.root));assert.equal((await Array.fromAsync(queries.read([oldRow],snapshot.metadata)))[0].searchText,exact);await verifyRecordVocabulary(store,oldRow);
   const next=await document.replace(['title'],'Joined revision 🌿'),updated=await queries.retainDocument(next,(await next.encoding()).contentRevision,{previous:oldRow}),nextRow={...row,...updated};assert.equal(await catalogueFormat(store.db),20);
   assert.equal((await Array.fromAsync(queries.read([nextRow],snapshot.metadata)))[0].searchText,recordSearchText(await next.tree.read(next.root)));
   assert.equal((await Array.fromAsync(queries.read([oldRow],snapshot.metadata)))[0].searchText,exact);await verifyRecordVocabulary(store,oldRow);
   const source={revision:updated.queryRevision,slot:'record-query:'+row.id+':'+updated.queryRevision},payload=await store.db.get('SELECT payload FROM state WHERE slot=$1',source.slot),descriptor=store.decode('state',source.slot,payload.payload);
   const bad={...descriptor,vocabulary:{...descriptor.vocabulary,text:await next.tree.retain('Unrelated text')}};await document.blocks.flush();
   await assert.rejects(withQueryValue(store,bad,{revision:digest(serialize(bad))},row,()=>assert.fail('Unbound search text was accepted')),{code:'CATALOGUE_DAMAGED'});
   }
  },{mutable:true});
 }));
});

test('verification reads vocabulary contributions even for small records without collection references',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-small-vocabulary-')),book=sampleNotebook(),record=book.entries[0];book.entries=[record];record.figures=[];record.attachments=[];record.relations=[];record.sections=[];
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
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
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const values=new RecordValues(f.workspace),target={workspaceId:book.id,recordId:record.id,field:'title'},base=await values.read(target),before=(await f.workspace.outline()).etag,generation=await f.workspace.catalogue(s=>catalogueFormat(s.db));assert.ok(generation<16);
 const finish=ResearchCatalogue.prototype.finishRecordChanges;t.mock.method(ResearchCatalogue.prototype,'finishRecordChanges',async function(...args){await finish.apply(this,args);assert.equal(await catalogueFormat(this.db),20);throw Error('Interrupted vocabulary upgrade');});
 await assert.rejects(values.save({...target,expectedRevision:base.revision,value:{value:'Interim quartz'}}),/Interrupted vocabulary upgrade/);ResearchCatalogue.prototype.finishRecordChanges.mock.restore();assert.equal((await f.workspace.outline()).etag,before);assert.equal(await f.workspace.catalogue(s=>catalogueFormat(s.db)),generation);
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
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'copy')),{vault:f.vault}),access=await createAccess('','Synthetic search recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'fresh')),access,vault,f.vault);
 for(const workspace of [new Workspace(copy,f.vault),new Workspace(fresh,vault)]){
  assert.equal((await search(workspace,book.id,'zirconium 🌿')).total,1);assert.equal((await search(workspace,book.id,'quartz')).total,1);await workspace.catalogue(store=>store.verifySnapshot(undefined,book.id));
 }
});

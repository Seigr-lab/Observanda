import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {ResearchCatalogue,catalogueDescriptor} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {withCatalogueVerification} from '../src/catalogue-verification.js';
import {verifyMembershipChange,verifyDerivedRecordChange,verifyIndexedDelta} from '../src/record-index-verification.js';
import {SnapshotIndex} from '../src/snapshot-index.js';
import {RecordRecentIndex} from '../src/record-recent-index.js';
import {ObjectIndex} from '../src/object-index.js';
import {withWorkspaceMetadataBatch} from '../src/metadata-batch.js';

test('metadata point reads reuse authenticated branches within one snapshot and reject changed bounds and later corruption',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-metadata-node-reuse-')),f=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 await f.workspace.withLock(()=>withWorkspaceMetadataBatch(f.workspace,async()=>{for(let i=0;i<80;i++)await f.workspace.writeMetadata('.observanda/reuse/item-'+i+'.json',JSON.stringify({i}));}));
 let oldCache,slot;
 await f.workspace.catalogue(async store=>{
  oldCache=store.readCache;const decode=store.decode;let branches=0;
  store.decode=function(table,id,...args){if(id.startsWith('object-index:'))branches++;return decode.call(this,table,id,...args);};
  for(let i=0;i<50;i++)assert.equal((await store.object('metadata:.observanda/reuse/item-79.json')).text,'{"i":79}');
  const head=await store.objectIndex().head();assert.ok(branches<=head.root.height);assert.ok(oldCache.nodeBytes<=oldCache.maxBytes);assert.ok(oldCache.nodes.size<=oldCache.maxRows);
  const node=await store.objectIndex().node(head.root);assert.ok(Object.isFrozen(node));
  await assert.rejects(store.objectIndex().node(head.root,node.id),{code:'CATALOGUE_DAMAGED'});slot='object-index:'+head.root.key;
 });
 assert.equal(oldCache.nodes.size,0);assert.equal(oldCache.nodeBytes,0);
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{const row=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot),bytes=Buffer.from(row.payload);bytes[bytes.length-1]^=1;await store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',bytes,slot);}));
 await assert.rejects(f.workspace.readMetadata('.observanda/reuse/item-79.json'),{code:'ENCRYPTION_DAMAGED'});
});

test('a fixed catalogue audit checks unchanged record content once across retained snapshots and never trusts a later audit',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-verification-reuse-')),book=sampleNotebook(),seed=book.entries[0];
 book.entries=Array.from({length:42},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Trial '+i,body:'Retained observation. '.repeat(100),relations:[],sections:[],attachments:[],figures:[],contributors:[]}));
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 let current=(await f.workspace.read()).book.entries[0];const service=new ResearchRecords(f.workspace,{});
 for(let i=0;i<10;i++){
  const result=await service.save({workspaceId:book.id,changes:[{id:current.id,expectedRevision:recordRevision(current),record:{...current,title:'Edited '+i}}]},{recordIds:[current.id]});
  current=result.book.entries[0];
 }
 const record=ResearchCatalogue.prototype.record,query=ResearchCatalogue.prototype.queryDocuments,validation=SnapshotIndex.prototype.validationRows;let bodies=0,untouched=0,searchDocuments=0,validationChecks=0;
 SnapshotIndex.prototype.validationRows=function(...args){validationChecks++;return validation.apply(this,args);};
 ResearchCatalogue.prototype.record=async function(id,...args){bodies++;if(id===book.entries[1].id)untouched++;return record.call(this,id,...args);};
 ResearchCatalogue.prototype.queryDocuments=async function*(rows,metadata,options={}){for await(const value of query.call(this,rows,metadata,options)){if(options.search!==false)searchDocuments++;yield value;}};
 const start=performance.now();
 try{await f.workspace.catalogue(store=>store.verify(catalogueDescriptor(book)));}
 finally{ResearchCatalogue.prototype.record=record;ResearchCatalogue.prototype.queryDocuments=query;SnapshotIndex.prototype.validationRows=validation;}
 assert.equal(untouched,1,'Snapshot validation reads the original once; independent history checks traverse stored blocks');
 assert.equal(bodies,42+10);assert.ok(performance.now()-start<60000);
 assert.ok(searchDocuments<150,'Search originals must not be reread for every retained snapshot: '+searchDocuments);
 assert.equal(validationChecks,52,'Unchanged validation context must check only new or changed members');
 t.diagnostic(JSON.stringify({records:42,snapshots:11,bodyReads:bodies,searchDocuments,elapsedMs:Math.round(performance.now()-start)}));
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const row=await store.member(await store.snapshot(),book.entries[1].id);
  await store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',store.encode('state','record-query:'+row.id+':'+row.queryRevision,{broken:true}),'record-query:'+row.id+':'+row.queryRevision);
 }));
 await assert.rejects(f.workspace.catalogue(store=>store.verify(catalogueDescriptor(book))),{code:'CATALOGUE_DAMAGED'});
});

test('verification receipts are recorded only after success and are disabled without a fixed database snapshot',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-verification-receipts-')),f=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 await f.workspace.catalogue(store=>withCatalogueVerification(store,async receipts=>{
  let calls=0;const verify=async()=>{calls++;};
  await receipts.once(['same'],verify);await receipts.once(['same'],verify);assert.equal(calls,1);
  await receipts.once(['changed'],verify);assert.equal(calls,2);
  await assert.rejects(receipts.once(['failure'],()=>{throw Error('Failed verification');}),/Failed verification/);
  await receipts.once(['failure'],verify);assert.equal(calls,3);
 }));
 await f.workspace.withLock(()=>f.workspace.catalogue(store=>withCatalogueVerification(store,async receipts=>{
  let calls=0;const verify=async()=>{calls++;};
  await receipts.once(['same'],verify);await receipts.once(['same'],verify);assert.equal(calls,2);
 })));
});

test('bounded index read-ahead reduces audit round trips without trusting a later corrupted row',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-verification-batches-')),book=sampleNotebook(),seed=book.entries[0];
 book.entries=Array.from({length:80},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Inspection '+i,body:'Independent observation '+i,relations:[],sections:[],attachments:[],figures:[],contributors:[]}));
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 async function audit(readAhead){return f.workspace.catalogue(store=>withCatalogueVerification(store,async receipts=>{
  store.readCache.readAhead=readAhead;const run=store.db.run;let queries=0;
  store.db.run=function(...args){queries++;return run.apply(this,args);};
  try{await store.verifySnapshot(await store.head(),book.id,receipts);return queries;}
  finally{store.db.run=run;}
 }));}
 const individual=await audit(false),batched=await audit(true);
 assert.ok(batched<individual*0.75,JSON.stringify({individual,batched}));
 t.diagnostic(JSON.stringify({individual,batched}));
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(),slot='record-search-index:'+snapshot.searchIndex.root.hash;
  const row=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot),payload=Buffer.from(row.payload);payload[payload.length-1]^=1;
  await store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',payload,slot);
 }));
 await assert.rejects(audit(true),{code:'ENCRYPTION_DAMAGED'});
});

test('shared immutable nodes avoid duplicate decryption but retain independent hash and bound checks',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-verification-nodes-')),f=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 await f.workspace.catalogue(store=>withCatalogueVerification(store,async()=>{
  const snapshot=await store.snapshot(),ref=snapshot.membership,slot='snapshot-index:'+ref.hash,decode=store.decode;let reads=0;
  store.decode=function(table,id,...args){if(id===slot)reads++;return decode.call(this,table,id,...args);};
  const first=new SnapshotIndex(store),second=new SnapshotIndex(store),value=await first.node(ref);
  assert.equal(await second.node(ref),value);assert.equal(reads,1);
  assert.ok(Object.isFrozen(value));assert.throws(()=>{value.id='changed';},TypeError);
  await assert.rejects(new SnapshotIndex(store).node(ref,value.id),{code:'CATALOGUE_DAMAGED'});
  const wrong=new ObjectIndex(store,{namespace:'snapshot-index:',immutable:true});wrong.cache.set('0'.repeat(64),value);
  await assert.rejects(wrong.node({...ref,hash:'0'.repeat(64)}),{code:'CATALOGUE_DAMAGED'});
 }));
});

test('incremental membership and recent audits reject unrelated corruption, forged totals and omitted edits',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-index-audit-')),f=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const before=await f.workspace.catalogue(store=>store.snapshot()),book=(await f.workspace.read()).book,current=book.entries[0],service=new ResearchRecords(f.workspace,{});
 await service.save({workspaceId:book.id,changes:[{id:current.id,expectedRevision:recordRevision(current),record:{...current,title:'Changed investigation'}}]},{recordIds:[current.id]});
 await f.workspace.catalogue(async store=>{
  const after=await store.snapshot(),index=new SnapshotIndex(store),recent=new RecordRecentIndex(store);
  assert.equal(await verifyIndexedDelta(store,before,after),true);
  await assert.rejects(verifyIndexedDelta(store,before,{...after,delta:{...after.delta,changed:[]}}),{code:'CATALOGUE_DAMAGED'});
  await assert.rejects(verifyIndexedDelta(store,before,{...after,delta:{...after.delta,changed:[randomUUID()]}}),{code:'CATALOGUE_DAMAGED'});
  await assert.rejects(verifyIndexedDelta(store,before,{...after,delta:{...after.delta,removed:[book.entries[1].id]}}),{code:'CATALOGUE_DAMAGED'});
  assert.equal(await verifyMembershipChange(store,before,after),true);
  assert.equal(await verifyDerivedRecordChange(store,recent,'recentIndex',before,after),true);
  await assert.rejects(verifyMembershipChange(store,before,{...after,count:after.count+1}),{code:'CATALOGUE_DAMAGED'});
  await assert.rejects(verifyMembershipChange(store,before,{...after,bytes:after.bytes+1}),{code:'CATALOGUE_DAMAGED'});
  const other=await store.member(after,book.entries[1].id),key='book:'+other.notebookId+':'+other.id;
  const root=await index.change(after.membership,key,'0'.repeat(64));
  await assert.rejects(verifyMembershipChange(store,before,{...after,membership:root}),{code:'CATALOGUE_DAMAGED'});
  const forged=await recent.change(after.recentIndex.root,await recent.key(other),'0'.repeat(64));
  await assert.rejects(verifyDerivedRecordChange(store,recent,'recentIndex',before,{...after,recentIndex:{...after.recentIndex,root:forged}}),{code:'CATALOGUE_DAMAGED'});
  await assert.rejects(verifyDerivedRecordChange(store,recent,'recentIndex',before,{...after,recentIndex:before.recentIndex}),{code:'CATALOGUE_DAMAGED'});
 });
});

test('incremental record verification still checks dependent runs and rechecks unchanged records when metadata changes',async t=>{
 for(const corruption of ['parent-role','metadata-ownership'])await t.test(corruption,async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-verification-dependencies-')),book=sampleNotebook();
  const parent={...structuredClone(book.entries[0]),relations:[],sections:[],type:'experiment'},child={...structuredClone(parent),id:randomUUID(),type:'run',relations:[{id:randomUUID(),type:'Run / take of',role:'run-of',target:{workspaceId:book.id,kind:'record',id:parent.id},label:parent.title}]};
  book.entries=[parent,child];const f=await encryptedFixture(directory,book);
  t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
  await f.workspace.catalogue(store=>store.verify(catalogueDescriptor(book)));
  // Write authenticated but invalid content beneath the ordinary command
  // validator, as a damaged archive might contain. All derived roots match.
  await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
   const current=(await store.read()).book;
   if(corruption==='parent-role')current.entries[0].type='run';
   else current.revision++;
   await store.put(current);
   if(corruption==='metadata-ownership'){
    const id=await store.head(),snapshot=await store.snapshot(id);
    snapshot.metadata.notebooks=snapshot.metadata.notebooks.filter(n=>n.id!==parent.notebookId);
    await store.db.run('UPDATE snapshots SET payload=$1 WHERE id=$2',store.encode('snapshot',id,snapshot),id);
   }
  }));
  await assert.rejects(f.workspace.catalogue(store=>store.verify(catalogueDescriptor(book))),{code:'CATALOGUE_DAMAGED'});
 });
});

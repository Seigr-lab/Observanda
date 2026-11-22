import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {withMetadataBatch} from '../src/metadata-batch.js';
import {CatalogueReadCache} from '../src/catalogue-read-cache.js';
import {clearVault} from '../src/encryption.js';

test('retained material membership is authenticated once per research head and follows record removal',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-material-admission-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),record=book.entries[0],materials=new ResearchMaterials(f.workspace);
 t.after(async()=>{await clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 await f.workspace.withLock(()=>f.workspace.catalogue(store=>withMetadataBatch(store,async()=>{
  const run=store.db.run;let snapshots=0;
  store.db.run=async function(sql,...args){if(sql==='SELECT payload FROM snapshots WHERE id=$1')snapshots++;return run.call(this,sql,...args);};
  await materials.assertOwner(record.id);
  for(let i=0;i<8;i++)await materials.assertOwner(record.id,{write:true});
  assert.equal(snapshots,1,'Membership is authenticated once for the same research head');
  store.db.run=run;
 })));
 await f.workspace.withLock(()=>f.workspace.catalogue(store=>withMetadataBatch(store,async()=>{
  await materials.assertOwner(record.id,{write:true});
  const head=await store.head(),current=await store.snapshot(head);
  await store.commitChanges(head,current,current.metadata,[],{removed:[record.id]});
  await assert.rejects(materials.assertOwner(record.id,{write:true}),{code:'MATERIAL_INVALID'});
 })));
});

test('identity proof receipts stay bounded and are discarded with their cache',async()=>{
 const cache=new CatalogueReadCache();
 for(let i=0;i<500;i++)assert.equal(await cache.proof(String(i),async()=>String(i)),String(i));
 assert.equal(cache.proofs.size,128);
 await assert.rejects(cache.proof('large',async()=>'x'.repeat(1025)),RangeError);
 await assert.rejects(cache.proof('document',async()=>({body:'not an identity'})),RangeError);
 cache.clear();assert.equal(cache.proofs.size,0);
});

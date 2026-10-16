import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ProjectSourceAuthority} from '../src/project-source-authority.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {withMetadataBatch} from '../src/metadata-batch.js';
import {CatalogueReadCache} from '../src/catalogue-read-cache.js';
import {clearVault} from '../src/encryption.js';

test('retained material membership never bypasses live project handover or scope ownership',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-material-admission-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),record=book.entries[0],notebook=book.notebooks.find(item=>item.id===record.notebookId),materials=new ResearchMaterials(f.workspace);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 await f.workspace.withLock(()=>f.workspace.catalogue(store=>withMetadataBatch(store,async()=>{
  await assert.rejects(new ProjectSourceAuthority(store).notebook(notebook.id,{notebooks:[{id:notebook.id,projectId:''}]}),{code:'INVALID'});
  const run=store.db.run;let snapshots=0;
  store.db.run=async function(sql,...args){if(sql==='SELECT payload FROM snapshots WHERE id=$1')snapshots++;return run.call(this,sql,...args);};
  await materials.assertOwner(record.id);
  for(let i=0;i<8;i++)await materials.assertOwner(record.id,{write:true});
  assert.equal(snapshots,1,'Membership is authenticated once for the same research head');
  const receipt={version:1,operationId:randomUUID(),projectId:notebook.projectId,sourceNamespace:book.id,namespaceId:randomUUID(),vaultId:randomUUID(),sourceHead:await store.head()},slot='project-source-authority:project:'+notebook.projectId;
  await store.db.run('INSERT INTO state VALUES ($1,$2)',slot,store.encode('state',slot,receipt));
  await assert.rejects(materials.assertOwner(record.id,{write:true}),{code:'PROJECT_RELOCATED'});
  await materials.assertOwner(record.id);
  await store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',store.encode('state',slot,{...receipt,projectId:randomUUID()}),slot);
  await assert.rejects(materials.assertOwner(record.id,{write:true}),{code:'CATALOGUE_DAMAGED'});
  await store.db.run('DELETE FROM state WHERE slot=$1',slot);
  const former=randomUUID(),oldSlot='project-source-authority:project:'+former,scopeSlot='project-source-authority:notebook:'+notebook.id;
  await store.db.run('INSERT INTO state VALUES ($1,$2)',oldSlot,store.encode('state',oldSlot,{...receipt,projectId:former}));
  await store.db.run('INSERT INTO state VALUES ($1,$2)',scopeSlot,store.encode('state',scopeSlot,{version:1,notebookId:notebook.id,projectId:former}));
  await assert.rejects(materials.assertOwner(record.id,{write:true}),{code:'PROJECT_RELOCATED'});
  await store.db.run('DELETE FROM state WHERE slot=ANY($1::text[])',[oldSlot,scopeSlot]);
  store.db.run=run;
 })));
 await f.workspace.withLock(()=>f.workspace.catalogue(store=>withMetadataBatch(store,async()=>{
  await materials.assertOwner(record.id,{write:true});
  const head=await store.head(),current=await store.indexed(await store.snapshot(head));
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

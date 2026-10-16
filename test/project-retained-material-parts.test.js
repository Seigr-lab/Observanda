import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './project-domain-fixture.js';
import {digest,serialize} from '../src/storage-format.js';
import {retainedMetadataValue,retainedMetadataSlot} from '../src/project-retired-metadata.js';
import {materialPartKey} from '../src/material-part-identity.js';
const hash=value=>digest(serialize(value));
test('immutable retained material reads use the owned content without duplicating payloads and reject changed or mutable fallback values',async t=>{
 const f=await fixture(t),value={text:JSON.stringify([[1,2],[3,4]])},revision=hash(value),id='metadata:.observanda/materials/tables/'+digest(value.text)+'.json';
 await f.storage.withLock(()=>f.storage.catalogue(store=>store.putObject(id,value)));
 await f.storage.catalogue(async store=>{
  assert.deepEqual(await retainedMetadataValue(store,revision,{id}),value);assert.equal(await store.db.get('SELECT payload FROM state WHERE slot=$1',retainedMetadataSlot(revision)),undefined);
  await assert.rejects(retainedMetadataValue(store,hash({text:'changed'}),{id}),{code:'CATALOGUE_DAMAGED'});
  await assert.rejects(retainedMetadataValue(store,revision,{id:id.replace('/tables/','/unknown/')}),{code:'CATALOGUE_DAMAGED'});
  await assert.rejects(retainedMetadataValue(store,revision,{id:id.replace(digest(value.text),'0'.repeat(64))}),{code:'CATALOGUE_DAMAGED'});
  await assert.rejects(retainedMetadataValue(store,revision),{code:'CATALOGUE_DAMAGED'});
 });
 await f.storage.withLock(()=>f.storage.catalogue(store=>store.db.run('INSERT INTO state VALUES ($1,$2)',retainedMetadataSlot(revision),store.encode('state',retainedMetadataSlot(revision),{text:'damaged'}))));
 await assert.rejects(f.storage.catalogue(store=>retainedMetadataValue(store,revision,{id})),{code:'CATALOGUE_DAMAGED'});
 assert.equal(materialPartKey(id),true);assert.equal(materialPartKey('metadata:.observanda/materials/objects/'+digest(value.text)+'.json'),false);assert.equal(materialPartKey(null),false);
});

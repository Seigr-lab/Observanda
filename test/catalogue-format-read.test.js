import {test} from 'node:test';
import assert from 'node:assert/strict';
import {catalogueFormat} from '../src/catalogue-format.js';
import {withCatalogueFormatRead} from '../src/catalogue-format-read.js';
import {withCatalogueCacheBoundary} from '../src/catalogue-context.js';
const fixture=()=>{
 let version=3,reads=0;const sql=[];
 return {db:{schema:'synthetic_catalogue',async all(query){reads++;sql.push(query);return [{version}];}},get reads(){return reads;},sql,set(value){version=value;}};
};
test('format scalar is reused only inside the exact active immutable transaction',async()=>{
 const f=fixture();let escaped;const gate=Promise.withResolvers();
 await withCatalogueFormatRead(f.db,async()=>{
  assert.deepEqual(await Promise.all(Array.from({length:40},()=>catalogueFormat(f.db))),Array(40).fill(3));assert.equal(f.reads,1);
  assert.equal(f.sql[0],'SELECT version FROM "synthetic_catalogue".catalogue_format');
  const other=fixture();other.set(4);assert.equal(await catalogueFormat(other.db),4);assert.equal(await catalogueFormat(other.db),4);assert.equal(other.reads,2);
  escaped=gate.promise.then(()=>catalogueFormat(f.db));
 });
 f.set(4);gate.resolve();assert.equal(await escaped,4);assert.equal(f.reads,2);
 await withCatalogueFormatRead(f.db,async()=>assert.equal(await catalogueFormat(f.db),4));assert.equal(f.reads,3);
 f.set(5);assert.equal(await catalogueFormat(f.db),5);f.set(6);assert.equal(await catalogueFormat(f.db),6);assert.equal(f.reads,5);
});
test('format reads reject damaged generations and invalidate at explicit transaction boundaries',async()=>{
 const f=fixture();
 await withCatalogueFormatRead(f.db,async()=>{
  f.set('broken');await assert.rejects(catalogueFormat(f.db),{code:'CATALOGUE_DAMAGED'});
  f.set(3);assert.equal(await catalogueFormat(f.db),3);assert.equal(f.reads,2);
  await withCatalogueCacheBoundary({db:f.db},async()=>{f.set(4);assert.equal(await catalogueFormat(f.db),4);f.set(5);assert.equal(await catalogueFormat(f.db),5);});
  assert.equal(await catalogueFormat(f.db),5);assert.equal(await catalogueFormat(f.db),5);assert.equal(f.reads,5);
  f.db.schema='another_catalogue';f.set(6);assert.equal(await catalogueFormat(f.db),6);assert.equal(f.reads,6);
 });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {catalogueFormat,configurationCatalogueFeatures,requirePublicationOperations,requireWebsitePresentation,requireStagedEvidence,CATALOGUE_MAX_GENERATION} from '../src/catalogue-format.js';
import {backgroundWriterWait} from '../src/writer-wait.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-feature-writers-')),value=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{clearVault(value.vault);await rm(directory,{recursive:true,force:true});});return value.workspace;
}

test('a website feature upgrade does not block behind an existing catalogue reader',async t=>{
 const workspace=await fixture(t);
 await workspace.withLock(()=>workspace.catalogue(store=>requirePublicationOperations(store.db)));
 const before=await workspace.catalogue(store=>catalogueFormat(store.db));assert.ok(configurationCatalogueFeatures(before).website<3);
 const reader=await workspace.openCatalogue(),writer=await workspace.openCatalogue();
 try{
  await reader.run('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.equal(await catalogueFormat(reader),before);
  await writer.run('BEGIN');await writer.run("SET LOCAL lock_timeout='250ms'");
  await requireWebsitePresentation(writer);await writer.run('COMMIT');
  assert.equal(await catalogueFormat(reader),before,'the retained reader keeps its original snapshot');
  const after=configurationCatalogueFeatures(await catalogueFormat(writer));assert.equal(after.website,3);assert.equal(after.publicationOperations,true);
 }finally{await reader.close();await writer.close();}
});

test('competing website and evidence feature updates preserve their complete union',async t=>{
 const workspace=await fixture(t);await workspace.withLock(()=>workspace.catalogue(store=>requirePublicationOperations(store.db)));
 const first=await workspace.openCatalogue(),second=await workspace.openCatalogue();let waiting;
 const attempted=new Promise(resolve=>waiting=resolve),all=second.all.bind(second);
 try{
  await first.run('BEGIN');await requireWebsitePresentation(first);
  await second.run('BEGIN');second.all=async(sql,...args)=>{try{return await all(sql,...args);}catch(error){if(sql.includes('FOR UPDATE')&&error.code==='55P03')waiting();throw error;}};
  const update=backgroundWriterWait(()=>requireStagedEvidence(second),{signal:new AbortController().signal,check:async()=>{}});
  await attempted;await first.run('COMMIT');await update;await second.run('COMMIT');
  const flags=configurationCatalogueFeatures(await catalogueFormat(second));assert.equal(flags.website,3);assert.equal(flags.staged,true);assert.equal(flags.publicationOperations,true);
 }finally{await first.close();await second.close();}
});

test('a genuine format bound extension upgrades the column and still rejects unknown generations',async t=>{
 const workspace=await fixture(t),db=await workspace.openCatalogue();
 try{
  const previous=await catalogueFormat(db);assert.ok(previous<2147483647);
  await db.run('ALTER TABLE catalogue_format DROP CONSTRAINT catalogue_format_version_check');
  await db.run('ALTER TABLE catalogue_format ALTER COLUMN version TYPE integer');
  await db.run('ALTER TABLE catalogue_format ADD CONSTRAINT catalogue_format_version_check CHECK(version BETWEEN 3 AND '+previous+')');
  await db.run('BEGIN');await requirePublicationOperations(db);await db.run('COMMIT');
  assert.equal((await db.get('SELECT pg_typeof(version)::text AS type FROM catalogue_format')).type,'bigint');assert.equal(configurationCatalogueFeatures(await catalogueFormat(db)).publicationOperations,true);
  await assert.rejects(db.run('UPDATE catalogue_format SET version=$1',CATALOGUE_MAX_GENERATION+1),{code:'23514'});
 }finally{await db.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {archiveDatabaseFixture} from './archive-database-fixture.js';
import {writeCatalogueArchive,readCatalogueArchive} from '../src/postgres-archive.js';
import {catalogueArchiveTables} from '../src/postgres-archive-tables.js';
import {CATALOGUE_EXTENSION_FEATURES} from '../src/catalogue-extensions.js';
import {CATALOGUE_MAX_GENERATION,CATALOGUE_EXTENDED_GENERATION,catalogueFormat,configurationCatalogueFeatures,configurationCatalogueGeneration,restoreConfigurationCatalogueFormat,restoreRecordOwnerTransferCatalogueFormat,restorePublicationCatalogueFormat,recordOwnerTransferCatalogueFeatures,publicationCatalogueFeatures,requireCatalogueExtension,catalogueRequiresExtension,catalogueGenerationExtended,catalogueFeatureText,parseCatalogueFeatureText,sameCatalogueGeneration,requireMemberRuns,requireStagedEvidence,catalogueRequiresMemberRuns} from '../src/catalogue-format.js';

// The maximum of every packed generation the product has written, from git
// history: legacy bounds first, then one per added configuration feature.
const HISTORICAL_MAXIMA=[313,505,889,1657,3193,6265,12409,24697,49273,196729,393337,786553,1572985,3145849,6291577,12583033,25165945,50331769,100663417,201326713,402653305,805306489,1610612857,3221225593,6442451065,12884902009,25769803897,51539607673,103079215225,206158430329,412316860537,824633720953,1649267441785,3298534883449,6597069766777,13194139533433,26388279066745,52776558133369,105553116266617,211106232533113,422212465066105,844424930132089,3377699720527993,6755399441055865];
const FUTURE='syntheticFutureFeature';
// Admit a feature name only for the duration of one test.
async function withFutureFeature(operation){CATALOGUE_EXTENSION_FEATURES.push(FUTURE);try{return await operation();}finally{CATALOGUE_EXTENSION_FEATURES.splice(CATALOGUE_EXTENSION_FEATURES.indexOf(FUTURE),1);}}
// A catalogue_format row with the optional feature column, as PostgreSQL returns int8 text.
function formatRow(version=122,features=null){
 const state={version,features};
 const db={state,
  all:async sql=>{if(sql==='SELECT version FROM catalogue_format'||sql.endsWith('FOR UPDATE NOWAIT'))return [{version:String(state.version)}];if(sql==='SELECT features FROM catalogue_format')return [{features:state.features}];throw new Error('Unexpected query '+sql);},
  get:async()=>null,
  run:async(sql,...values)=>{if(sql.startsWith('UPDATE catalogue_format SET version=$1,features=$2')){state.version=values[0];state.features=values[1];}else if(sql.startsWith('UPDATE catalogue_format')){if(state.features!==null)throw new Error('A packed update reached an extended row');state.version=values[0];}}};
 return db;
}

test('every historical generation decodes, re-encodes and restores exactly',async()=>{
 let previous=0;
 for(const maximum of HISTORICAL_MAXIMA){
  const features=configurationCatalogueFeatures(maximum);assert.ok(features,String(maximum));assert.equal(configurationCatalogueGeneration(features),maximum);assert.equal(features.website,3);assert.equal(features.owners,2);
  for(const [key,value] of Object.entries(features))if(!['website','owners'].includes(key))assert.equal(value,true,key+' at '+maximum);
  assert.ok(Object.keys(features).length>previous,'each maximum adds a feature');previous=Object.keys(features).length;
  const db=formatRow();await restoreConfigurationCatalogueFormat(db,maximum);assert.equal(db.state.version,maximum);assert.equal(db.state.features,null);assert.equal(await catalogueFormat(db),maximum);
 }
 const all=configurationCatalogueFeatures(CATALOGUE_MAX_GENERATION),flags=Object.keys(all).filter(key=>!['website','owners','staged','publication','transfers'].includes(key)),plain={website:0,staged:false,owners:0,publication:false,transfers:false},owned={website:2,staged:true,owners:1,publication:true,transfers:true};
 for(let i=0;i<flags.length;i++)for(let j=i;j<flags.length;j++)for(const base of [plain,owned]){const features={...base,[flags[i]]:true,[flags[j]]:true},format=configurationCatalogueGeneration(features);assert.equal(typeof format,'number');assert.deepEqual(configurationCatalogueFeatures(format),features);}
 for(let format=3;format<=121;format++){
  assert.equal(await catalogueFormat(formatRow(format)),format);if(format<50)continue;
  const db=formatRow(3);if(format>=74){assert.ok(recordOwnerTransferCatalogueFeatures(format));await restoreRecordOwnerTransferCatalogueFormat(db,format);}else{assert.ok(publicationCatalogueFeatures(format));await restorePublicationCatalogueFormat(db,format);}assert.equal(db.state.version,format);
 }
 for(const above of [CATALOGUE_MAX_GENERATION+1,CATALOGUE_MAX_GENERATION+122,CATALOGUE_MAX_GENERATION*2])assert.equal(configurationCatalogueFeatures(above),null,'the packed decoder refuses everything above its maximum');
 await assert.rejects(catalogueFormat(formatRow(CATALOGUE_EXTENDED_GENERATION+1)),{code:'CATALOGUE_NEWER'});
});

test('older readers meet only the sentinel above every released maximum',async()=>{
 assert.equal(CATALOGUE_EXTENDED_GENERATION,HISTORICAL_MAXIMA.at(-1)+1);assert.ok(Number.isSafeInteger(CATALOGUE_EXTENDED_GENERATION));assert.match(String(CATALOGUE_EXTENDED_GENERATION),/^[1-9][0-9]{0,15}$/);
 for(const maximum of HISTORICAL_MAXIMA)assert.ok(CATALOGUE_EXTENDED_GENERATION>maximum);
 // Released apps read only the version column and decode it with the packed
 // decoder, which returns nothing for the sentinel; their open then refuses.
 assert.equal(configurationCatalogueFeatures(CATALOGUE_EXTENDED_GENERATION),null);assert.equal(recordOwnerTransferCatalogueFeatures(CATALOGUE_EXTENDED_GENERATION),null);assert.equal(publicationCatalogueFeatures(CATALOGUE_EXTENDED_GENERATION),null);
 await withFutureFeature(async()=>{
  const db=formatRow(HISTORICAL_MAXIMA.at(-1));await requireCatalogueExtension(db,FUTURE);
  const versionOnly={all:async sql=>{if(sql!=='SELECT version FROM catalogue_format')throw new Error('An older reader issues only the version query');return [{version:String(db.state.version)}];}};
  assert.equal((await versionOnly.all('SELECT version FROM catalogue_format'))[0].version,String(CATALOGUE_EXTENDED_GENERATION));
  assert.equal(configurationCatalogueFeatures(Number((await versionOnly.all('SELECT version FROM catalogue_format'))[0].version)),null);
 });
});

test('a future feature is encoded beside the packed base and every existing writer keeps it',async()=>{
 const base=configurationCatalogueGeneration({website:1,staged:false,owners:1,publication:true,transfers:true,retainedFigures:true});
 assert.throws(()=>parseCatalogueFeatureText(base+';'+FUTURE),{code:'CATALOGUE_NEWER'});
 await withFutureFeature(async()=>{
  const db=formatRow(base);await requireCatalogueExtension(db,FUTURE);
  assert.equal(db.state.version,CATALOGUE_EXTENDED_GENERATION);assert.equal(db.state.features,base+';'+FUTURE);
  const format=await catalogueFormat(db);assert.ok(catalogueGenerationExtended(format));assert.equal(format.base,base);assert.equal(JSON.stringify({format}),'{"format":'+CATALOGUE_EXTENDED_GENERATION+'}');
  assert.deepEqual(configurationCatalogueFeatures(format),{...configurationCatalogueFeatures(base),[FUTURE]:true});assert.equal(catalogueRequiresExtension(format,FUTURE),true);
  assert.ok(format>=49&&!(format<23),'linear generation checks still hold');
  // Existing packed writers add their flags and keep the extension.
  await requireMemberRuns(db);await requireStagedEvidence(db);
  const after=await catalogueFormat(db),features=configurationCatalogueFeatures(after);assert.equal(features[FUTURE],true);assert.equal(features.memberRuns,true);assert.equal(features.staged,true);assert.equal(features.website,1);assert.equal(catalogueRequiresMemberRuns(after),true);
  const before=db.state.features;await requireCatalogueExtension(db,FUTURE);await requireMemberRuns(db);assert.equal(db.state.features,before,'repeated requirements write nothing');
  // Restore and copy replay the packed base, then the extension.
  const restored=formatRow(3);await restoreConfigurationCatalogueFormat(restored,after);assert.equal(restored.state.features,db.state.features);assert.ok(sameCatalogueGeneration(await catalogueFormat(restored),after));
  assert.ok(sameCatalogueGeneration(configurationCatalogueGeneration(features),after));
  for(const damaged of [null,'',base+';',base+';'+FUTURE+','+FUTURE,base+';memberRuns',base+';zz,'+FUTURE,'121;'+FUTURE,'0'+base+';'+FUTURE,CATALOGUE_MAX_GENERATION+1+';'+FUTURE]){db.state.features=damaged;await assert.rejects(catalogueFormat(db),{code:'CATALOGUE_DAMAGED'},String(damaged));}
 });
 const stored=formatRow(CATALOGUE_EXTENDED_GENERATION,base+';'+FUTURE);await assert.rejects(catalogueFormat(stored),{code:'CATALOGUE_NEWER'},'an app that lacks the feature names it as newer');
});

test('a catalogue with a future feature is stored, guarded and archived by PostgreSQL',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-extended-format-')),f=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{await clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 await withFutureFeature(async()=>{
  const db=await f.workspace.openCatalogue();
  try{
   const before=await catalogueFormat(db);assert.equal(typeof before,'number');
   await db.run('BEGIN');await requireCatalogueExtension(db,FUTURE);await db.run('COMMIT');
   const format=await catalogueFormat(db);assert.ok(catalogueGenerationExtended(format));assert.equal(configurationCatalogueFeatures(format)[FUTURE],true);
   for(const [key,value] of Object.entries(configurationCatalogueFeatures(before)??{}))assert.deepEqual(configurationCatalogueFeatures(format)[key],value,key);
   const row=await db.get('SELECT version::text AS version,features,pg_typeof(version)::text AS type FROM catalogue_format');assert.equal(row.version,String(CATALOGUE_EXTENDED_GENERATION));assert.equal(row.features,catalogueFeatureText(format));assert.equal(row.type,'bigint');
   await db.run('BEGIN');await requireMemberRuns(db);await db.run('COMMIT');assert.equal(configurationCatalogueFeatures(await catalogueFormat(db))[FUTURE],true);
   for(const sql of ['UPDATE catalogue_format SET features=NULL','UPDATE catalogue_format SET version=$1']){await db.run('BEGIN');try{await assert.rejects(sql.includes('$1')?db.run(sql,CATALOGUE_MAX_GENERATION):db.run(sql),{code:'23514'});}finally{await db.run('ROLLBACK');}}
   await db.run('BEGIN');try{await assert.rejects(db.run('UPDATE catalogue_format SET version=$1',CATALOGUE_EXTENDED_GENERATION+1),{code:'23514'});}finally{await db.run('ROLLBACK');}
   // A portable backup carries the feature text in a header version older apps refuse.
   const parts=[];await db.run('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{await writeCatalogueArchive(db,{writeFile:async value=>{parts.push(value);}},catalogueArchiveTables,{observe:false});}finally{await db.run('COMMIT');}
   const archive=parts.join(''),header=JSON.parse(archive.slice(0,archive.indexOf('\n')));assert.equal(header.version,16);assert.equal(header.catalogueVersion,CATALOGUE_EXTENDED_GENERATION);assert.equal(header.catalogueFeatures,catalogueFeatureText(await catalogueFormat(db)));
   const file=path.join(directory,'archive');await writeFile(file,archive);
   const target=archiveDatabaseFixture(formatRow(3));target.get=async sql=>sql.includes("slot='head'")?{present:1}:null;const run=target.run;target.run=async(sql,...values)=>sql.startsWith('INSERT INTO ')||sql.startsWith('CREATE ')?undefined:run(sql,...values);
   await readCatalogueArchive(file,target,catalogueArchiveTables);assert.equal(target.state.version,CATALOGUE_EXTENDED_GENERATION);assert.equal(target.state.features,catalogueFeatureText(await catalogueFormat(db)));
  }finally{await db.close();}
 });
});

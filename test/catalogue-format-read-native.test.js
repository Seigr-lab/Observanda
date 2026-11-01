import {test} from 'node:test';
import assert from 'node:assert/strict';
import {intakeFixture} from './fixtures/local-intake.js';
import {catalogueFormat,requirePagedResearchTables,requireNativeNumericalModels} from '../src/catalogue-format.js';

test('native format admission shares one validated generation per read snapshot and leaves writers fresh',async t=>{
 const {ws}=await intakeFixture(t),open=ws.openCatalogue.bind(ws);let reads=0,measuring=false;
 ws.openCatalogue=async options=>{const db=await open(options),all=db.all.bind(db);db.all=async(sql,...values)=>{if(measuring&&sql.startsWith('SELECT version FROM '))reads++;return all(sql,...values);};return db;};
 await ws.withCatalogueConnections(async()=>{
  for(let snapshot=0;snapshot<2;snapshot++)await ws.catalogue(async store=>{
   const before=reads;measuring=true;
   try{const generation=await catalogueFormat(store.db);for(let i=0;i<40;i++)assert.equal(await catalogueFormat(store.db),generation);}
   finally{measuring=false;}
   assert.equal(reads-before,1,'Each newly acquired snapshot authenticates its generation once');
  });
  await ws.withLock(()=>ws.catalogue(async store=>{
   const before=reads;measuring=true;
   try{const generation=await catalogueFormat(store.db);for(let i=0;i<3;i++)assert.equal(await catalogueFormat(store.db),generation);}
   finally{measuring=false;}
   assert.equal(reads-before,4,'Writer format checks remain current across feature admission');
   await requirePagedResearchTables(store.db);await requireNativeNumericalModels(store.db);
   const admitted=reads;measuring=true;
   try{for(let i=0;i<40;i++){await requirePagedResearchTables(store.db);await requireNativeNumericalModels(store.db);}}
   finally{measuring=false;}
   assert.equal(reads-admitted,80,'Every writer admission stays fresh without a redundant parent-generation read');
  }));
 });
});

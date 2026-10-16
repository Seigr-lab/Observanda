import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {withCatalogueVerification} from '../src/catalogue-verification.js';
import {withWorkspaceMetadataBatch} from '../src/metadata-batch.js';
import {verifySampleAnalysisCatalogue} from '../src/sample-analysis-catalogue.js';
import {withOperationProgress,operationStage} from '../src/operation-progress.js';
import {digest,serialize} from '../src/storage-format.js';

test('metadata audit batches all payloads with bounded transport; analysis checks only its own originals',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-object-audit-')),f=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 await f.workspace.withLock(()=>withWorkspaceMetadataBatch(f.workspace,()=>f.workspace.catalogue(async store=>{
  for(let i=0;i<161;i++)await store.putObject('unrelated/'+i,{value:'Small retained value '+i});
  await store.putObject('unrelated/large',{value:'Oversized for a batch. '.repeat(20000)});
  for(const id of ['unrelated/\uffff','unrelated/\ud83d\udd2c'])await store.putObject(id,{value:id});
  await store.putObject('laboratory',{formatVersion:1,revision:0,samples:[],analyses:[],events:[]});
 })));
 const audit=async batched=>f.workspace.catalogue(store=>withCatalogueVerification(store,async()=>{
  let queries=0,peakBatchBytes=0;const run=store.db.run,all=store.db.all,result=[];
  store.db.run=function(...args){queries++;return run.apply(this,args);};
  store.db.all=async function(...args){const rows=await all.apply(this,args);if(args[0].includes('octet_length(payload)'))peakBatchBytes=Math.max(peakBatchBytes,rows.reduce((sum,row)=>sum+(row.payload?.length??0),0));return rows;};
  try{
   if(batched){for await(const {id,value} of store.verifiedObjects())result.push([id,digest(serialize(value))]);}
   else{const index=store.objectIndex(),head=await index.head();await index.checkCounts(head);for await(const entry of index.entries(head))result.push([entry.id,digest(serialize(await store.objectValue(entry.id,entry)))]);}
   return {queries,peakBatchBytes,result};
  }finally{store.db.run=run;store.db.all=all;}
 }));
 const before=await audit(false),events=[];let after;
 await withOperationProgress(value=>events.push(value),()=>operationStage('verify-objects',{},async()=>{after=await audit(true);}));
 assert.deepEqual(after.result,before.result);assert.ok(after.queries<before.queries/2,JSON.stringify({before:before.queries,after:after.queries}));
 assert.ok(after.peakBatchBytes<=32*16384);const final=events.findLast(value=>value.stage==='verify-objects');assert.equal(final.completed,after.result.length);assert.equal(final.total,after.result.length);
 t.diagnostic(JSON.stringify({objects:after.result.length,queriesBefore:before.queries,queriesAfter:after.queries,peakBatchBytes:after.peakBatchBytes}));
 await f.workspace.catalogue(async store=>{
  const decode=store.decode;let other=0;
  store.decode=function(table,id,...args){if(table==='object'&&id.startsWith('unrelated/'))other++;return decode.call(this,table,id,...args);};
  await verifySampleAnalysisCatalogue(store);assert.equal(other,0);
 });
 // A later audit must still reject an unrelated payload corruption. Analysis
 // has no authority to accept that payload on behalf of the metadata owner.
 const id='unrelated/80';let saved;
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{saved=(await store.db.get('SELECT payload FROM objects WHERE id=$1',id)).payload;const damaged=Buffer.from(saved);damaged[damaged.length-1]^=1;await store.db.run('UPDATE objects SET payload=$1 WHERE id=$2',damaged,id);}));
 await assert.rejects(audit(true),{code:'ENCRYPTION_DAMAGED'});
 await f.workspace.withLock(()=>f.workspace.catalogue(store=>store.db.run('UPDATE objects SET payload=$1 WHERE id=$2',saved,id)));
 // Missing and unindexed originals remain integrity failures.
 await f.workspace.withLock(()=>f.workspace.catalogue(store=>store.db.run('DELETE FROM objects WHERE id=$1',id)));
 await assert.rejects(audit(true),{code:'CATALOGUE_DAMAGED'});
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{await store.db.run('INSERT INTO objects VALUES ($1,$2)',id,saved);await store.db.run('INSERT INTO objects VALUES ($1,$2)','unindexed',store.encode('object','unindexed',{}));}));
 await assert.rejects(audit(true),{code:'CATALOGUE_DAMAGED'});
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{await store.db.run('DELETE FROM objects WHERE id=$1','unindexed');await store.db.run('INSERT INTO state VALUES ($1,$2)','object-index:unindexed',Buffer.from('unindexed node'));}));
 await assert.rejects(audit(true),{code:'CATALOGUE_DAMAGED'});
});

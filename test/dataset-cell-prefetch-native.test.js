import {test} from 'node:test';
import assert from 'node:assert/strict';
import {intakeFixture} from './fixtures/local-intake.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {withDatasetPreparationWrites} from '../src/dataset-preparation-writes.js';
import {projectDatasetRows} from '../src/dataset-storage.js';

test('cell projection shares bounded authenticated paths without changing oversized cells or snapshot isolation',{timeout:60000},async t=>{
 const {ws}=await intakeFixture(t),materials=new ResearchMaterials(ws),rows=[],doc={content:{datasetFormat:3,schemaIndex:{count:2}}};
 await withDatasetPreparationWrites(materials,{writePage:operation=>ws.withLock(operation)},async staged=>{
  for(let row=0;row<256;row++){
   const cells=staged.sequences.builder('cells',operation=>operation());
   await cells.append({kind:'string',value:row===35?'x'.repeat(10000):String(row),pointer:'/'+row+'/0'});
   await cells.append({kind:'string',value:'retained-'+row,pointer:'/'+row+'/1'});
   rows.push({order:row+1,excluded:null,cellIndex:await cells.finish()});
  }
 });
 const open=ws.openCatalogue.bind(ws);let batches=0,points=0;
 ws.openCatalogue=async options=>{const db=await open(options),all=db.all.bind(db),get=db.get.bind(db);
  db.all=async(sql,...values)=>{if(sql.startsWith('SELECT slot,payload FROM state WHERE slot=ANY')||sql.startsWith('SELECT id,payload FROM objects WHERE id=ANY')){batches++;assert.ok(values[0].length<=32);}return all(sql,...values);};
  db.get=async(sql,...values)=>{if(sql==='SELECT payload FROM state WHERE slot=$1'||sql==='SELECT payload FROM objects WHERE id=$1')points++;return get(sql,...values);};return db;
 };
 const measure=async width=>{
  batches=0;points=0;const result=[];
  for(let offset=0;offset<rows.length;offset+=64)await ws.catalogue(async store=>{
   const page=rows.slice(offset,offset+64);
   for(let at=0;at<page.length;at+=width)result.push(...(await projectDatasetRows(materials,doc,page.slice(at,at+width))).rows);
   assert.ok(store.readCache.rows.size<=128);assert.ok(store.readCache.nodes.size<=128);
   assert.ok(store.readCache.bytes<=256*1024);assert.ok(store.readCache.nodeBytes<=256*1024);
  });
  return {result,batches,points,reads:batches+points};
 };
 const prior=await measure(16),current=await measure(64);
 assert.deepEqual(current.result,prior.result);assert.equal(current.result[35].cells[0],'x'.repeat(10000));
 assert.equal(current.result[255].cellPointers[1],'/255/1');
 assert.ok(current.reads<prior.reads*.9,'larger bounded row batches must reduce physical branch reads');
 t.diagnostic(JSON.stringify({rows:rows.length,priorReads:prior.reads,currentReads:current.reads,priorBatches:prior.batches,currentBatches:current.batches}));
 const entry=await materials.sequences.tree().find({root:rows[0].cellIndex.root},'chunk:0000000000000000'),id='metadata:.observanda/materials/sequences/chunks/'+entry.revision+'.json';
 await ws.catalogue(async()=>{
  const original=await projectDatasetRows(materials,doc,rows.slice(0,32));
  await ws.withLock(()=>ws.catalogue(store=>store.db.run('UPDATE objects SET payload=$2 WHERE id=$1',id,Buffer.from('damaged ciphertext'))));
  assert.deepEqual(await projectDatasetRows(materials,doc,rows.slice(0,32)),original,'the active snapshot keeps its exact authenticated source');
 });
 await assert.rejects(ws.catalogue(()=>projectDatasetRows(materials,doc,rows.slice(0,32))),{code:'ENCRYPTION_DAMAGED'});
 await assert.rejects(materials.sequences.prefetchCellPages(Array(33).fill(rows[0].cellIndex),0),{code:'INVALID'});
});

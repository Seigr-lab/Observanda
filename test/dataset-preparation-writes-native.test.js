import {test} from 'node:test';
import assert from 'node:assert/strict';
import {intakeFixture} from './fixtures/local-intake.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {withDatasetPreparationWrites} from '../src/dataset-preparation-writes.js';

test('dataset checkpoints retain bounded prefetches and promptly roll back cancellation within a larger group',async t=>{
 const {ws}=await intakeFixture(t),materials=new ResearchMaterials(ws),open=ws.openCatalogue.bind(ws);let checkpoints=0,prefetches=0;
 ws.openCatalogue=async options=>{const db=await open(options),all=db.all.bind(db);db.all=async(sql,...values)=>{
  if(sql.startsWith('SELECT id,CASE WHEN octet_length(payload)<=8192')){prefetches++;assert.ok(values[0].length<=32);}
  return all(sql,...values);
 };return db;};
 const writePage=operation=>{checkpoints++;return ws.withLock(operation);};
 let retained;
 await withDatasetPreparationWrites(materials,{writePage},async staged=>{
  for(let row=0;row<64;row++){
   const builder=staged.sequences.builder('cells',operation=>operation());
   for(let column=0;column<4;column++)await builder.append({kind:'string',value:String(column),pointer:'/'+row+'/'+column});
   retained=await builder.finish();
  }
 });
 assert.equal(checkpoints,1,'One checkpoint shares authenticated branches across four bounded prefetch groups');
 assert.equal(prefetches,4);assert.equal((await materials.sequences.item(retained,3)).pointer,'/63/3');
 const before=await ws.catalogue(store=>store.objectIndex().head()),controller=new AbortController(),write=ws.writeMetadata.bind(ws);let writes=0;
 ws.writeMetadata=async(...args)=>{const result=await write(...args);if(++writes===10)controller.abort();return result;};
 try{await assert.rejects(withDatasetPreparationWrites(materials,{writePage,signal:controller.signal},async staged=>{
  for(let row=0;row<128;row++)await staged.sequences.put('chunks',{kind:'cells',offset:0,items:[{kind:'string',value:'cancelled-'+row}]});
 }),{name:'AbortError'});}finally{ws.writeMetadata=write;}
 assert.equal(writes,10,'Cancellation does not finish the remaining entries');
 assert.deepEqual(await ws.catalogue(store=>store.objectIndex().head()),before,'The interrupted checkpoint publishes no partial root');
});

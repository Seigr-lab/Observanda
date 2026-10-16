import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readDataset,datasetMapping} from '../src/dataset-reader.js';
import {packedMapping,packedSource} from './fixtures/packed-dataset.js';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {clearVault} from '../src/encryption.js';
import {createFigure} from '../src/web/figure-model.js';
import {defaultColumn} from '../src/web/dataset-schema.js';

async function* chunks(source){const bytes=Buffer.from(typeof source==='string'?source:JSON.stringify(source));for(let i=0;i<bytes.length;i+=103)yield bytes.subarray(i,i+103);}
const collect=async(source,mapping)=>{const rows=[];for await(const row of readDataset(chunks(source),mapping))rows.push(row);return rows;};

test('two 3888-acquisition runs extract six timing values from offset 384 with exact physical provenance',async()=>{
 const source=packedSource(),mapping=packedMapping();source.runs[0].packed[608]='EXACT';source.runs[0].packed[609]='SMALL';
 const rows=await collect(JSON.stringify(source).replace('"EXACT"','9007199254740993123456789').replace('"SMALL"','1.2300e-12'),mapping);
 assert.equal(rows.length,7777);assert.deepEqual(rows[0].sourceMapping,mapping);
 assert.deepEqual(rows[38].cells,['37','222','223','9007199254740993123456789','1.2300e-12','226','227']);
 for(const [index,row] of rows.slice(1).entries()){
  const run=Math.floor(index/3888),acquisition=index%3888;assert.equal(row.cells[0],String(acquisition));assert.equal(row.locator.pointer,'/runs/'+run+'/acquisitions/'+acquisition);
  for(let slot=0;slot<6;slot++)assert.equal(row.cellPointers[slot+1],'/runs/'+run+'/packed/'+(384+acquisition*6+slot));
 }
 assert.deepEqual(rows.at(-1).cells,['3887','123322','123323','123324','123325','123326','123327']);
});

test('invalid packed ranges fail before yielding, and count alignment remains strict within every window',async()=>{
 const mapping=packedMapping(3);
 for(const [change,code] of [
  [s=>s.runs[1].packed.length=384+18-1,'DATASET_PACKED_LENGTH'],
  [s=>s.runs[0].packed=[],'DATASET_PACKED_LENGTH'],
  [s=>s.runs[0].acquisitions.pop(),'DATASET_JOIN_LENGTH'],
  [s=>delete s.runs[1].packed,'DATASET_JOIN_LENGTH'],
  [s=>{s.runs[0].acquisitions.pop();s.runs[1].acquisitions.push({id:3});},'DATASET_JOIN_LENGTH']
 ]){const source=packedSource(3);change(source);let yielded=0;await assert.rejects(async()=>{for await(const row of readDataset(chunks(source),mapping)){void row;yielded++;}},{code});assert.equal(yielded,0);}
 for(const packed of [{offset:-1,width:6,count:3},{offset:384,width:0,count:3},{offset:384,width:6,count:1.5},{offset:'384',width:6,count:3},{offset:384,width:Number.MAX_SAFE_INTEGER,count:3},{offset:384,width:6,count:3,ignored:true},null])assert.throws(()=>datasetMapping({...mapping,joins:[{...mapping.joins[0],packed}]}),{code:'MATERIAL_TABLE'});
 for(const path of ['', '/6','/00','/-1'])assert.throws(()=>datasetMapping({...mapping,fields:[{name:'Invalid slot',source:'timing',path}]}),{code:'MATERIAL_TABLE'});
 const source=packedSource(3);source.runs[0].packed[384]=null;source.runs[0].packed[385]='000105';source.runs[0].packed[386]=false;
 const rows=await collect(source,mapping);assert.deepEqual(rows[1].valueKinds.slice(1,4),['null','string','boolean']);assert.deepEqual(rows[1].cells.slice(1,4),['','000105','false']);
 const controller=new AbortController();controller.abort();await assert.rejects(async()=>{for await(const row of readDataset(chunks(source),mapping,{signal:controller.signal}))void row;},{name:'AbortError'});
});

test('packed mapping and source references survive retained revisions, inspection and encrypted restore',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-packed-')),f=await encryptedFixture(directory,sampleNotebook()),materials=new ResearchMaterials(f.workspace),recordId=(await f.workspace.read()).book.entries[0].id;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const source=packedSource(4),bytes=Buffer.from(JSON.stringify(source)),upload=await materials.startImport({recordId,name:'packed-timing.json',size:bytes.length});await materials.appendImport(upload.id,0,[bytes]);const artifact=await materials.finishImport(upload.id),command={recordId,title:'Packed timing records',artifact,sourceMapping:packedMapping(4)};
 command.columns=packedMapping(4).fields.map(f=>({...defaultColumn({label:f.name}),representation:'integer'}));
 const dataset=await materials.dataset(command),page=await materials.datasetPage(dataset);
 for(let column=1;column<7;column++){
  const inspected=await materials.measurements.inspect({ref:dataset,selector:{kind:'cell',page:0,row:6,column}});assert.deepEqual(inspected.original.ref,artifact);assert.equal(inspected.original.selector.pointer,'/runs/1/packed/'+(384+2*6+column-1));assert.equal((await materials.measurements.inspect(inspected.original)).text,String(100000+12+column-1));
 }
 const revised=await materials.dataset({...command,id:dataset.id,expectedRevision:dataset.revision,baseDataset:dataset,exclusions:{[page.rows[0].id]:'Declared exclusion'}});
 const plot=await materials.plot({recordId,title:'Native packed timings',dataset:revised,base:createFigure(),mapping:{x:0,xKind:'number',values:[{column:2,error:null}],group:null,operation:'raw',order:'source',kind:'scatter',numericPolicy:'safe'}});
 assert.equal(plot.figure.series[0].points.length,7);assert.equal(plot.figure.series[0].points.at(-1).y,100019);assert.deepEqual((await materials.read(plot.ref)).content.inputs,[revised]);
 const restoredRoot=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'restored')),{vault:f.vault}),restored=new ResearchMaterials(new Workspace(restoredRoot,f.vault));await restored.verify();
 assert.deepEqual((await restored.read(revised)).content.sourceMapping,packedMapping(4));assert.deepEqual((await restored.datasetPage(revised)).rows,(await materials.datasetPage(revised)).rows);
});

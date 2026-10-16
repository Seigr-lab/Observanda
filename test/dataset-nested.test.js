import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readDataset,datasetMapping} from '../src/dataset-reader.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials,EVIDENCE_CHUNK} from '../src/research-materials.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
const mapping={format:'json-nested',rowsPath:'/visits/*/acquisitions',fields:[
 {name:'Count',path:'/count',source:'row'},{name:'Visit',path:'/id',source:'row'},
 {name:'Parent',path:'/visits/*/id',source:'context'},{name:'Frequency',path:'/configuration/hz',source:'context'},
 {name:'Expected',path:'/expected',source:'control'}
],joins:[{name:'control',rowsPath:'/visits/*/controls',leftPath:'/control',rightPath:'/id',unmatched:'error'}]};
async function* chunks(source){const bytes=Buffer.from(source);for(let i=0;i<bytes.length;i+=16384)yield bytes.subarray(i,i+16384);}
const collect=async(source,plan=mapping)=>{const values=[];for await(const value of readDataset(chunks(source),plan))values.push(value);return values;};

test('nested visits stream beyond the old row limit and join exact keys within each parent regardless of source order',async()=>{
 const visit=i=>({acquisitions:Array.from({length:1100},(_,n)=>({count:n===0?'EXACT':n,id:'take-'+n,control:'same',unmapped:'x'.repeat(256)})),controls:[{id:'same',expected:i?'0.500':'1.250'}],id:'visit-'+i});
 const source=JSON.stringify({visits:[visit(0),visit(1)],configuration:{hz:48000000}}).replaceAll('"EXACT"','9007199254740993123456789');
 const rows=await collect(source);assert.equal(rows.length,2201);
 assert.deepEqual(rows[1].cells,['9007199254740993123456789','take-0','visit-0','48000000','1.250']);
 assert.deepEqual(rows[1101].cells,['9007199254740993123456789','take-0','visit-1','48000000','0.500']);
 assert.deepEqual(rows[1101].cellPointers,['/visits/1/acquisitions/0/count','/visits/1/acquisitions/0/id','/visits/1/id','/configuration/hz','/visits/1/controls/0/expected']);
 assert.equal(rows[1].valueKinds[0],'number');assert.equal(rows[1].order,1);assert.equal(rows.at(-1).order,2200);
});

test('nested mappings reject ambiguous joins and invalid bindings, preserving null/absent and explicit unmatched rows',async()=>{
 const data={visits:[{id:'v',acquisitions:[{count:null,control:1}],controls:[{id:'1',expected:2}]}],configuration:{hz:10}};
 await assert.rejects(collect(JSON.stringify(data)),{code:'DATASET_JOIN_MISSING'});
 const keep=structuredClone(mapping);keep.joins[0].unmatched='keep';const rows=await collect(JSON.stringify(data),keep);
 assert.deepEqual(rows[1].valueKinds,['null','absent','string','number','absent']);assert.equal(rows[1].cellPointers[4],null);
 data.visits[0].controls=[{id:1,expected:3},{id:1,expected:4}];await assert.rejects(collect(JSON.stringify(data)),{code:'DATASET_JOIN_DUPLICATE'});
 data.visits[0].controls=[{expected:3}];await assert.rejects(collect(JSON.stringify(data)),{code:'DATASET_JOIN_KEY'});
 for(const plan of [{...mapping,fields:[{name:'X',source:'context',path:'/other/*/id'}]},{...mapping,joins:[{...mapping.joins[0],rowsPath:'/other/*/controls'}]},{...mapping,fields:[{name:'X',source:'unknown',path:'/id'}]}])assert.throws(()=>datasetMapping(plan),{code:'MATERIAL_TABLE'});
 await assert.rejects(collect('{"visits":[],"visits":[]}'),{code:'MATERIAL_TABLE'});
 await assert.rejects(collect('{"visits":{"0":{"acquisitions":[]}}}'),{code:'MATERIAL_TABLE'});
 const controller=new AbortController();controller.abort();await assert.rejects(async()=>{for await(const row of readDataset(chunks(JSON.stringify(data)),mapping,{signal:controller.signal}))void row;},{name:'AbortError'});
});

test('nested cell sources survive revisions and backup and inspect their exact parent and lookup locations',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-nested-')),f=await encryptedFixture(directory,sampleNotebook()),m=new ResearchMaterials(f.workspace),recordId=(await f.workspace.read()).book.entries[0].id;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const bytes=Buffer.from('{"visits":[{"acquisitions":[{"count":9007199254740993,"control":"c"}],"controls":[{"id":"c","expected":1.250}],"id":"v"}],"configuration":{"hz":48000000}}');
 const upload=await m.startImport({recordId,name:'visits.json',size:bytes.length});for(let i=0;i<bytes.length;i+=EVIDENCE_CHUNK)await m.appendImport(upload.id,i/EVIDENCE_CHUNK,[bytes.subarray(i,i+EVIDENCE_CHUNK)]);
 const artifact=await m.finishImport(upload.id),command={recordId,title:'Nested visits',artifact,sourceMapping:mapping};
 const preview=await m.previewDataset(command);assert.equal(preview.rows[0].cells[0],'9007199254740993');
 const dataset=await m.dataset(command),data=await m.datasetPage(dataset);
 for(const [column,pointer,text] of [[2,'/visits/0/id','"v"'],[4,'/visits/0/controls/0/expected','1.250']]){
  const inspected=await m.measurements.inspect({ref:dataset,selector:{kind:'cell',page:0,row:0,column}});assert.equal(inspected.original.selector.pointer,pointer);
  assert.equal((await m.measurements.inspect(inspected.original)).text,text);
 }
 const revised=await m.dataset({...command,id:dataset.id,expectedRevision:dataset.revision,baseDataset:dataset,exclusions:{[data.rows[0].id]:'Declared exclusion'}});
 assert.deepEqual((await m.datasetPage(revised)).rows[0].cellPointers,data.rows[0].cellPointers);
 const restoredRoot=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'restored')),{vault:f.vault}),restored=new ResearchMaterials(new Workspace(restoredRoot,f.vault));
 await restored.verify();assert.deepEqual((await restored.datasetPage(revised)).rows,(await m.datasetPage(revised)).rows);
});

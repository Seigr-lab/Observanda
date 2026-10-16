import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readDataset,datasetMapping} from '../src/dataset-reader.js';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';

const mapping={format:'json-nested',rowsPath:'/visits/*/windows/*/acquisitions',joins:['controls','configuration','schedule'].map(name=>({name,mode:'position',rowsPath:'/visits/*/windows/*/'+name})),fields:[{name:'Window',source:'context',path:'/visits/*/windows/*/id'},{name:'Measurement',source:'row',path:'/count'},...['controls','configuration','schedule'].map(source=>({name:source,source,path:'/value'}))]};
const window=(id,count=144)=>({id,controls:Array.from({length:count},(_,i)=>({value:id+'-control-'+i})),configuration:Array.from({length:count},(_,i)=>({value:id+'-config-'+i})),acquisitions:Array.from({length:count},(_,i)=>({count:i,ignored:'x'.repeat(2000)})),schedule:Array.from({length:count},(_,i)=>({value:id+'-schedule-'+i}))});
const input=()=>({visits:[{windows:[window('first'),window('empty',0)]},{windows:[window('second'),window('third')]}]});
async function* chunks(value){const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value));for(let i=0;i<bytes.length;i+=113)yield bytes.subarray(i,i+113);}
const collect=async(value,plan=mapping)=>{const out=[];for await(const row of readDataset(chunks(value),plan))out.push(row);return out;};

test('432 positional acquisitions retain controls, configuration, schedule and exact parent locations',async()=>{
 const source=JSON.stringify(input()).replace('"count":37','"count":9007199254740993123456789'),rows=await collect(source);
 assert.equal(rows.length,433);assert.deepEqual(rows[38].cells,['first','9007199254740993123456789','first-control-37','first-config-37','first-schedule-37']);
 assert.deepEqual(rows[182].cells,['second','37','second-control-37','second-config-37','second-schedule-37']);
 assert.deepEqual(rows[182].cellPointers,['/visits/1/windows/0/id','/visits/1/windows/0/acquisitions/37/count','/visits/1/windows/0/controls/37/value','/visits/1/windows/0/configuration/37/value','/visits/1/windows/0/schedule/37/value']);
 assert.deepEqual(rows[38].valueKinds,['string','number','string','string','string']);
 for(const [index,row] of rows.slice(1).entries()){
  const visit=index<144?0:1,window=index<288?0:1,position=index%144;
  for(const [column,name] of ['acquisitions','controls','configuration','schedule'].entries())assert.equal(row.cellPointers[column+1],'/visits/'+visit+'/windows/'+window+'/'+name+'/'+position+'/'+(column?'value':'count'));
 }
});

test('positional length checks reject missing, shorter, longer and compensating mismatched windows before yielding rows',async()=>{
 for(const change of [s=>s.visits[0].windows[0].controls.pop(),s=>s.visits[0].windows[0].configuration.push({value:0}),s=>delete s.visits[0].windows[0].schedule,s=>s.visits[0].windows[1].controls.push({value:0}),s=>{s.visits[0].windows[0].controls.pop();s.visits[1].windows[0].controls.push({value:0});},s=>delete s.visits[0].windows[0].acquisitions]){
  const source=input();change(source);let yielded=0;await assert.rejects(async()=>{for await(const row of readDataset(chunks(source),mapping)){void row;yielded++;}},{code:'DATASET_JOIN_LENGTH'});assert.equal(yielded,0);
 }
 for(const rowsPath of ['/visits/*/controls','/other/*/windows/*/controls','/visits/*/windows/*/controls/*/extra'])assert.throws(()=>datasetMapping({...mapping,joins:[{name:'controls',mode:'position',rowsPath}]}),{code:'MATERIAL_TABLE'});
 assert.throws(()=>datasetMapping({...mapping,joins:[{...mapping.joins[0],unmatched:'keep'}]}),{code:'MATERIAL_TABLE'});
});

test('scalar positional rows and mixed keyed joins preserve null, absent and escaped locations',async()=>{
 const source={'w/x':[{rows:[{id:'a'}, {id:'b'}],values:[null,7],control:[{id:'b',label:'B'},{id:'a',label:'A'}]}]},plan={format:'json-nested',rowsPath:'/w~1x/*/rows',joins:[{name:'value',mode:'position',rowsPath:'/w~1x/*/values'},{name:'control',rowsPath:'/w~1x/*/control',leftPath:'/id',rightPath:'/id'}],fields:[{name:'Value',source:'value',path:''},{name:'Missing',source:'row',path:'/absent'},{name:'Label',source:'control',path:'/label'}]};
 const rows=await collect(source,plan);assert.deepEqual(rows[1].valueKinds,['null','absent','string']);assert.deepEqual(rows[2].cells,['7','','B']);assert.deepEqual(rows[1].cellPointers,['/w~1x/0/values/0',null,'/w~1x/0/control/1/label']);
});

test('positional mapping and every joined cell provenance remain inspectable after dataset revisions and backup',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-positional-')),f=await encryptedFixture(directory,sampleNotebook()),m=new ResearchMaterials(f.workspace),recordId=(await f.workspace.read()).book.entries[0].id;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const source={visits:[{windows:[window('first',2)]},{windows:[window('second',2)]}]},bytes=Buffer.from(JSON.stringify(source)),upload=await m.startImport({recordId,name:'parallel-traces.json',size:bytes.length});await m.appendImport(upload.id,0,[bytes]);
 const artifact=await m.finishImport(upload.id),command={recordId,title:'Aligned windows',artifact,sourceMapping:mapping},dataset=await m.dataset(command),page=await m.datasetPage(dataset);
 for(let column=2;column<5;column++){
  const inspected=await m.measurements.inspect({ref:dataset,selector:{kind:'cell',page:0,row:3,column}});assert.deepEqual(inspected.original.ref,artifact);assert.equal(inspected.original.selector.pointer,'/visits/1/windows/0/'+['controls','configuration','schedule'][column-2]+'/1/value');assert.equal((await m.measurements.inspect(inspected.original)).text,JSON.stringify(source.visits[1].windows[0][['controls','configuration','schedule'][column-2]][1].value));
 }
 const revised=await m.dataset({...command,id:dataset.id,expectedRevision:dataset.revision,baseDataset:dataset,exclusions:{[page.rows[0].id]:'Calibration excluded'}});
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'restored')),{vault:f.vault}),restored=new ResearchMaterials(new Workspace(copy,f.vault));await restored.verify();assert.deepEqual((await restored.read(revised)).content.sourceMapping,datasetMapping(mapping));assert.deepEqual((await restored.datasetPage(revised)).rows,(await m.datasetPage(revised)).rows);
});

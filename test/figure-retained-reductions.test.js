import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';
import {copyWorkspace,copyPlan} from '../src/locations.js';
import {contentBuffer} from '../src/file-content.js';
const column=(name,representation='text',radix=10)=>({name,representation,radix,unit:'',missing:[{value:'',meaning:'Not acquired'}],time:{kind:'none',reference:'',resolution:'',uncertainty:''}});

test('retained plotting reduces exact counter differences and native fractions before projection, preserving revisions and recovery',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-exact-plot-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),m=new ResearchMaterials(f.workspace),recordId=book.entries[0].id;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const bytes=Buffer.from('Group,Counter,Fraction\nA,9007199254740993/1,0.1\nA,-9007199254740992/1,0.5\nB,1/3,0.1\nB,2/3,0.5\nC,,\nA,999/1,555\n');
 const upload=await m.startImport({recordId,name:'exact-readings.csv',size:bytes.length});await m.appendImport(upload.id,0,[bytes]);const artifact=await m.finishImport(upload.id);
 const dataset=await m.dataset({recordId,title:'Exact mixed-domain values',artifact,columns:[column('Group'),column('Counter','rational'),column('Native fraction','radix-fraction',6)],exclusions:{[artifact.id+':7']:'Interrupted acquisition'}});
 const command={recordId,title:'Exact counter summary',dataset,mapping:{x:0,xKind:'category',values:[{column:1,error:null},{column:2,error:null}],group:null,operation:'sum',kind:'bar',order:'source',mode:'replace',decimal:'.'}};
 const saved=[];
 for(const operation of ['sum','mean','median']){
  const result=await m.plot({...command,mapping:{...command.mapping,operation}}),doc=await m.read(result.ref);saved.push(doc);
  assert.deepEqual(result.figure.series.map(s=>s.points.map(p=>p.y)),Array.from({length:2},()=>[operation==='sum'?1:.5,operation==='sum'?1:.5,null]));
  assert.equal(doc.content.numericTransform.reduction.projection,'after-reduction');assert.equal(doc.content.numericTransform.reduction.grouping,'exact-coordinate');assert.equal(doc.content.version,'6');
  assert.equal(doc.content.denominator.excludedCount,1);assert.equal(doc.content.denominator.missing[1].count,1);assert.equal(doc.content.denominator.rows,6);
 }
 await assert.rejects(m.plot({...command,mapping:{...command.mapping,operation:'raw'}}),{code:'MATERIAL_PRECISION'});
 const legacy=structuredClone(saved[0].content);legacy.version='5';delete legacy.numericTransform.reduction;legacy.figure.series[0].points[0].y=0;
 const old=await f.workspace.withLock(()=>m.commit({kind:'analysis',recordId,title:'Prior projection algorithm',content:legacy}));
 const recalculated=await m.plot({...command,id:old.id,expectedRevision:old.revision}),current=await m.read(recalculated.ref);
 assert.equal(current.previous,old.revision);assert.equal(current.content.figure.series[0].points[0].y,1);assert.deepEqual((await m.read(old)).content,legacy);
 const inspection=await m.measurements.inspect({ref:dataset,selector:{kind:'cell',page:0,row:0,column:1}});assert.equal(inspection.value.spelling,'9007199254740993/1');assert.equal(inspection.exact.numerator,'9007199254740993');
 assert.deepEqual(await contentBuffer((await m.artifact(artifact)).content),bytes);
 const denominator=10n**4100n,wide=Buffer.from('Group,Value\nA,1/'+denominator+'\nA,1/'+(denominator+1n)+'\n');
 const wideUpload=await m.startImport({recordId,name:'long-fractions.csv',size:wide.length});await m.appendImport(wideUpload.id,0,[wide]);const wideArtifact=await m.finishImport(wideUpload.id);
 const wideDataset=await m.dataset({recordId,title:'Long exact fractions',artifact:wideArtifact,columns:[column('Group'),column('Value','rational')]});
 const before=(await m.heads()).filter(h=>h.kind==='analysis').length;
 await assert.rejects(m.plot({...command,dataset:wideDataset,mapping:{...command.mapping,operation:'median',values:[{column:1,error:null}]}}),{code:'MATERIAL_PRECISION'});
 assert.equal((await m.heads()).filter(h=>h.kind==='analysis').length,before);assert.deepEqual((await f.workspace.metadataPage('.observanda/analysis-work')).items,[]);
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'backup')),{vault:f.vault}),restored=new ResearchMaterials(new Workspace(copy,f.vault));
 assert.deepEqual((await restored.read(recalculated.ref)).content,current.content);assert.deepEqual((await restored.read(old)).content,legacy);
 assert.deepEqual(await contentBuffer((await restored.artifact(artifact)).content),bytes);
 const repeated=await restored.plot(command);assert.deepEqual(repeated.figure.series.map(s=>s.points),saved[0].content.figure.series.map(s=>s.points));
});

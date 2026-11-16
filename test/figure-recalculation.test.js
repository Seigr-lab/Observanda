import {test} from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {withRetainedFigure} from '../src/retained-figures.js';
import {clearVault} from '../src/encryption.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';

const column=(name,representation='text')=>({name,representation,radix:10,unit:'',missing:[{value:'',meaning:'Not acquired'}],time:{kind:'unknown',reference:'',resolution:'',uncertainty:''}});
const header=(m,ref)=>withRetainedFigure(m,{ref},reader=>reader.header({}));

test('recalculating a retained figure with the latest dataset keeps its presentation',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-figure-recalculation-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0];
 const f=await encryptedFixture(directory,book),m=new ResearchMaterials(f.workspace);
 t.after(async()=>{await closeIdleMutationFiles();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const bytes=Buffer.from('Sample,Value\na,1\nb,2'),upload=await m.startImport({recordId:record.id,name:'readings.csv',size:bytes.length});
 await m.appendImport(upload.id,0,[bytes]);const artifact=await m.finishImport(upload.id),columns=[column('Sample'),column('Value','integer')];
 const dataset=await m.dataset({recordId:record.id,title:'Readings',artifact,columns});
 const mapping={numericPolicy:'approximate',x:0,xKind:'category',values:[{column:1,error:null,xLower:null,xUpper:null,yLower:null,yUpper:null,count:null}],group:null,operation:'raw',order:'source',kind:'line',decimal:'.',mode:'replace'};
 const base={id:crypto.randomUUID(),title:'Response',kind:'line',x:{kind:'number',label:'',scale:'linear',min:null,max:null},y:{label:'',scale:'log',min:null,max:null},legend:false,series:[{id:crypto.randomUUID(),name:'Series 1',color:'#3b5bbd',points:[]}]};
 const {ref:first}=await m.plot({recordId:record.id,title:'Response',dataset,mapping,base});
 const original=await m.read(first);assert.equal(original.content.figure.kind,'retained');
 // The dataset moves on; the figure is recalculated from its stored, retained form.
 const latest=await m.dataset({recordId:record.id,title:'Readings',id:dataset.id,expectedRevision:dataset.revision,artifact,baseDataset:dataset,columnChanges:[{index:1,column:{...columns[1],unit:'V'}}]});
 const {ref:second}=await m.plot({recordId:record.id,title:'Response',id:first.id,expectedRevision:first.revision,dataset:latest,mapping,base:original.content.figure});
 assert.equal(second.id,first.id);assert.notEqual(second.revision,first.revision);
 const before=(await header(m,first)).header,after=(await header(m,second)).header;
 assert.deepEqual({kind:after.kind,title:after.title,legend:after.legend,scale:after.y.scale},{kind:before.kind,title:before.title,legend:false,scale:'log'});
 assert.ok((await m.read(second)).content.inputs.some(input=>input.id===latest.id&&input.revision===latest.revision));
 // A retained base must be the figure of the revision being replaced.
 await assert.rejects(m.plot({recordId:record.id,title:'Response',id:first.id,expectedRevision:second.revision,dataset:latest,mapping,base:original.content.figure}),{code:'MATERIAL_CHANGED'});
 await assert.rejects(m.plot({recordId:record.id,title:'Response',dataset:latest,mapping,base:original.content.figure}),{code:'MATERIAL_INVALID'});
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {Workspace} from '../src/storage.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {enqueuePlot} from '../src/dataset-jobs.js';
import {RetainedFigureDocuments} from '../src/retained-figure-document.js';
import {inspectPlotPoint,verifyPlotProjection} from '../src/dataset-plot-provenance.js';
import {verifySelectedPlot} from '../src/dataset-plot-selection.js';

test('plotting and reopened provenance ignore unselected retained text while validating selected cells',{timeout:90000},async t=>{
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-selected-plot-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),materials=new ResearchMaterials(f.workspace),recordId=book.entries[0].id,jobs=workspaceJobs(f.workspace);
 t.after(async()=>{await jobs.worker.stop();clearVault(f.vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-selected-plot-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const notes='Synthetic acquired detail. '.repeat(165),names=['reading','counter','native','notes'],bytes=Buffer.from(Array.from({length:4},(_,reading)=>JSON.stringify({reading,counter:'18446744073709551615',native:'105',notes})).join('\n'));
 const upload=await materials.startImport({recordId,name:'selected-values.jsonl',size:bytes.length});await materials.appendImport(upload.id,0,[bytes]);const artifact=await materials.finishImport(upload.id);
 const columns=names.map((name,index)=>({...defaultColumn({label:name}),representation:index===3?'text':index===2?'radix':'integer',radix:index===2?6:10}));
 const dataset=await materials.dataset({recordId,title:'Measurements and long notes',artifact,sourceMapping:{format:'jsonl',fields:names.map(name=>({name,path:'/'+name}))},columns}),source=await materials.datasetPage(dataset);assert.equal(source.rows[0].cells[3].format,'dataset-cell');
 const mapping={x:2,xKind:'category',values:[{column:0,error:null}],group:null,operation:'mean',kind:'bar',order:'source',mode:'replace',decimal:'.'},id=randomUUID();
 await enqueuePlot(materials,jobs.queue,{recordId,title:'Mean of selected readings',dataset,mapping},id);jobs.worker.enabled=true;try{await jobs.worker.runOnce();}finally{jobs.worker.enabled=false;}
 const job=await jobs.queue.read(id);assert.equal(job.state,'completed',JSON.stringify(job));
 const reopened=new ResearchMaterials(new Workspace(f.workspace.root,f.vault)),result=await reopened.read(job.result),reader=await new RetainedFigureDocuments(reopened.workspace,{readOnly:true}).open(result.content.figure),points=await reader.window({collection:'points',limit:2});assert.equal(points.total,1);assert.equal(points.items[0].value.y,1.5);assert.equal(points.items[0].value.x,'105');assert.equal(result.content.denominator.format,2);assert.equal(result.content.denominator.included,4);
 await verifySelectedPlot(reopened,result);await verifyPlotProjection(reopened,result);const inspection=await inspectPlotPoint(reopened,job.result,0);assert.equal(inspection.members.length,4);
 // A retained long cell is still refused when actually used as a category
 // without a corresponding supported scalar interpretation.
 await assert.rejects(()=>reopened.plot({recordId,title:'Unsupported long category',dataset,mapping:{...mapping,x:3}}),{code:'DATASET_CELL_SCALAR_REQUIRED'});
 assert.deepEqual((await reopened.datasetPage(dataset)).rows,source.rows);
});

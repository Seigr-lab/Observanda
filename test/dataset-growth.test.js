import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,open,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials,EVIDENCE_CHUNK} from '../src/research-materials.js';
import {clearVault} from '../src/encryption.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {enqueueDataset,enqueuePlot} from '../src/dataset-jobs.js';
const column=(name,representation='text')=>({name,representation,radix:10,unit:'',missing:[{value:'',meaning:'Not acquired'}],time:{kind:'none',reference:'',resolution:'',uncertainty:''}});
test('physical 17 MiB and tenfold JSON datasets retain exact values and independently checked figures within budgets',async t=>{
 t.diagnostic(JSON.stringify({platform:process.platform,cpu:os.cpus()[0].model,node:process.version,totalMemoryGiB:Math.round(os.totalmem()/1024**3)}));
 for(const count of [4344,43440]){
  const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-dataset-growth-')),f=await encryptedFixture(directory,sampleNotebook()),m=new ResearchMaterials(f.workspace),jobs=workspaceJobs(f.workspace),recordId=(await f.workspace.read()).book.entries[0].id;
  t.after(async()=>{await jobs.worker.stop();clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
  const filename=path.join(directory,'synthetic.jsonl'),writer=await open(filename,'wx'),expected=Array.from({length:4},()=>({sum:0,count:0,rows:0,values:[]})),hash=createHash('sha256');
  let bytes=0,missing=0;
  try{
   for(let i=0;i<count;i++){
    const group=i%4,reading=i%101===0?null:i%1000;if(reading===null)missing++;
    if(i!==99)expected[group].rows++;
    if(reading!==null&&i!==99){expected[group].sum+=reading;expected[group].count++;expected[group].values.push(reading);}
    const row=Buffer.from('{"group":"Group '+group+'","reading":'+reading+',"counter":18446744073709551615,"native":"105","notes":"'+('x'.repeat(4096))+'","sequence":'+i+'}\n');
    await writer.write(row);hash.update(row);bytes+=row.length;
   }
  }finally{await writer.close();}
  assert.ok(bytes>16*1024*1024*(count/4344));
  const begin=performance.now();let peakHeap=process.memoryUsage().heapUsed;
  const sampler=setInterval(()=>{peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);},25);sampler.unref();
  try{
   const session=await m.startImport({recordId,name:'synthetic.jsonl',size:bytes});let index=0;
   for await(const chunk of createReadStream(filename,{highWaterMark:EVIDENCE_CHUNK}))await m.appendImport(session.id,index++,[chunk]);
   const artifact=await m.finishImport(session.id);
   assert.equal((await m.read(artifact)).content.sha256,hash.digest('hex'));
   const uploaded=performance.now(),sourceMapping={format:'jsonl',fields:['group','reading','counter','native','notes','sequence'].map(name=>({name,path:'/'+name}))};
   const columns=[column('Group'),column('Reading','integer'),column('Counter','integer'),{...column('Native','radix'),radix:6},column('Notes'),column('Sequence','integer')];
   const perform=async id=>{
    jobs.worker.enabled=true;await jobs.worker.runOnce();jobs.worker.enabled=false;
    const job=await jobs.queue.read(id);assert.equal(job.state,'completed',JSON.stringify(job));return job;
   };
   const id=randomUUID();await enqueueDataset(m,jobs.queue,{recordId,title:'Full retained observations',artifact,sourceMapping,columns,exclusions:{[artifact.id+':100']:'Incomplete observation'}},id);
   const dataset=(await perform(id)).result,parsed=performance.now(),doc=await m.read(dataset);
   assert.equal(doc.content.rowCount,count);assert.ok(JSON.stringify(doc).length<6000);
   const last=await m.datasetPage(dataset,doc.content.pageIndex.count-1);
   assert.equal(last.rows.at(-1).cells[2],'18446744073709551615');assert.equal(last.rows.at(-1).cells[3],'105');assert.equal(last.rows.at(-1).cells[4].length,4096);
   const mapping={x:0,xKind:'category',values:[{column:1,error:null}],group:null,operation:'mean',kind:'bar',order:'source',mode:'replace',decimal:'.'},figures={};
   for(const group of expected)group.values.sort((a,b)=>a-b);
   for(const operation of ['mean','median','sum','min','max','count']){
    const plotId=randomUUID(),started=performance.now();
    await enqueuePlot(m,jobs.queue,{recordId,title:operation+' by declared group',dataset,mapping:{...mapping,operation}},plotId);
    const result=await m.read((await perform(plotId)).result);
    assert.equal(result.content.denominator.rows,count);assert.equal(result.content.denominator.included,count-1);assert.equal(result.content.denominator.excludedCount,1);assert.equal(result.content.denominator.missing[1].count,missing);
    assert.equal(result.content.figure.series[0].points.length,4);
    for(const point of result.content.figure.series[0].points){
     const group=expected[Number(point.x.slice(6))],values=group.values,middle=Math.floor(values.length/2);
     const answer={mean:group.sum/group.count,sum:group.sum,min:values[0],max:values.at(-1),count:group.rows,median:values.length%2?values[middle]:(values[middle-1]+values[middle])/2}[operation];
     assert.ok(Math.abs(point.y-answer)<1e-9,operation+' '+point.x);
    }
    assert.deepEqual(result.content.inputs,[dataset]);
    figures[operation]=Math.round(performance.now()-started);assert.ok(figures[operation]<120000,operation+' calculation budget');
    assert.equal((await f.workspace.metadataPage('.observanda/analysis-work/'+plotId,{limit:1})).items.length,0,'Median scratch is removed');
   }
   // Raw plots retain every observation or reject the whole result. A plot
   // capacity failure must never silently sample rows or damage the dataset.
   const rawId=randomUUID(),rawStart=performance.now();
   await enqueuePlot(m,jobs.queue,{recordId,title:'Individual observations',dataset,mapping:{...mapping,x:5,xKind:'number',operation:'raw',kind:'scatter'}},rawId);
   jobs.worker.enabled=true;await jobs.worker.runOnce();jobs.worker.enabled=false;
   const rawJob=await jobs.queue.read(rawId);
   if(count<=10000){
    assert.equal(rawJob.state,'completed',JSON.stringify(rawJob));
    const points=(await m.read(rawJob.result)).content.figure.series[0].points;assert.equal(points.length,count-1);
    for(let i=0;i<points.length;i++){const row=i<99?i:i+1;assert.equal(points[i].x,row);assert.equal(points[i].y,row%101===0?null:row%1000);}
   }else{assert.equal(rawJob.state,'failed');assert.equal(rawJob.error,'MATERIAL_ANALYSIS_LIMIT');assert.equal(rawJob.result,null);}
   figures.raw=Math.round(performance.now()-rawStart);assert.ok(figures.raw<120000);
   assert.deepEqual(await m.read(dataset),doc);assert.equal((await m.datasetPage(dataset,0)).rows[0].cells[2],'18446744073709551615');
   assert.ok(uploaded-begin<240000);assert.ok(parsed-uploaded<240000);assert.ok(peakHeap<256*1024*1024);
   t.diagnostic(JSON.stringify({rows:count,originalBytes:bytes,pages:doc.content.pageIndex.count,uploadMs:Math.round(uploaded-begin),datasetMs:Math.round(parsed-uploaded),figureMs:figures,sampledHeapMiB:Math.round(peakHeap/1024**2),manifestBytes:Buffer.byteLength(JSON.stringify(doc))}));
  }finally{clearInterval(sampler);}
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {retainDatasetOriginal as retainOriginal} from './fixtures/dataset-original.js';
import {clearVault} from '../src/encryption.js';
import {FileContent} from '../src/file-content.js';
import {withDatasetExchangeAuthority} from '../src/dataset-exchange-authority.js';
import {prepareExchangeFiles,removeExchangeAttempt} from '../src/dataset-exchange-files.js';
import {executeMaterialRequest} from '../src/material-requests.js';
import {defaultColumn} from '../src/web/dataset-schema.js';

// Explicit capacity qualification with ordinary encrypted storage. Each size
// gets its own process run and disposable workspace for memory measurements.
async function fixture(t){
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-exchange-capacity-'));
 const book=sampleNotebook(),f=await encryptedFixture(directory,book),m=new ResearchMaterials(f.workspace),recordId=book.entries[0].id;
 t.after(async()=>{await clearVault(f.vault);assert.equal(path.dirname(directory),parent);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 return {...f,m,book,recordId};
}

async function roundTrip(f,source,t){
 const {m,workspace,recordId}=f,doc=await m.read(source),ref={...source,workspaceId:f.book.id};
 const command={recordId,format:'tsv',ref,selection:{offset:0,count:null,columns:null,includeExcluded:true}};
 const job=randomUUID(),attempt=randomUUID(),signal=t.signal,samples=[];let phase='export',peakHeap=0,peakRss=0;
 const sample=()=>{const {rss,heapUsed}=process.memoryUsage();peakHeap=Math.max(peakHeap,heapUsed);peakRss=Math.max(peakRss,rss);};
 const sampler=setInterval(sample,100);sampler.unref();t.after(()=>clearInterval(sampler));sample();
 let last=0;
 const progress=p=>{
  if(p.done&&p.total&&p.done>=last+Math.max(1,Math.floor(p.total/10))){last=p.done;sample();samples.push({phase,rows:last,heapMiB:Math.ceil(process.memoryUsage().heapUsed/1048576)});process.stdout.write('# '+phase+' '+p.done+'/'+p.total+'\n');}
 };
 const files=await withDatasetExchangeAuthority(m,command,{signal},(doc,grants)=>prepareExchangeFiles(m,doc,command,{job,attempt,...grants,progress}));
 const descriptor=files.files['dataset.jsonl'],file=path.join(workspace.root,'.observanda','materials','exchanges',job,attempt,'dataset.jsonl');
 assert.ok((await stat(file)).size>descriptor.size);
 const typed=new FileContent(workspace,file,descriptor.size,descriptor.sha256);
 const recipient=f.book.entries[1].id;
 const artifact=await retainOriginal(m,recipient,'dataset.jsonl',descriptor.size,typed.readStaged({signal}));
 await removeExchangeAttempt(workspace,job,attempt);
 phase='reimport';last=0;
 const restored=await m.dataset({recordId:recipient,title:'Imported observations',artifact,exchangeImport:1},{signal,progress});
 const result=await m.read(restored);assert.equal(result.content.rowCount,doc.content.rowCount);assert.equal(result.content.schemaIndex.count,doc.content.schemaIndex.count);assert.equal(result.content.exchangeOrigin.ref.revision,ref.revision);
 const lastPage=m.datasetPageCount(doc)-1,start=Math.max(0,doc.content.schemaIndex.count-8);
 for(const page of new Set([0,lastPage])){
  const before=await m.datasetPage(ref,page,{columnOffset:start,columnLimit:8}),after=await m.datasetPage(restored,page,{columnOffset:start,columnLimit:8});
  assert.deepEqual(before.columns,after.columns);
  for(let index=0;index<before.rows.length;index++){const a=before.rows[index],b=after.rows[index];assert.deepEqual([a.id,a.cells,a.valueKinds,a.excluded],[b.id,b.cells,b.valueKinds,b.excluded]);}
 }
 sample();assert.ok(peakHeap<512*1048576,'bounded exporter and importer heap');
 t.diagnostic(JSON.stringify({rows:doc.content.rowCount,columns:doc.content.schemaIndex.count,typedBytes:descriptor.size,peakHeapMiB:Math.ceil(peakHeap/1048576),peakRssMiB:Math.ceil(peakRss/1048576),samples}));
}

test('one million physical observations export and reimport with exact row identity',{timeout:4*60*60*1000},async t=>{
 const f=await fixture(t),rows=1_000_000;
 const header=Buffer.from('Counter\n'),line=Buffer.from('9007199254740993\n'),block=Buffer.from(line.toString().repeat(4096));
 async function* observations(){yield header;for(let i=0;i<rows;i+=4096)yield block.subarray(0,Math.min(4096,rows-i)*line.length);}
 const artifact=await retainOriginal(f.m,f.recordId,'counter.csv',header.length+rows*line.length,observations());
 process.stdout.write('# Preparing one million retained source observations\n');
 const source=await f.m.dataset({recordId:f.recordId,title:'Counter readings',artifact,columns:[{...defaultColumn({label:'Counter'}),representation:'integer'}],exclusions:{[artifact.id+':1000001']:'Instrument stopped'}},{signal:t.signal});
 await roundTrip(f,source,t);
});

test('3,210 authored graph outputs export and reimport as a wide derived table',{timeout:2*60*60*1000},async t=>{
 const f=await fixture(t),{m,recordId}=f,width=3210,bytes=Buffer.from('Counter\n9007199254740993\n');
 const artifact=await retainOriginal(m,recordId,'observations.csv',bytes.length,[bytes]);
 const input=await m.dataset({recordId,title:'Observation',artifact,columns:[{...defaultColumn({label:'Counter'}),representation:'integer'}]});
 const request=(name,data)=>executeMaterialRequest(f.workspace,{material:name},data,{signal:t.signal});
 let graph=(await request('calculation-graph-create',{recordId,title:'Derived reading panels',source:input})).ref;
 const {items:[binding]}=await request('calculation-graph-page',{ref:graph,collection:'bindings'});
 const node={id:randomUUID(),kind:'column',binding:{id:binding.id,position:0},column:0},address={id:node.id,position:0};
 graph=(await request('calculation-graph-change',{ref:graph,collection:'nodes',offset:0,item:node})).ref;
 let last;
 graph=await f.workspace.withLock(async()=>{
  const original=await m.read(graph),outputs=m.sequences.builder('calculation-outputs',fn=>fn());
  for(let index=0;index<width;index++){last={id:randomUUID(),name:'Panel '+(index+1),node:address};await outputs.append(last);}
  return m.commit({kind:'analysis',recordId,id:graph.id,expectedRevision:graph.revision,title:original.title,content:{...original.content,graphOutputsIndex:await outputs.finish()}});
 });
 graph=(await request('calculation-graph-change',{ref:graph,collection:'outputs',offset:width-1,item:{...last,name:'Final reading'}})).ref;
 process.stdout.write('# Calculating 3,210 native graph outputs\n');
 const source=await m.dataset({id:randomUUID(),expectedRevision:null,recordId,title:'Computed panels',calculation:{version:4,graph}},{signal:t.signal});
 await roundTrip(f,source,t);
});

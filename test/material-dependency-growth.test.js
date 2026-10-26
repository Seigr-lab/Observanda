import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {withWorkspaceMetadataBatch} from '../src/metadata-batch.js';
import {clearVault} from '../src/encryption.js';

test('dependency review qualifies 65 and 650 pinned records, overlapping graphs and an uncached earlier revision',async t=>{
 t.diagnostic(JSON.stringify({platform:process.platform,node:process.version,cpu:os.cpus()[0].model,totalMemoryGiB:Math.round(os.totalmem()/1024**3)}));
 for(const count of [65,650]){
  const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-dependency-growth-')),book=sampleNotebook(),seed=book.entries[2];
  book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Acquisition '+i,body:'Retained private source '.repeat(20),relations:[],attachments:[],sections:[],figures:[],contributors:[]}));
  const f=await encryptedFixture(directory,book),m=new ResearchMaterials(f.workspace),recordId=book.entries[0].id,derived=[];let source;
  t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
  await f.workspace.withLock(()=>withWorkspaceMetadataBatch(f.workspace,async()=>{
   const refs=m.sequences.builder('references',fn=>fn());
   for(const record of book.entries)await refs.append(await m.retainRecord(record));
   source=await m.commit({kind:'collection',recordId,title:'Earlier acquisition set',content:{inputsIndex:await refs.finish()}});
   for(let i=0;i<3;i++)derived.push(await m.commit({kind:'collection',recordId,title:'Independent interpretation '+i,content:{inputs:[source,...derived]}}));
   await m.commit({kind:source.kind,id:source.id,expectedRevision:source.revision,recordId,title:'Revised acquisition set',content:{inputs:[]}});
   // A pre-index revision remains inspectable through the old manifest path.
   await f.workspace.removeMetadata('.observanda/materials/index/dependencies/'+source.id+'/'+source.revision+'.json');
  }));
  const other=book.entries[1];
  await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:other.id,expectedRevision:recordRevision(other),record:{...other,title:'An amended source observation'}}]},{compact:true});
  const original=ResearchCatalogue.prototype.record,read=m.readStored.bind(m);let bodies=0,earlier=0,peakHeap=0;
  ResearchCatalogue.prototype.record=function(id,...args){assert.equal(id,recordId,'Unselected original loaded');bodies++;return original.call(this,id,...args);};
  m.readStored=async ref=>{assert.equal(ref.id,source.id);assert.equal(ref.revision,source.revision);earlier++;return read(ref);};
  const sampler=setInterval(()=>{peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);},25);sampler.unref();
  const start=performance.now();let page;
  try{page=await m.reviewDependencies(recordId,{refs:derived});}finally{clearInterval(sampler);ResearchCatalogue.prototype.record=original;m.readStored=read;}
  const elapsed=performance.now()-start;
  for(const ref of derived){
   const item=page.items.find(item=>item.id===ref.id);assert.equal(item.changedCount,2);
   assert.deepEqual(new Set(item.changed.map(ref=>ref.id)),new Set([source.id,other.id]));
  }
  assert.ok(bodies<=2);assert.equal(earlier,3);assert.ok(elapsed<30000,'Dependency review latency: '+Math.round(elapsed));assert.ok(peakHeap<256*1024*1024);
  t.diagnostic(JSON.stringify({records:count,heads:page.items.length,elapsedMs:Math.round(elapsed),originalBodyReads:bodies,uncachedRevisionReads:earlier,sampledHeapMiB:Math.round(peakHeap/1024**2)}));
 }
});

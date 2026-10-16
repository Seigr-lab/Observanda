import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {Laboratory} from '../src/laboratory.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {digest,serialize} from '../src/storage-format.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {seedSampleAnalysis} from './sample-analysis-fixture.js';
import {SampleAnalysisReader} from '../src/sample-analysis-reader.js';
const instant='2026-10-01T00:00:00.000Z',capacity=16*1024*1024;
function corpus(samples,analyses=samples*2,events=samples*8){
 const lab={formatVersion:1,revision:events,samples:[],analyses:[],events:[]};
 for(let i=0;i<samples;i++)lab.samples.push({id:randomUUID(),code:'S-'+i,material:'Synthetic material',source:'Test fixture',collectedOn:'2026-10-01',receivedOn:'2026-10-01'});
 for(let i=0;i<analyses;i++)lab.analyses.push({id:randomUUID(),code:'A-'+i,sampleId:lab.samples[i%samples].id,result:{method:'Synthetic method 1',analyte:'Test measurement',kind:'numeric',value:i,unit:'V',lower:null,upper:null,notes:''},status:'draft',review:null,updatedAt:instant});
 for(let i=0;i<events;i++){const event={id:randomUUID(),at:instant,action:'save-result',recordId:lab.analyses[i%analyses].id,actor:'',reason:'',previous:lab.events.at(-1)?.hash??''};lab.events.push({...event,hash:digest(serialize(event))});}
 return lab;
}
async function fixture(t,lab,{indexed=false}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-laboratory-growth-')),f=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 await f.workspace.withLock(()=>f.workspace.catalogue(store=>indexed?seedSampleAnalysis(store,lab):store.putObject('laboratory',lab)));
 return {...f,directory,service:new Laboratory(f.workspace.root,f.vault)};
}

test('sample-analysis store qualifies 65 and 650 samples through save, review, retained report and restore',async t=>{
 t.diagnostic(JSON.stringify({platform:process.platform,node:process.version,cpu:os.cpus()[0].model,totalMemoryGiB:Math.round(os.totalmem()/1024**3)}));
 for(const count of [65,650]){
  const source=corpus(count),f=await fixture(t,source),start=performance.now(),opened=await f.service.read(),readMs=performance.now()-start,id=source.analyses.at(-1).id;
  const before=performance.now(),submitted=await f.service.change({action:'save-and-submit',etag:opened.etag,expectedRecordRevision:opened.recordRevisions[id],id,result:{...source.analyses.at(-1).result,value:0.125}}),editMs=performance.now()-before;
  assert.ok(readMs<5000);assert.ok(editMs<10000);assert.equal(submitted.lab.analyses.at(-1).status,'in review');assert.equal(submitted.lab.analyses.at(-1).result.value,0.125);assert.deepEqual(submitted.lab.analyses.slice(0,-1),source.analyses.slice(0,-1));
  const approved=await f.service.change({action:'review',etag:submitted.etag,id,reviewer:'Synthetic reviewer',comment:'Checked against the retained source',decision:'approve',checked:true});
  await f.service.change({action:'amend',etag:approved.etag,id,reason:'Test a subsequent correction'});
  assert.match(await f.service.report(id,approved.etag,[],{retained:true}),/<td>0\.125<\/td>/);
  await assert.rejects(f.service.change({action:'submit',etag:opened.etag,expectedRecordRevision:opened.recordRevisions[id],id}),{code:'LAB_STALE'});
  const current=await f.service.read(),backup=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'backup')),{vault:f.vault});
  assert.deepEqual(await new Laboratory(backup,f.vault).read(),current);
  const access=await createAccess('','fresh sample-analysis key'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
  const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'fresh')),access,vault,f.vault);
  assert.deepEqual(await new Laboratory(fresh,vault).read(),current);assert.match(await new Laboratory(fresh,vault).report(id,approved.etag,[],{retained:true}),/<td>0\.125<\/td>/);
  t.diagnostic(JSON.stringify({samples:count,analyses:source.analyses.length,events:source.events.length,bytes:Buffer.byteLength(serialize(source)),readMs:Math.round(readMs),editMs:Math.round(editMs)}));
 }
});

test('the 16 MiB sample-analysis boundary accepts valid data and rejects overflow without writing history or current data',async t=>{
 const lab=corpus(5000,10000,16000),initial=Buffer.byteLength(serialize(lab));assert.ok(initial<capacity);
 let remaining=capacity-initial;for(const item of lab.analyses){const length=Math.min(2000,remaining);item.result.notes='x'.repeat(length);remaining-=length;if(!remaining)break;}assert.equal(remaining,0);assert.equal(Buffer.byteLength(serialize(lab)),capacity);
 const f=await fixture(t,lab,{indexed:true});let peakHeap=process.memoryUsage().heapUsed;const sampler=setInterval(()=>{peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);},10);sampler.unref();
 try{
  const reader=new SampleAnalysisReader(f.service),workspaceId=(await f.workspace.outline()).metadata.id,before=performance.now(),current=await reader.query({workspaceId,view:'analyses',limit:25}),readMs=performance.now()-before;assert.ok(readMs<1500);assert.equal(current.total,10000);
  const id=lab.analyses.at(-1).id,put=ResearchCatalogue.prototype.putObject;let writes=0;
  ResearchCatalogue.prototype.putObject=function(...args){writes++;return put.apply(this,args);};
  try{await assert.rejects(f.service.change({action:'submit',etag:current.etag,id},{compact:true}),{code:'LIMIT'});}finally{ResearchCatalogue.prototype.putObject=put;}
  assert.equal(writes,0);assert.equal((await reader.query({workspaceId,view:'analyses',limit:1})).etag,current.etag);
  // Editing down below the retained limit stays available at full capacity.
  const first=lab.analyses[0],editStart=performance.now(),saved=await f.service.change({action:'save-result',etag:current.etag,id:first.id,result:{...first.result,notes:''}},{compact:true}),editMs=performance.now()-editStart;
  assert.equal((await reader.selected({workspaceId,kind:'analysis',id:first.id})).record.result.notes,'');assert.equal(saved.lab,undefined);assert.ok(editMs<2000);assert.ok(peakHeap<512*1024*1024);
  await assert.rejects(f.service.change({action:'create-sample',etag:saved.etag,sample:{...lab.samples[0],id:undefined,code:'Over sample count'}},{compact:true}),{code:'LAB_INVALID'});
  t.diagnostic(JSON.stringify({samples:5000,analyses:10000,bytes:capacity,readMs:Math.round(readMs),editMs:Math.round(editMs),sampledHeapMiB:Math.round(peakHeap/1024**2)}));
 }finally{clearInterval(sampler);}
});

test('sample-analysis relationship and event integrity cannot be bypassed at the configured count limits',async t=>{
 const lab=corpus(3),f=await fixture(t,lab),write=value=>f.workspace.withLock(()=>f.workspace.catalogue(store=>store.putObject('laboratory',value)));
 for(const value of [
  {...lab,samples:Array.from({length:5001},()=>lab.samples[0])},
  {...lab,analyses:Array.from({length:10001},()=>lab.analyses[0])},
  {...lab,events:Array.from({length:50001},()=>lab.events[0])},
  {...lab,analyses:lab.analyses.map((a,i)=>i===1?{...a,sampleId:lab.analyses[0].id}:a)},
  {...lab,events:lab.events.map((e,i)=>i===2?{...e,previous:''}:e)}
 ]){await write(value);await assert.rejects(f.service.read(),{code:'LAB_INVALID'});}
 await write(lab);assert.deepEqual((await f.service.read()).lab,lab);
});

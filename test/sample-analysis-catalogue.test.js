import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Laboratory} from '../src/laboratory.js';
import {SampleAnalysisCatalogue} from '../src/sample-analysis-catalogue.js';
import {SampleAnalysisReader} from '../src/sample-analysis-reader.js';
import {ResearchCatalogue,catalogueDescriptor} from '../src/research-catalogue.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {digest,serialize} from '../src/storage-format.js';
import {seedSampleAnalysis} from './sample-analysis-fixture.js';
const sample={code:'S-01',material:'Synthetic solution',source:'Test',collectedOn:'2026-10-01',receivedOn:'2026-10-01'};
const result={method:'Method 1',analyte:'Absorbance',kind:'numeric',value:0.3,unit:'AU',lower:0,upper:1,notes:'Private original notes'};
async function fixture(t,count=0){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-sample-index-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),lab={formatVersion:1,revision:0,samples:[],analyses:[],events:[]};
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 for(let i=0;i<count;i++){
  const s={...sample,id:randomUUID(),code:'S-'+i};lab.samples.push(s);
  for(let j=0;j<2;j++)lab.analyses.push({id:randomUUID(),code:'A-'+i+'-'+j,sampleId:s.id,result:{...result,notes:'private-result '.repeat(120)},status:'draft',review:null,updatedAt:'2026-10-01T00:00:00.000Z'});
 }
 if(count)await new Laboratory(f.workspace).catalogue(store=>seedSampleAnalysis(store,lab),{write:true});
 const service=new Laboratory(f.workspace.root,f.vault);return {...f,book,lab,service,reader:new SampleAnalysisReader(service)};
}
test('new installations retain separate originals; commands, reviews, reports and event pages share the same pinned indexes',async t=>{
 const f=await fixture(t),save=(command,options={})=>f.service.change(command,{compact:true,commandId:randomUUID(),...options});
 const first=await save({action:'create-sample',etag:'new',sample});
 const head=await f.service.catalogue(s=>s.object('laboratory'));assert.equal(head.formatVersion,2);assert.ok(Buffer.byteLength(serialize(head))<1000);
 const idempotency=randomUUID(),create={action:'create-analysis',etag:'new',analysis:{code:'A-01',sampleId:first.selectedId,result}};
 const a=await save(create,{commandId:idempotency});assert.deepEqual(await save(create,{commandId:idempotency}),a);
 const selected=await f.reader.selected({workspaceId:f.book.id,kind:'analysis',id:a.selectedId});
 const submit=await save({action:'save-and-submit',etag:first.etag,id:a.selectedId,expectedRecordRevision:selected.revision,result:{...result,value:0.4}});
 const reviewed=await save({action:'review',etag:submit.etag,id:a.selectedId,reviewer:'Fixture reviewer',comment:'Checked',decision:'approve',checked:true});
 const approved=await f.reader.query({workspaceId:f.book.id,view:'analyses'});assert.equal(approved.counts.approved,1);
 const read=Laboratory.prototype.read,assemble=SampleAnalysisCatalogue.prototype.assemble;
 Laboratory.prototype.read=()=>{throw Error('Full sample read');};SampleAnalysisCatalogue.prototype.assemble=()=>{throw Error('Sample assembly');};
 try{
  assert.match(await f.service.report(a.selectedId,reviewed.etag),/<td>0\.4<\/td>/);
  const amended=await save({action:'amend',etag:reviewed.etag,id:a.selectedId,reason:'Transcription correction'});
  assert.match(await f.service.report(a.selectedId,reviewed.etag,[],{retained:true}),/<td>0\.4<\/td>/);
  await assert.rejects(f.service.report(a.selectedId,reviewed.etag),{code:'LAB_STALE'});
  assert.equal((await f.reader.query({workspaceId:f.book.id,view:'analyses'})).counts.approved,0);
  assert.deepEqual((await f.reader.query({workspaceId:f.book.id,view:'analyses',cursor:approved.cursor})).items,approved.items);
  const other=await save({action:'create-sample',etag:amended.etag,sample:{...sample,code:'S-02'}});
  await save({action:'save-result',etag:amended.etag,id:a.selectedId,expectedRecordRevision:amended.recordRevision,result:{...result,value:0.5}});
  await assert.rejects(save({action:'save-result',etag:other.etag,id:a.selectedId,expectedRecordRevision:amended.recordRevision,result}),{code:'LAB_STALE'});
  assert.equal((await f.reader.query({workspaceId:f.book.id,view:'events',recordId:a.selectedId,limit:2})).total,5);
 }finally{Laboratory.prototype.read=read;SampleAnalysisCatalogue.prototype.assemble=assemble;}
 const before=await f.service.read();await assert.rejects(save({action:'create-sample',etag:before.etag,sample:{...sample,code:'s-01'}}),{code:'LAB_INVALID'});
 assert.equal((await f.service.read()).etag,before.etag);
 await f.service.catalogue(async store=>new SampleAnalysisCatalogue(store).verify(await new SampleAnalysisCatalogue(store).source()));
});
test('65 and 650 samples have bounded original reads and SQL for pages, late history and single-result edits',async t=>{
 t.diagnostic(JSON.stringify({platform:process.platform,node:process.version,cpu:os.cpus()[0].model,totalMemoryGiB:Math.round(os.totalmem()/1024**3)}));
 for(const count of [65,650]){
  const f=await fixture(t,count),owner=SampleAnalysisCatalogue.prototype.value,read=Laboratory.prototype.read,connection=await f.workspace.catalogue(s=>Object.getPrototypeOf(s.db)),run=connection.run;let originals=0,queries=0;
  connection.run=function(...args){queries++;return run.apply(this,args);};
  SampleAnalysisCatalogue.prototype.value=async function(revision){const value=await owner.call(this,revision);if(value.result?.notes!==undefined)originals++;return value;};
  Laboratory.prototype.read=()=>{throw Error('Whole sample-analysis store loaded');};
  let peak=process.memoryUsage().heapUsed;const sampler=setInterval(()=>{peak=Math.max(peak,process.memoryUsage().heapUsed);},10);sampler.unref();
  try{
   const begin=performance.now(),page=await f.reader.query({workspaceId:f.book.id,view:'analyses',limit:25}),pageMs=performance.now()-begin,pageQueries=queries;assert.equal(originals,0);assert.equal(page.items.length,25);assert.equal(page.total,count*2);assert.ok(pageMs<1500);assert.ok(pageQueries<250);
   const selected=await f.reader.selected({workspaceId:f.book.id,kind:'analysis',id:f.lab.analyses.at(-1).id});assert.equal(originals,1);originals=0;
   queries=0;const edit=performance.now(),saved=await f.service.change({action:'save-result',etag:page.etag,expectedRecordRevision:selected.revision,id:selected.record.id,result:{...selected.record.result,value:0.7}},{compact:true,commandId:randomUUID()}),editMs=performance.now()-edit,editQueries=queries;
   assert.equal(originals,1);assert.ok(editMs<2000);assert.ok(editQueries<900);assert.ok(Buffer.byteLength(JSON.stringify(saved))<250);assert.ok(peak<256*1024*1024);
   const history=await f.reader.query({workspaceId:f.book.id,view:'events',recordId:selected.record.id,limit:20});assert.equal(history.total,1);assert.equal(originals,1);
   t.diagnostic(JSON.stringify({samples:count,analyses:count*2,pageMs:Math.round(pageMs),editMs:Math.round(editMs),pageQueries,editQueries,editOriginals:originals,pageBytes:Buffer.byteLength(JSON.stringify(page)),sampledHeapMiB:Math.round(peak/1024**2)}));
  }finally{clearInterval(sampler);SampleAnalysisCatalogue.prototype.value=owner;Laboratory.prototype.read=read;connection.run=run;}
 }
});
test('missing originals and altered summaries fail selected reading or complete catalogue verification',async t=>{
 const f=await fixture(t,3),id=f.lab.analyses[0].id;
 await f.service.catalogue(async store=>{
  const owner=new SampleAnalysisCatalogue(store),source=await owner.source(),member=await owner.member(source.head,'analysis',id);
  const slot='sample-analysis-value:'+member.revision,row=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot);
  await store.db.run('DELETE FROM state WHERE slot=$1',slot);
  await assert.rejects(owner.selected(source,'analysis',id));await assert.rejects(owner.verify(source));
  await store.db.run('INSERT INTO state VALUES ($1,$2)',slot,row.payload);
  const changed={...member,summary:{...member.summary,code:'Unrelated summary'}};await owner.put(source.head,changed,member);await owner.index.flush(source.head.root);
  await assert.rejects(owner.verify(source),{code:'LAB_INVALID'});
  await store.putObject('laboratory',source.head);
 },{write:true});
 await assert.rejects(f.workspace.catalogue(store=>store.verify(catalogueDescriptor(f.book))),{code:'LAB_INVALID'});
});

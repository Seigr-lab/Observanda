import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {Laboratory} from '../src/laboratory.js';
import {SampleAnalysisCatalogue} from '../src/sample-analysis-catalogue.js';
import {sampleAnalysisCollection} from '../src/sample-analysis-collection.js';
import {seedSampleAnalysis} from './sample-analysis-fixture.js';
import {RecordCollectionPages} from '../src/record-collection-pages.js';
import {defaultPanelConfig} from '../src/web/dashboard-model.js';
import {sampleCollectionQuery} from '../src/web/sample-analysis-collection.js';

test('combined sample cards retain one page and no originals at 65 and 650 samples per owner',async t=>{
 for(const count of [65,650]){
  const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-sample-collection-')),owners=[];t.after(async()=>{owners.forEach(o=>clearVault(o.vault));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
  const samples=Array.from({length:count},(_,i)=>({id:randomUUID(),code:'S-'+i,material:'Synthetic',source:'Fixture',collectedOn:'2026-10-01',receivedOn:'2026-10-01'})),analyses=samples.map((sample,i)=>({id:randomUUID(),code:'A-'+i,sampleId:sample.id,result:{method:'Method 1',analyte:'Absorbance',kind:'numeric',value:1,unit:'AU',lower:0,upper:2,notes:'PRIVATE ORIGINAL '.repeat(100)},status:'draft',review:null,updatedAt:'2026-10-01T00:00:00.000Z'}));
  for(let i=0;i<2;i++){await mkdir(path.join(directory,String(i)));const book=sampleNotebook(),f=await encryptedFixture(path.join(directory,String(i)),book);owners.push({...f,workspaceId:book.id,projectId:null,labBookId:null});await new Laboratory(f.workspace).catalogue(store=>seedSampleAnalysis(store,{formatVersion:1,revision:0,samples,analyses,events:[]}),{write:true});}
  const pages=new RecordCollectionPages({reuse:true}),client={},command={workspaceId:owners[0].workspaceId,view:'all',config:defaultPanelConfig(),options:{},mode:'page',key:null,cursor:null,offset:0,limit:25};
  const visit=async(operation,{namespaces}={})=>{for(const owner of owners)if(!namespaces||namespaces.has(owner.workspaceId))await operation(owner.workspace,{workspaceId:owner.workspaceId,projectId:null,labBookId:null});},run=values=>sampleAnalysisCollection(pages,client,{...command,...values},{visit});
  const original=SampleAnalysisCatalogue.prototype.value;let originals=0;t.mock.method(SampleAnalysisCatalogue.prototype,'value',async function(...args){const value=await original.apply(this,args);if(value.result?.notes!==undefined)originals++;return value;});
  const start=performance.now(),first=await run({}),ms=performance.now()-start,bytes=Buffer.byteLength(JSON.stringify(first));assert.equal(first.total,count*2);assert.equal(first.items.length,25);assert.equal(originals,0);assert.ok(ms<5000);assert.ok(bytes<30000);assert.ok(!JSON.stringify(first).includes('PRIVATE ORIGINAL'));
  const next=await run({cursor:first.nextCursor});assert.deepEqual((await run({cursor:next.previousCursor})).items,first.items);assert.equal(new Set([...first.items,...next.items].map(row=>row.collectionKey)).size,50);
  const pinned=await run({key:first.items[0].collectionKey});assert.deepEqual(pinned.items,[first.items[0]]);assert.equal(originals,0);
  await sampleCollectionQuery(async(_route,data)=>run(data),{book:{id:command.workspaceId},outline:true,recordLimit:25},'all');
  const sample=await run({view:'samples'});assert.ok(sample.items.every(row=>row.analyses===1));assert.equal(originals,0);assert.ok(process.memoryUsage().heapUsed<256*1024*1024);
  t.diagnostic(JSON.stringify({samplesPerOwner:count,total:first.total,pageMs:Math.round(ms),bytes,heapMiB:Math.round(process.memoryUsage().heapUsed/1024**2)}));t.mock.restoreAll();
 }
});

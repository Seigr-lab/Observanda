import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {Laboratory} from '../src/laboratory.js';
import {SampleAnalysisReader} from '../src/sample-analysis-reader.js';
import {SampleAnalysisCatalogue} from '../src/sample-analysis-catalogue.js';
import {seedSampleAnalysis} from './sample-analysis-fixture.js';
import {blank} from '../src/sample-analysis-model.js';
import {digest,serialize} from '../src/storage-format.js';
const sample=code=>({code,material:'Synthetic material',source:'',collectedOn:'2026-10-01',receivedOn:'2026-10-01'});
async function fixture(t,count){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-sample-scale-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),lab=blank();
 t.after(async()=>{await clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 for(let i=0;i<count;i++)lab.samples.push({id:randomUUID(),...sample('S-'+i)});
 const service=new Laboratory(f.workspace);await service.catalogue(store=>seedSampleAnalysis(store,lab),{write:true});
 return {...f,book,lab,service,reader:new SampleAnalysisReader(service)};
}

test('a bounded native sample edit advances an old head without reindexing or changing retained history',async t=>{
 const f=await fixture(t,2);let old,etag;
 await f.service.catalogue(async store=>{old=await store.object('laboratory');old.formatVersion=2;etag=digest(serialize(old));await store.putObject('laboratory',old);},{write:true});
 const prior=await f.reader.query({workspaceId:f.book.id,view:'samples'}),saved=await f.service.change({action:'create-sample',etag,sample:sample('S-new')},{compact:true});
 assert.equal(prior.etag,etag);assert.notEqual(saved.etag,etag);
 await f.service.catalogue(async store=>{
  const owner=new SampleAnalysisCatalogue(store),current=await owner.source(),retained=await owner.source(etag);
  assert.equal(current.head.formatVersion,3);assert.deepEqual(retained.head,old);
  assert.deepEqual((await owner.assemble(retained)).samples,f.lab.samples);
  await owner.verify(current);await owner.verify(retained);
 });
 assert.deepEqual((await f.reader.query({workspaceId:f.book.id,view:'samples',cursor:prior.cursor})).items,prior.items);
});

test('more than five thousand retained samples remain editable and directly pageable',async t=>{
 const f=await fixture(t,5001),page=await f.reader.query({workspaceId:f.book.id,view:'samples',offset:4999,limit:25});
 assert.equal(page.total,5001);assert.deepEqual(page.items.map(item=>item.id),f.lab.samples.slice(4999).map(item=>item.id));
 const result=await f.service.change({action:'create-sample',etag:page.etag,sample:sample('S-extra')},{compact:true});
 assert.equal((await f.reader.selected({workspaceId:f.book.id,kind:'sample',id:result.selectedId})).record.code,'S-extra');
 assert.equal((await f.reader.query({workspaceId:f.book.id,view:'samples',offset:5001})).items[0].id,result.selectedId);
 assert.equal((await f.reader.query({workspaceId:f.book.id,view:'samples',offset:Number.MAX_SAFE_INTEGER})).items.length,0);
 await f.service.catalogue(async store=>{const owner=new SampleAnalysisCatalogue(store);await owner.verify(await owner.source());});
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Laboratory} from '../src/laboratory.js';
import {SampleAnalysisReader} from '../src/sample-analysis-reader.js';
import {sampleAnalysisPages} from '../src/web/sample-analysis-pages.js';
import {ProjectDomainCatalogue} from '../src/project-domain-catalogue.js';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {digest,serialize} from '../src/storage-format.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {seedSampleAnalysis} from './sample-analysis-fixture.js';
async function fixture(t,count=65){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-sample-pages-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),lab={formatVersion:1,revision:0,samples:[],analyses:[],events:[]};
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 for(let i=0;i<count;i++)lab.samples.push({id:randomUUID(),code:'S-'+String(i).padStart(4,'0'),material:'Synthetic liquid',source:'Declared fixture',collectedOn:'2026-10-01',receivedOn:'2026-10-01'});
 for(let i=0;i<count*2;i++)lab.analyses.push({id:randomUUID(),code:'A-'+String(i).padStart(4,'0'),sampleId:lab.samples[i%count].id,result:{method:'Optical method 1',analyte:'Absorbance',kind:'numeric',value:i/1000,unit:'AU',lower:0,upper:1,notes:'PRIVATE_RESULT_NOTES'.repeat(100)},status:'draft',review:null,updatedAt:'2026-10-01T00:00:00.000Z'});
 for(let i=0;i<count;i++){const e={id:randomUUID(),recordId:lab.analyses[0].id,action:'save-result',at:'2026-10-01T00:00:00.000Z',actor:'',reason:'Recorded correction '+i,previous:lab.events.at(-1)?.hash??''};lab.events.push({...e,hash:digest(serialize(e))});}lab.revision=lab.events.length;
 await new Laboratory(f.workspace).catalogue(store=>seedSampleAnalysis(store,lab),{write:true});
 const laboratory=new Laboratory(f.workspace.root,f.vault),reader=new SampleAnalysisReader(laboratory);return {...f,directory,book,lab,laboratory,reader};
}
test('65 and 650 sample pages exclude unrelated result bodies; cursors retain their revision and selected reads return only the chosen original',async t=>{
 t.diagnostic(JSON.stringify({platform:process.platform,node:process.version,cpu:os.cpus()[0].model,totalMemoryGiB:Math.round(os.totalmem()/1024**3)}));
 for(const count of [65,650]){
  const f=await fixture(t,count),command={workspaceId:f.book.id,view:'analyses',limit:25},start=performance.now(),first=await f.reader.query(command),ms=performance.now()-start,bytes=Buffer.byteLength(JSON.stringify(first));
  assert.equal(first.total,count*2);assert.equal(first.items.length,25);assert.ok(!JSON.stringify(first).includes('PRIVATE_RESULT_NOTES'));assert.ok(bytes<16000);assert.ok(ms<5000);
  const next=await f.reader.query({...command,cursor:first.nextCursor});assert.equal(next.offset,25);assert.deepEqual((await f.reader.query({...command,cursor:next.previousCursor})).items,first.items);
  const id=f.lab.analyses[0].id,selected=await f.reader.selected({workspaceId:f.book.id,kind:'analysis',id,etag:first.etag});assert.deepEqual(selected.record,f.lab.analyses[0]);assert.equal(selected.sample.id,selected.record.sampleId);assert.equal(selected.lab,undefined);
  const changed=await f.laboratory.change({action:'save-result',id,etag:first.etag,expectedRecordRevision:selected.revision,result:{...selected.record.result,value:9}},{compact:true,commandId:randomUUID()});assert.ok(Buffer.byteLength(JSON.stringify(changed))<250);assert.equal(changed.lab,undefined);
  assert.deepEqual((await f.reader.query({...command,cursor:first.cursor})).items,first.items);assert.equal((await f.reader.query(command)).items[0].result.value,9);
  const history=await f.reader.query({workspaceId:f.book.id,view:'events',recordId:id,limit:20});assert.equal(history.items.length,20);assert.equal(history.total,count+1);assert.ok(history.items.every(e=>e.recordId===id&&!e.previous&&!e.hash));
  const search=await f.reader.query({workspaceId:f.book.id,view:'samples',search:'S-0060',limit:25});assert.equal(search.total,1);assert.equal(search.items[0].analyses,2);
  for(const bad of [{workspaceId:randomUUID()},{view:'samples'},{limit:10},{search:'x'},{sampleId:f.lab.samples[0].id}])await assert.rejects(f.reader.query({...command,cursor:first.nextCursor,...bad}),{code:'INVALID'});
  await assert.rejects(f.reader.query({...command,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
  await assert.rejects(f.reader.query({...command,limit:101}),{code:'INVALID'});await assert.rejects(f.reader.query({...command,cursor:'damaged'}),{code:'INVALID'});
  const controller=new AbortController();controller.abort();await assert.rejects(f.reader.query(command,{signal:controller.signal}),{name:'AbortError'});
  t.diagnostic(JSON.stringify({samples:count,analyses:count*2,pageMs:Math.round(ms),responseBytes:bytes,sourceBytes:Buffer.byteLength(serialize(f.lab))}));
 }
});
test('sample creation retries use an atomic receipt and ordinary or fresh-key restore retains it',async t=>{
 const f=await fixture(t,3),current=await f.laboratory.read(),command={action:'create-sample',etag:current.etag,sample:{...f.lab.samples[0],code:'Unique after lost reply'}};delete command.sample.id;
 const options={compact:true,commandId:randomUUID()},put=ProjectDomainCatalogue.prototype.putObject;
 ProjectDomainCatalogue.prototype.putObject=function(id,...args){if(id==='laboratory-command/'+options.commandId)throw Object.assign(Error('Disk full'),{code:'ENOSPC'});return put.call(this,id,...args);};
 try{await assert.rejects(f.laboratory.change(command,options),{code:'ENOSPC'});}finally{ProjectDomainCatalogue.prototype.putObject=put;}
 assert.equal((await f.laboratory.read()).etag,current.etag);assert.equal(await f.laboratory.catalogue(s=>s.object('laboratory-command/'+options.commandId)),null);
 const saved=await f.laboratory.change(command,options);assert.deepEqual(await f.laboratory.change(command,options),saved);assert.equal((await f.laboratory.read()).lab.samples.length,4);
 await assert.rejects(f.laboratory.change({...command,sample:{...command.sample,code:'Changed retry'}},options),{code:'LAB_STALE'});
 const backup=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'backup')),{vault:f.vault});assert.deepEqual(await new Laboratory(backup,f.vault).change(command,options),saved);
 const access=await createAccess('','sample paging fresh key'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'fresh')),access,vault,f.vault);assert.deepEqual(await new Laboratory(fresh,vault).change(command,options),saved);
});
test('sample page owners retain the valid page after failure and ignore cancelled, invalid and old-workspace replies',async()=>{
 const workspaceId=randomUUID(),command={workspaceId,view:'samples',limit:25},value={workspaceId,view:'samples',etag:'new',items:[],total:0,offset:0,cursor:'first',previousCursor:null,nextCursor:null,counts:{samples:0,analyses:0,review:0,archive:0,approved:0,events:0}};let response=value,context='first',release,wait=false;const calls=[];
 const pages=sampleAnalysisPages({context:()=>context,onChange:()=>{},api:async(path,query,options)=>{calls.push(options);if(wait)await new Promise(r=>release=r);if(response instanceof Error)throw response;return response;}});
 assert.equal(await pages.load(command),true);response=Error('Disconnected');assert.equal(await pages.load(command),false);assert.equal(pages.page,value);assert.equal(pages.error.message,'Disconnected');
 response={...value,workspaceId:randomUUID()};assert.equal(await pages.retry(),false);assert.equal(pages.page,value);
 response=value;wait=true;const pending=pages.load(command);await new Promise(setImmediate);context='second';pages.clear();assert.equal(calls.at(-1).signal.aborted,true);release();await pending;assert.equal(pages.page,null);assert.equal(pages.loading,false);pages.stop();
});

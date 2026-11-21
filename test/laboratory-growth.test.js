import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {Laboratory} from '../src/laboratory.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {digest,serialize} from '../src/storage-format.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {seedSampleAnalysis,sampleDecimal} from './sample-analysis-fixture.js';
const instant='2026-10-01T00:00:00.000Z';
function corpus(samples,analyses=samples*2,events=samples*8){
 const lab={formatVersion:1,revision:events,samples:[],analyses:[],events:[]};
 for(let i=0;i<samples;i++)lab.samples.push({id:randomUUID(),code:'S-'+i,material:'Synthetic material',source:'Test fixture',collectedOn:'2026-10-01',receivedOn:'2026-10-01'});
 for(let i=0;i<analyses;i++)lab.analyses.push({id:randomUUID(),code:'A-'+i,sampleId:lab.samples[i%samples].id,result:{method:'Synthetic method 1',analyte:'Test measurement',kind:'numeric',numericVersion:2,value:sampleDecimal(String(i)),unit:'V',lower:null,upper:null,notes:''},status:'draft',review:null,updatedAt:instant});
 for(let i=0;i<events;i++){const event={id:randomUUID(),at:instant,action:'save-result',recordId:lab.analyses[i%analyses].id,actor:'',reason:'',previous:lab.events.at(-1)?.hash??''};lab.events.push({...event,hash:digest(serialize(event))});}
 return lab;
}
async function fixture(t,lab){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-laboratory-growth-')),f=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{await clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 await new Laboratory(f.workspace).catalogue(store=>seedSampleAnalysis(store,lab),{write:true});
 return {...f,directory,service:new Laboratory(f.workspace.root,f.vault)};
}

test('sample-analysis store qualifies 65 and 650 samples through save, review, retained report and restore',async t=>{
 t.diagnostic(JSON.stringify({platform:process.platform,node:process.version,cpu:os.cpus()[0].model,totalMemoryGiB:Math.round(os.totalmem()/1024**3)}));
 for(const count of [65,650]){
  const source=corpus(count),f=await fixture(t,source),start=performance.now(),opened=await f.service.read(),readMs=performance.now()-start,id=source.analyses.at(-1).id;
  const before=performance.now(),submitted=await f.service.change({action:'save-and-submit',etag:opened.etag,expectedRecordRevision:opened.recordRevisions[id],id,result:{...source.analyses.at(-1).result,value:sampleDecimal('0.125')}}),editMs=performance.now()-before;
  assert.ok(readMs<5000);assert.ok(editMs<10000);assert.equal(submitted.lab.analyses.at(-1).status,'in review');assert.deepEqual(submitted.lab.analyses.at(-1).result.value,sampleDecimal('0.125'));assert.deepEqual(submitted.lab.analyses.slice(0,-1),source.analyses.slice(0,-1));
  const approved=await f.service.change({action:'review',etag:submitted.etag,id,reviewer:'Synthetic reviewer',comment:'Checked against the retained source',decision:'approve',checked:true});
  await f.service.change({action:'amend',etag:approved.etag,id,reason:'Test a subsequent correction'});
  assert.match(await f.service.report(id,approved.etag,[],{retained:true}),/<td>0\.125<\/td>/);
  await assert.rejects(f.service.change({action:'submit',etag:opened.etag,expectedRecordRevision:opened.recordRevisions[id],id}),{code:'LAB_STALE'});
  const current=await f.service.read(),backup=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'backup'),{vault:f.vault}),{vault:f.vault});
  assert.deepEqual(await new Laboratory(backup,f.vault).read(),current);
  const access=await createAccess('','fresh sample-analysis key'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
  const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'fresh'),{vault:f.vault}),access,vault,f.vault);
  assert.deepEqual(await new Laboratory(fresh,vault).read(),current);assert.match(await new Laboratory(fresh,vault).report(id,approved.etag,[],{retained:true}),/<td>0\.125<\/td>/);
  t.diagnostic(JSON.stringify({samples:count,analyses:source.analyses.length,events:source.events.length,bytes:Buffer.byteLength(serialize(source)),readMs:Math.round(readMs),editMs:Math.round(editMs)}));
 }
});

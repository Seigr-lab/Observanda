import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {EvidenceFileChoices} from '../src/evidence-file-choices.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {Workspace} from '../src/storage.js';
import {clearVault} from '../src/encryption.js';
import {digest} from '../src/storage-format.js';
import {fileFingerprint} from '../src/web/evidence-fingerprint.js';
import {registerFileManifest} from '../src/web/evidence-file-selection.js';
import {contentBuffer} from '../src/file-content.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';

test('an indexed file set grows past 10000 acquisitions and retains every association through attachment and backup',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-intake-count-')),f=await encryptedFixture(directory,sampleNotebook()),materials=new ResearchMaterials(f.workspace),jobs=workspaceJobs(f.workspace);
 t.after(async()=>{await jobs.worker.stop();clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const owner=(await f.workspace.read()).book.entries[0].id;
 const count=10017,fingerprint=await fileFingerprint(0,[],digest),choices=new EvidenceFileChoices(f.workspace),started=performance.now();let source={recordId:owner,selection:null,count:0,bytes:0};
 const descriptor=i=>({name:'reading-'+String(i).padStart(6,'0')+'.txt',size:0,fingerprint,sourcePath:'capture/window-'+String(Math.floor(i/37)).padStart(4,'0')+'/reading-'+String(i).padStart(6,'0')+'.txt'});
 for(let offset=0;offset<count;offset+=64){
  const items=Array.from({length:Math.min(64,count-offset)},(_,i)=>descriptor(offset+i));
  source={recordId:owner,...await choices.append({...source,offset,items})};assert.equal(source.count,offset+items.length);
 }
 const selected=performance.now(),tail=await choices.page({...source,offset:count-3});assert.equal(tail.items.length,3);assert.deepEqual(tail.items.map(v=>v.ordinal),[count-3,count-2,count-1]);
 let batch=await materials.intakes.start({recordId:owner,title:'Long acquisition set',count,bytes:0,sourceMode:'folder',purpose:'current-return'});
 const call=(operation,command)=>operation==='intake-selection-page'?choices.page(command):operation==='intake-append'?materials.intakes.append(command):materials.intakes.page(command);
 batch=await registerFileManifest(call,batch,source);assert.equal(batch.registered,count);assert.equal(batch.ready,count);
 // Reopening retains direct access after the former ceiling.
 const reloaded=new ResearchMaterials(new Workspace(f.workspace.root,f.vault)),late=await reloaded.intakes.page({id:batch.id,offset:10000,limit:20});assert.equal(late.items.length,17);assert.equal(late.next,null);
 const registered=performance.now();assert.equal((await materials.list({recordId:owner})).items.length,0);
 await materials.intakes.enqueue(batch.id,jobs.queue);jobs.worker.enabled=true;
 try{await jobs.worker.runOnce();}finally{jobs.worker.enabled=false;}
 const job=await jobs.queue.read(batch.id);assert.equal(job.state,'completed',JSON.stringify(job));const attached=performance.now(),doc=await materials.read(job.result);
 assert.equal(doc.content.inputsIndex.count,count);assert.ok(Buffer.byteLength(JSON.stringify(doc))<4096);
 let verified=0;
 await materials.readSnapshot(async()=>{for await(const ref of materials.references(doc.content)){
  const original=await materials.read(ref);assert.equal(original.content.sourcePath,descriptor(verified).sourcePath);assert.equal(original.content.name,descriptor(verified).name);
  assert.equal(original.content.size,0);assert.equal(original.content.sha256,digest(Buffer.alloc(0)));assert.equal(original.recordId,owner);assert.equal(original.content.sourcePurpose,'current-return');verified++;
 }});assert.equal(verified,count);
 const reference=(await materials.referencePage(job.result,{offset:count-1,limit:1})).items[0];assert.equal((await contentBuffer((await materials.artifact(reference)).content)).length,0);
 const copied=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'backup')),{vault:f.vault}),restored=new ResearchMaterials(new Workspace(copied,f.vault));
 assert.equal((await restored.read(job.result)).content.inputsIndex.count,count);assert.equal((await restored.intakes.page({id:batch.id,offset:count-1})).items[0].sourcePath,descriptor(count-1).sourcePath);
 assert.equal((await contentBuffer((await restored.artifact(reference)).content)).length,0);
 t.diagnostic(JSON.stringify({files:count,selectionMs:Math.round(selected-started),registrationMs:Math.round(registered-selected),attachmentMs:Math.round(attached-registered),totalMs:Math.round(performance.now()-started)}));
});

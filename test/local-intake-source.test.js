import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,rm,rename,stat,utimes} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {inspectIntake} from '../src/intake/source.js';
import {INTAKE_MANIFEST} from '../src/intake/contract.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t,{count=2,size=128*1024}={}){
 const temporary=await realpath(os.tmpdir()),root=await mkdtemp(path.join(temporary,'observanda-intake-source-'));
 t.after(async()=>{assert.equal(path.dirname(root),temporary);assert.ok(path.basename(root).startsWith('observanda-intake-source-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const files=[];for(let i=0;i<count;i++){const bytes=Buffer.alloc(size,i+1),file={id:randomUUID(),path:'source-'+i+'.bin',size,sha256:hash(bytes),provenance:'Synthetic acquisition'};files.push(file);await writeFile(path.join(root,file.path),bytes);}
 const manifest={version:1,id:randomUUID(),workspaceId:randomUUID(),recordId:randomUUID(),expectedRevision:hash('revision'),purpose:'evidence',title:'Synthetic sources',files,analyses:[],source:{revision:'synthetic',sha256:hash('source')},verification:{tool:'test',version:'1',sha256:hash('validator'),statement:'Synthetic verification'}};
 await writeFile(path.join(root,INTAKE_MANIFEST),JSON.stringify(manifest));return {root,manifest};
}
function checkpoints(){
 let saved;
 return {get value(){return saved;},async checkpoint(next){const files=new Map((saved?.manifestStamp===next.manifestStamp?saved.files:[]).map(file=>[file.id,file]));for(const file of next.files)files.set(file.id,file);saved={...next,files:[...files.values()]};}};
}
test('completed validation checkpoints reuse stable source identities and declared digests',async t=>{
 const f=await fixture(t,{size:2*1024*1024}),saved=checkpoints();let reads=0;
 const report=await inspectIntake(f.root,{checkpoint:saved.checkpoint,progress:async()=>reads++});assert.equal(reads,64);assert.equal(saved.value.files.length,2);
 let resumed=0,writes=0;const again=await inspectIntake(f.root,{expectedPin:report.pin,verification:saved.value,checkpoint:async()=>writes++,progress:async()=>resumed++});
 assert.equal(resumed,2);assert.equal(writes,0);assert.deepEqual(again,report);
 // Restoring mtime does not restore ctime or replace the checked identity.
 const filename=path.join(f.root,f.manifest.files[0].path),before=await stat(filename);await writeFile(filename,Buffer.alloc(f.manifest.files[0].size,9));await utimes(filename,before.atime,before.mtime);
 await assert.rejects(inspectIntake(f.root,{expectedPin:report.pin,verification:saved.value}),{code:'INTAKE_CHANGED'});
});
test('mismatched manifest and digest checkpoint hints require full verification',async t=>{
 const f=await fixture(t),saved=checkpoints();await inspectIntake(f.root,{checkpoint:saved.checkpoint});
 for(const change of [v=>v.pin=hash('other manifest'),v=>v.manifestStamp='other identity',v=>v.files.forEach(file=>file.sha256=hash('other digest')),v=>v.files.push(v.files[0])]){
  const verification=structuredClone(saved.value);change(verification);let chunks=0;
  await inspectIntake(f.root,{verification,progress:async()=>chunks++});assert.equal(chunks,4);
 }
});
test('interrupted validation retains at most 32 completed file proofs per checkpoint and resumes them',async t=>{
 const f=await fixture(t,{count:34,size:1024}),saved=checkpoints(),batches=[];
 await assert.rejects(inspectIntake(f.root,{checkpoint:async value=>{batches.push(value.files.length);await saved.checkpoint(value);},progress:async p=>{if(p.done>32*1024)throw Error('Interrupted validation');}}),/Interrupted validation/);
 assert.deepEqual(batches,[32]);assert.equal(saved.value.files.length,32);
 const resumed=[];await inspectIntake(f.root,{verification:saved.value,checkpoint:async value=>{resumed.push(...value.files.map(file=>file.id));await saved.checkpoint(value);}});
 assert.deepEqual(resumed,f.manifest.files.slice(32).map(file=>file.id));assert.equal(saved.value.files.length,34);
});
test('an earlier verified source changed while a later file is read invalidates the report',async t=>{
 const f=await fixture(t),first=f.manifest.files[0];let changed=false;
 await assert.rejects(inspectIntake(f.root,{progress:async p=>{if(!changed&&p.done>first.size){changed=true;await writeFile(path.join(f.root,first.path),Buffer.alloc(first.size,7));}}}),{code:'INTAKE_CHANGED'});assert.equal(changed,true);
});
test('completed large captures are checkpointed before a later file can interrupt verification',async t=>{
 const size=8*1024*1024,f=await fixture(t,{size}),saved=checkpoints();
 await assert.rejects(inspectIntake(f.root,{checkpoint:saved.checkpoint,progress:async p=>{if(p.done>size)throw Error('Interrupted next capture');}}),/Interrupted next capture/);
 assert.equal(saved.value.files.length,1);assert.equal(saved.value.files[0].id,f.manifest.files[0].id);
 const resumed=[];await inspectIntake(f.root,{verification:saved.value,checkpoint:async value=>resumed.push(...value.files.map(file=>file.id))});assert.deepEqual(resumed,[f.manifest.files[1].id]);
});
test('a source replacement during hashing or a change during checkpoint persistence cannot pass',async t=>{
 const f=await fixture(t),first=f.manifest.files[0];let changed=false;
 await assert.rejects(inspectIntake(f.root,{progress:async()=>{if(changed)return;changed=true;const filename=path.join(f.root,first.path);await rename(filename,filename+'.old');await writeFile(filename,Buffer.alloc(first.size,1));}}),{code:'INVENTORY_CHANGED'});
 const saved=checkpoints();await inspectIntake(f.root,{checkpoint:saved.checkpoint});
 await assert.rejects(inspectIntake(f.root,{checkpoint:async()=>{await writeFile(path.join(f.root,first.path),Buffer.alloc(first.size,8));}}),{code:'INTAKE_CHANGED'});
});
test('aborted cached verification cannot return a completed report',async t=>{
 const f=await fixture(t),saved=checkpoints();await inspectIntake(f.root,{checkpoint:saved.checkpoint});const controller=new AbortController();
 await assert.rejects(inspectIntake(f.root,{verification:saved.value,signal:controller.signal,progress:async()=>controller.abort(new Error('Stopped'))}),/Stopped/);
});

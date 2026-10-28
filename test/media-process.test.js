import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {convertMedia,mediaCommand} from '../src/media.js';
import {unseal} from '../src/encryption.js';
import {defaultMediaPolicy} from '../src/media-policy.js';
import {NativeMediaAdmission} from '../src/native-media-admission.js';
import {spawn} from 'node:child_process';
import {OperationalDiagnostics,withDiagnostics} from '../src/operational-diagnostics.js';

test('an input construction failure drains the launched converter before returning capacity', {timeout:10000},async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-media-input-failure-'));let child,closed=false,parserDirectory;
 t.after(async()=>{if(child&&!closed){child.kill('SIGKILL');await new Promise(resolve=>child.once('close',resolve));}await rm(root,{recursive:true,force:true});});
 const sink=new OperationalDiagnostics(),admission=new NativeMediaAdmission({active:1,memoryBytes:1024,reserveBytes:1,available:()=>10000});
 const failure=Object.assign(Error('synthetic private input location'),{code:'EIO'}),workspace={vault:{},requireStorageKey:async()=>{}};
 const input={stream(){assert.ok(child?.pid);throw failure;}},spawnProcess=(...args)=>{
  parserDirectory=args[2].cwd;child=spawn(...args);child.once('close',()=>{assert.equal(admission.stats().active,1,'capacity was released before child closure');closed=true;});return child;
 };
 await assert.rejects(withDiagnostics(sink,()=>convertMedia(['-e','setInterval(()=>{},1000)'],workspace,path.join(root,'prepared'),defaultMediaPolicy(),null,{binary:process.execPath,input,admission,reservationBytes:512,spawnProcess})),error=>error===failure);
 assert.equal(closed,true);assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});assert.equal(admission.stats().active,0);
 assert.deepEqual(await readdir(root),[]);await assert.rejects(readdir(parserDirectory),{code:'ENOENT'});
 const {entries}=await sink.snapshot(),phases=entries.filter(row=>row.phase==='convert-media');assert.equal(phases.length,1);assert.equal(phases[0].code,'EIO');assert.doesNotMatch(JSON.stringify(entries),/synthetic private input location/);
});

test('a fast child cannot lose output while encrypted storage is still opening', {timeout:10000},async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-fast-media-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const output=path.join(root,'prepared'),payload=Buffer.alloc(1024,93),key=randomBytes(32),aad='synthetic encrypted output';
 const workspace={vault:{key},fileAAD:()=>aad,requireStorageKey:()=>delay(750)};
 const result=await convertMedia(['-e','process.stdout.write(Buffer.alloc(1024,93))'],workspace,output,defaultMediaPolicy(),null,{binary:process.execPath});
 assert.equal(result.size,payload.length);assert.equal(result.sha256,createHash('sha256').update(payload).digest('hex'));
 assert.deepEqual(unseal(await readFile(output),key,aad),payload);
});

test('conversion limits keep their cause when backpressure tears down the output pipeline', {timeout:10000},async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-limit-media-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const workspace={vault:{},requireStorageKey:async()=>{}},output=path.join(root,'prepared');
 await assert.rejects(convertMedia(['-e','process.stdout.write(Buffer.alloc(1024*1024))'],workspace,output,{...defaultMediaPolicy(),maxPreparedBytes:10},null,{binary:process.execPath}),{code:'MEDIA_LIMIT'});
 assert.deepEqual(await readdir(root),[]);
});
test('cancelling a running conversion releases its child and removes the unfinished encrypted write', {timeout:10000},async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-cancel-media-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const marker=path.join(root,'ready'),controller=new AbortController(),workspace={vault:{},requireStorageKey:async()=>{}};
 const code="require('node:fs').writeFileSync(process.argv[1],String(process.pid));process.stdout.write(Buffer.alloc(1024));setInterval(()=>{},1000)";
 const pending=convertMedia(['-e',code,marker],workspace,path.join(root,'prepared'),defaultMediaPolicy(),controller.signal,{binary:process.execPath});
 const rejected=assert.rejects(pending,error=>error.name==='AbortError');
 let pid;for(let n=0;n<100;n++){try{pid=Number(await readFile(marker,'utf8'));break;}catch{await delay(20);}}
 assert.ok(pid);controller.abort();await rejected;
 assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});assert.deepEqual(await readdir(root),['ready']);
});
test('probe commands honour cancellation and a configured timeout', {timeout:10000},async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-probe-media-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const marker=path.join(root,'ready'),controller=new AbortController();
 const code="require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)";
 const pending=mediaCommand(process.execPath,['-e',code,marker],0,{signal:controller.signal}),rejected=assert.rejects(pending,error=>error.name==='AbortError');
 let pid;for(let n=0;n<100;n++){try{pid=Number(await readFile(marker,'utf8'));break;}catch{await delay(20);}}
 assert.ok(pid);controller.abort();await rejected;
 // execFile cancellation reports early; the OS must still terminate its process.
 for(let n=0;n<100;n++){try{process.kill(pid,0);await delay(10);}catch{break;}}
 assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 await assert.rejects(mediaCommand(process.execPath,['-e','setInterval(()=>{},1000)'],100),{code:'MEDIA_LIMIT'});
});

test('stalled converters exit before releasing capacity and never finalize their partial output', {timeout:15000},async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-stalled-media-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const marker=path.join(root,'ready'),workspace={vault:{},requireStorageKey:async()=>{}},admission=new NativeMediaAdmission({active:1,memoryBytes:1024,reserveBytes:1,available:()=>10000});
 const code="require('node:fs').writeFileSync(process.argv[1],String(process.pid));process.stdout.write(Buffer.alloc(1024));setInterval(()=>{},1000)";
 await assert.rejects(convertMedia(['-e',code,marker],workspace,path.join(root,'prepared'),defaultMediaPolicy(),null,{binary:process.execPath,admission,reservationBytes:512,stallMs:2000}),{code:'MEDIA_LIMIT'});
 const pid=Number(await readFile(marker,'utf8'));assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});assert.deepEqual(await readdir(root),['ready']);assert.equal(admission.stats().active,0);
});

test('a converter that emits bytes but exits unsuccessfully cannot finalize a display copy',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-failed-media-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const workspace={vault:{},requireStorageKey:async()=>{}};
 await assert.rejects(convertMedia(['-e','process.stdout.write(Buffer.alloc(1024));process.exitCode=1'],workspace,path.join(root,'prepared'),defaultMediaPolicy(),null,{binary:process.execPath}),{code:'MEDIA_INVALID'});assert.deepEqual(await readdir(root),[]);
});

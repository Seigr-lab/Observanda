import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawn} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {runPdfValidator} from '../src/pdf-validator-process.js';
import {NativeMediaAdmission} from '../src/native-media-admission.js';
import {NativeResourceBudget} from '../src/native-resource-budget.js';
import {OperationalDiagnostics,withDiagnostics} from '../src/operational-diagnostics.js';

const MiB=1024*1024,directory=os.tmpdir(),runtime={java:process.execPath,jar:path.join(directory,'validator.jar')},file=path.join(directory,'document.pdf');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function processHarness(){
 let released=0,request;const killed=[],child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=signal=>{killed.push(signal);return true;};
 return {child,killed,released:()=>released,request:()=>request,options:{admission:{acquire:async bytes=>{assert.equal(bytes,640*MiB);return ()=>released++;}},spawnProcess:(...args)=>{request=args;return child;}}};
}

test('PDF validator receives only its private working environment and fixed profile arguments',async t=>{
 const key='OBSERVANDA_SYNTHETIC_PRIVATE_TOKEN',previous=process.env[key];process.env[key]='synthetic-private-token';
 t.after(()=>{if(previous===undefined)delete process.env[key];else process.env[key]=previous;});
 const h=processHarness(),task=runPdfValidator(runtime,file,directory,{profile:'2u',...h.options});await tick();
 const [exe,args,options]=h.request();assert.equal(exe,runtime.java);assert.equal(options.cwd,directory);assert.equal(options.windowsHide,true);assert.equal(options.shell,undefined);assert.deepEqual(options.stdio,['ignore','pipe','pipe']);
 assert.equal(args[args.indexOf('--flavour')+1],'2u');assert.equal(args.at(-1),file);assert.ok(args.includes('-Xmx512m'));
 assert.deepEqual(Object.keys(options.env).sort(),['PATH','HOME','USERPROFILE','TMPDIR','TEMP','TMP','LANG','LC_ALL',...(process.platform==='win32'?['SystemRoot','WINDIR']:[])].sort());
 assert.equal(options.env.HOME,directory);assert.equal(options.env.PATH,path.dirname(runtime.java));assert.equal(options.env[key],undefined);
 h.child.stdout.write('{"report":');h.child.stdout.write('true}');h.child.emit('close',0);assert.equal(await task,'{"report":true}');assert.equal(h.released(),1);
});

for(const stream of ['stdout','stderr'])test('PDF validator '+stream+' overflow rejects only after process closure',async()=>{
 const h=processHarness(),task=runPdfValidator(runtime,file,directory,{profile:'ua1',...h.options}),rejected=assert.rejects(task,{code:'PDF_ACCESSIBILITY_FAILED'});await tick();
 h.child[stream].write(Buffer.alloc((stream==='stdout'?2*MiB:256*1024)+1));
 assert.deepEqual(h.killed,['SIGKILL']);assert.equal(h.released(),0);
 h.child.stdout.write(Buffer.alloc(1024));h.child.stderr.write(Buffer.alloc(1024));assert.deepEqual(h.killed,['SIGKILL']);
 h.child.emit('close',null);await rejected;assert.equal(h.released(),1);
});

test('cancellation retains admission and redacts diagnostics until the validator has exited',async()=>{
 const h=processHarness(),controller=new AbortController(),sink=new OperationalDiagnostics();
 const reason=Object.assign(Error('synthetic private document location'),{code:'ABORT_ERR'});
 const task=withDiagnostics(sink,()=>runPdfValidator(runtime,file,directory,{profile:'2u',signal:controller.signal,...h.options})),rejected=assert.rejects(task,error=>error===reason);await tick();
 controller.abort(reason);await tick();assert.deepEqual(h.killed,['SIGKILL']);assert.equal(h.released(),0);
 h.child.emit('close',null);await rejected;assert.equal(h.released(),1);
 const {entries}=await sink.snapshot();assert.equal(entries.length,1);assert.equal(entries[0].phase,'validate-pdf');assert.equal(entries[0].code,'ABORT_ERR');assert.ok(entries[0].durationMs>=0);assert.doesNotMatch(JSON.stringify(entries),/synthetic|document|validator\.jar/);
});

test('validator admission accounts for database reservations and queued cancellation launches no process',async()=>{
 const budget=new NativeResourceBudget({memoryBytes:1024*MiB,runtimeLimit:2,reserveBytes:MiB,available:()=>4096*MiB}),admission=new NativeMediaAdmission({active:1,queued:1,memoryBytes:1024*MiB,reserveBytes:MiB,available:()=>4096*MiB,budget});
 const database=budget.reserve('database',512*MiB),spawnProcess=()=>assert.fail('Refused work must not launch');
 await assert.rejects(runPdfValidator(runtime,file,directory,{profile:'2u',admission,spawnProcess}),{code:'WORKLOAD_BUSY'});database.release();
 const release=await admission.acquire(64*MiB),controller=new AbortController();
 const task=runPdfValidator(runtime,file,directory,{profile:'2u',admission,spawnProcess,signal:controller.signal}),rejected=assert.rejects(task,{name:'AbortError'});await tick();assert.equal(admission.stats().queued,1);
 controller.abort();await rejected;assert.equal(admission.stats().queued,0);assert.equal(admission.stats().active,1);release();assert.equal(budget.stats().reservedBytes,0);
});

test('validator spawn errors and profile-specific exit codes cannot produce a successful receipt',async()=>{
 for(const [profile,exit,error] of [['2u',1,'PDF_ARCHIVAL_FAILED'],['ua1',1,null],['ua1',2,'PDF_ACCESSIBILITY_FAILED']]){
  const h=processHarness(),task=runPdfValidator(runtime,file,directory,{profile,...h.options});await tick();h.child.stdout.write('report');h.child.emit('close',exit);
  if(error)await assert.rejects(task,{code:error});else assert.equal(await task,'report');assert.equal(h.released(),1);
 }
 const h=processHarness(),task=runPdfValidator(runtime,file,directory,{profile:'2u',...h.options}),rejected=assert.rejects(task,{code:'PDF_ARCHIVAL_UNAVAILABLE'});await tick();h.child.emit('error',Error('private executable path'));assert.equal(h.released(),0);h.child.emit('close',-1);await rejected;assert.equal(h.released(),1);
 const cancelled=processHarness(),controller=new AbortController();
 const aborted=runPdfValidator(runtime,file,directory,{profile:'2u',signal:controller.signal,...cancelled.options}),stopped=assert.rejects(aborted,error=>error===null);await tick();controller.abort(null);cancelled.child.emit('close',0);await stopped;assert.equal(cancelled.released(),1);
});

test('a real validator process ignoring polite termination is killed and reaped on cancellation',{timeout:10000},async()=>{
 const controller=new AbortController();let child,closed=false,released=false;
 const task=runPdfValidator(runtime,file,directory,{profile:'2u',signal:controller.signal,admission:{acquire:async()=>()=>{assert.equal(closed,true);released=true;}},spawnProcess:(_exe,_args,options)=>{
  child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000);"],options);
  child.once('close',()=>{closed=true;});child.stdout.once('data',()=>controller.abort());return child;
 }});
 try{await assert.rejects(task,{name:'AbortError'});assert.equal(closed,true);assert.equal(released,true);}
 finally{if(child&&!closed)child.kill('SIGKILL');}
});

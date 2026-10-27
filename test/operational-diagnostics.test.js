import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,stat,writeFile,symlink,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {OperationalDiagnostics,diagnosticEvent,withDiagnostics,diagnostic,diagnosticPhase,diagnosticMeasurement,independentDiagnostics} from '../src/operational-diagnostics.js';

test('database timings aggregate once per request without crossing concurrent or completed requests',async()=>{
 const sink=new OperationalDiagnostics(),a=Promise.withResolvers(),b=Promise.withResolvers();
 const first=withDiagnostics(sink,async()=>{const end=diagnosticMeasurement('database-query');a.resolve();await b.promise;end();end();diagnostic('request',{route:'records'});});
 await a.promise;
 await withDiagnostics(sink,async()=>{for(let i=0;i<3;i++)diagnosticMeasurement('database-connect')();const late=diagnosticMeasurement('database-query');diagnostic('request',{route:'websites'});late();});
 b.resolve();await first;
 const {entries}=await sink.snapshot(),web=entries.find(row=>row.route==='websites'),record=entries.find(row=>row.route==='records');
 assert.equal(entries.length,2);assert.equal(web.databaseConnections,3);assert.equal(web.databaseQueries,undefined);assert.equal(record.databaseQueries,1);assert.equal(record.databaseConnections,undefined);assert.notEqual(web.correlation,record.correlation);assert.ok(record.databaseQueryMs>=0);
});

test('independent worker diagnostics retain the recorder without inheriting request measurements',async()=>{
 const sink=new OperationalDiagnostics();
 await withDiagnostics(sink,async()=>{
  diagnosticMeasurement('database-connect')();
  await independentDiagnostics(async()=>{diagnosticMeasurement('database-query')();diagnostic('request',{route:'publication-jobs'});});
  diagnostic('request',{route:'websites'});
 });
 const {entries}=await sink.snapshot();assert.equal(entries.length,2);assert.notEqual(entries[0].correlation,entries[1].correlation);assert.equal(entries[0].databaseQueries,1);assert.equal(entries[0].databaseConnections,undefined);assert.equal(entries[1].databaseConnections,1);assert.equal(entries[1].databaseQueries,undefined);
});

test('operational diagnostics accept only categorized fields and correlated timings',async()=>{
 const sink=new OperationalDiagnostics(),secret='private-sentinel-password';
 await withDiagnostics(sink,async()=>{
  diagnostic('request',{route:'records',method:'POST',durationMs:12.8,path:secret,message:secret,error:{code:'ENOSPC',message:secret,stack:secret},queued:Infinity});
  await assert.rejects(diagnosticPhase('waiting-writer',async()=>{throw {code:'LOCKED',message:secret};}),{code:'LOCKED'});
 });
 const report=await sink.snapshot();assert.equal(report.entries.length,2);assert.equal(report.entries[0].code,'ENOSPC');assert.equal(report.entries[0].durationMs,13);assert.equal(report.entries[0].correlation,report.entries[1].correlation);
 assert.doesNotMatch(JSON.stringify(report),new RegExp(secret+'|Infinity|stack|message'));
 assert.equal(diagnosticEvent(secret),null);assert.equal(diagnosticEvent('request',{error:{code:secret},phase:secret,route:secret,method:secret}).code,'IO');
});
test('diagnostic floods have bounded pending memory and rotate within a fixed disk budget',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-diagnostics-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const sink=new OperationalDiagnostics({directory,maxBytes:1024,files:3,maxPending:8});
 for(let i=0;i<10000;i++)sink.record('request',{durationMs:i});
 assert.equal(sink.pending.length,8);assert.equal(sink.recent.length,8);assert.equal(sink.dropped,9992);await sink.flush();
 for(let i=0;i<70;i++){sink.record('resource',{rssBytes:1234});await sink.flush();}
 const files=await readdir(directory);assert.equal(files.length,3);let bytes=0;for(const file of files){const size=(await stat(path.join(directory,file))).size;assert.ok(size<=1024);bytes+=size;}assert.ok(bytes<=3072);
 const report=await sink.snapshot();assert.ok(report.entries.length>0);assert.equal(report.status.available,true);await sink.close();sink.record('request');assert.equal(sink.pending.length,0);
});
test('export sanitizes disk records again and refuses files outside the diagnostic directory',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-diagnostic-export-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const directory=path.join(root,'logs');await mkdir(directory);
 await writeFile(path.join(directory,'operations-0.jsonl'),JSON.stringify({event:'request',time:'private-time',path:'private-path',code:'ENOSPC',message:'private-body'})+'\n');
 const sink=new OperationalDiagnostics({directory});const report=await sink.snapshot();assert.equal(report.entries[0].code,'ENOSPC');assert.doesNotMatch(JSON.stringify(report),/private-/);
 const outside=path.join(root,'outside');await mkdir(outside);const linked=path.join(root,'linked');await symlink(outside,linked,process.platform==='win32'?'junction':'dir');
 const invalid=new OperationalDiagnostics({directory:linked});invalid.record('request');await invalid.flush();assert.equal(invalid.status().available,false);assert.deepEqual(await readdir(outside),[]);
});

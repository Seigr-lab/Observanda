import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {inspectSource} from '../src/migration/runner.js';
import {migrationGrowthFixture} from './migration-growth-fixture.js';
import {propagateInventoryFailures} from '../src/migration/dependencies.js';

test('tenfold physical source inventory accounts for every byte within declared inspection budgets',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-inventory-growth-'));
 t.after(()=>rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
 const expected=await migrationGrowthFixture(root),report=await inspectSource({source:root});
 assert.equal(report.complete,true);for(const [key,value]of Object.entries(expected))assert.equal(report.counts[key],value,key);
 assert.equal(report.objects.filter(o=>o.kind==='run').length,700);
 assert.equal(report.files.filter(f=>f.bytes===96*1024*1024).length,10);
 assert.equal(report.objects.filter(o=>o.id.endsWith(':observations')&&o.files[0].verification.status==='verified').length,10);
 assert.ok(report.inspection.durationMs<120000,'tenfold inventory completes within two minutes');
 assert.ok(report.inspection.peakMemoryBytes<256*1024*1024,'worker memory remains within 256 MiB while hashing 3.9 GiB');
 t.diagnostic(JSON.stringify({workload:'A1 tenfold physical source',platform:process.platform,architecture:process.arch,cpu:os.cpus()[0].model,totalMemoryGiB:Math.round(os.totalmem()/1024**3),files:report.counts.files,bytes:report.counts.bytes,...report.inspection}));
});
test('failure propagation visits links once across long reversed chains and cycles',()=>{
 let visited=0;
 const objects=Array.from({length:10000},(_,i)=>({id:'source-'+i,revision:'r1',disposition:'map',status:i===9999?'missing':'mapped',
  get links(){visited++;return [{id:'source-'+((i+1)%10000),revision:'r1',type:'derived-from',required:true}];}}));
 propagateInventoryFailures(objects,(object,code,message)=>{object.status='conflict';object.issue={code,message};});
 assert.ok(objects.every(o=>['conflict','missing'].includes(o.status)));assert.equal(visited,10000);
});

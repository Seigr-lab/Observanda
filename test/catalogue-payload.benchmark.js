import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {scratchDatabase} from '../src/postgres.js';
import {cataloguePayloadRows} from '../src/catalogue-payload-rows.js';
import {OperationalDiagnostics,withDiagnostics,diagnostic} from '../src/operational-diagnostics.js';
import {sampleWorkloadCpu} from './workload-cpu-sample.js';

// Opt-in transport baseline; this measures local PostgreSQL payload reads, not
// owner activation, a whole copy, installed desktop latency or NAS throughput.
// node scripts/test.js --test-concurrency=1 test/catalogue-payload.benchmark.js
const percentile=(samples,key)=>[...samples].map(row=>row[key]).sort((a,b)=>a-b)[Math.ceil(samples.length*.95)-1];
test('catalogue payload transport retains ordered bytes with repeated resource measurements',{timeout:180000},async t=>{
 const sourceHashes={};
 for(const file of ['src/catalogue-payload-rows.js','src/postgres.js','src/database-query.js','src/operational-diagnostics.js','test/catalogue-payload.benchmark.js'])sourceHashes[file]=createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex');
 const cpu=sampleWorkloadCpu(),db=await scratchDatabase(),profiles=[];let databaseVersion;
 try{
  databaseVersion=(await db.get("SELECT current_setting('server_version') AS version")).version;
  await db.run('CREATE TEMP TABLE state (slot text PRIMARY KEY,payload bytea NOT NULL)');
  for(const profile of [{name:'small',count:4096,size:128},{name:'mixed',count:512,size:4096,large:2*1024*1024}]){
   await db.run('TRUNCATE state');
   await db.run("INSERT INTO state SELECT lpad(i::text,6,'0'),decode(repeat('ab',$2),'hex') FROM generate_series(1,$1::integer) i",profile.count,profile.size);
   if(profile.large)await db.run("UPDATE state SET payload=decode(repeat('ab',$1),'hex') WHERE slot='000257'",profile.large);
   const samples=[];
   for(let run=0;run<20;run++){
    const sink=new OperationalDiagnostics(),start=performance.now();let rows=0,bytes=0,peakHeap=0,peakRss=0;
    await withDiagnostics(sink,async()=>{
     await db.run('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
     try{
      for await(const row of cataloguePayloadRows(db,'state',['slot','payload'])){
       assert.equal(row.slot,String(++rows).padStart(6,'0'));
       const size=profile.large&&rows===257?profile.large:profile.size;
       assert.equal(row.payload.length,size);assert.equal(row.payload.equals(Buffer.alloc(size,0xab)),true);bytes+=size;
       if(rows%32===0){const memory=process.memoryUsage();peakHeap=Math.max(peakHeap,memory.heapUsed);peakRss=Math.max(peakRss,memory.rss);}
      }
      await db.run('COMMIT');
     }catch(error){await db.run('ROLLBACK');throw error;}
     diagnostic('request',{route:'storage'});
    });
    assert.equal(rows,profile.count);assert.equal(bytes,profile.count*profile.size+(profile.large?profile.large-profile.size:0));
    const measured=(await sink.snapshot()).entries[0];
    samples.push({run,ms:Math.round(performance.now()-start),rows,bytes,peakHeap,peakRss,queries:measured.databaseQueries,cursorBatches:measured.databaseCursorBatches,bufferBytes:measured.databaseBufferBytes});
   }
   profiles.push({profile:profile.name,samples,p95Ms:percentile(samples,'ms'),maxHeap:Math.max(...samples.map(row=>row.peakHeap)),maxRss:Math.max(...samples.map(row=>row.peakRss))});
  }
 }finally{await db.close();t.diagnostic(JSON.stringify({platform:process.platform,arch:process.arch,node:process.version,databaseVersion,sourceHashes,cpuModel:os.cpus()[0]?.model,totalMemory:os.totalmem(),freeMemoryAtEnd:os.freemem(),cpuObserved:cpu.stop(),profiles}));}
});

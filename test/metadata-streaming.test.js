import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {ObjectIndex} from '../src/object-index.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-metadata-stream-'));
 const {workspace:ws,vault}=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{clearVault(vault);await rm(directory,{recursive:true,force:true});});
 return ws;
}
const base='metadata:.observanda/stream/';

test('metadata discovery streams 65 and 650 identities without loading values or whole SQL lists',async t=>{
 t.diagnostic(os.platform()+'/'+os.arch()+'; '+os.cpus()[0].model+'; Node '+process.version);
 for(const count of [65,650]){
  const ws=await fixture(t);
  await ws.withLock(()=>ws.catalogue(async s=>{for(let i=0;i<count;i++)await s.putObject(base+String(i).padStart(4,'0')+'/head.json',{private:'Retained source '.repeat(100)});}));
  let values=0,nodes=0,queries=0,peakRows=0,peakCache=0,seen=0,peakHeap=process.memoryUsage().heapUsed;
  const start=performance.now();
  await ws.catalogue(async s=>{
   const run=s.db.run.bind(s.db),decode=ResearchCatalogue.prototype.decode,node=ObjectIndex.prototype.node;
   s.db.run=async(sql,...args)=>{queries++;const result=await run(sql,...args);peakRows=Math.max(peakRows,result.rows?.length??0);return result;};
   ResearchCatalogue.prototype.decode=function(table,...args){if(table==='object')values++;if(table==='state')nodes++;return decode.call(this,table,...args);};
   ObjectIndex.prototype.node=async function(...args){const result=await node.apply(this,args);peakCache=Math.max(peakCache,this.cache.size);return result;};
   try{for await(const name of ws.metadataNames('.observanda/stream')){
    assert.equal(name,String(seen++).padStart(4,'0'));peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);
   }}finally{ObjectIndex.prototype.node=node;ResearchCatalogue.prototype.decode=decode;}
  });
  assert.equal(seen,count);assert.equal(values,0);assert.ok(peakRows<=32);assert.ok(peakCache<=128);
  assert.ok(nodes<30*count);assert.ok(queries<35*count);
  t.diagnostic(count+' names: '+Math.round(performance.now()-start)+' ms; '+queries+' SQL; '+nodes+' index nodes; peak result '+peakRows+'; cache '+peakCache+'; sampled heap '+Math.round(peakHeap/1024/1024)+' MiB.');
 }
});

test('authenticated prefix counts preserve UTF-16 key order, empty ranges and legacy roots',async t=>{
 const ws=await fixture(t),ids=['a','a/one','a0','a\uffff','b','\uffff','\uffffx','\ud83d\udc1d','\ud83d\udc1d/hive','\ue000'];
 await ws.withLock(()=>ws.catalogue(async s=>{for(const id of ids)await s.putObject(id,{id});}));
 await ws.catalogue(async s=>{
  const index=new ObjectIndex(s),head=await index.head();
  for(const prefix of ['','a','a/','a\uffff','b','missing','\uffff','\ud83d\udc1d','\ue000']){
   assert.equal(await index.prefixCount(head,prefix),ids.filter(id=>id.startsWith(prefix)).length);
   assert.deepEqual(await Array.fromAsync(s.objectIdEntries(prefix)),ids.filter(id=>id.startsWith(prefix)).sort());
  }
  assert.equal(await index.prefixCount({legacy:ids.map(id=>({id}))},'a'),4);
 });
});

test('name traversal retains unique immediate children and survives unrelated index writes between pages',async t=>{
 const ws=await fixture(t),expected=['a','a-else','b',...Array.from({length:70},(_,i)=>'z'+String(i).padStart(3,'0'))];
 await ws.withLock(async()=>{
  await ws.writeMetadata('.observanda/names/a','{}');
  await ws.writeMetadata('.observanda/names/a-else','{}');
  await ws.writeMetadata('.observanda/names/a/child','{}');
  await ws.writeMetadata('.observanda/names/b/one','{}');
  await ws.writeMetadata('.observanda/names/b/two','{}');
  for(const name of expected.slice(3))await ws.writeMetadata('.observanda/names/'+name,'{}');
 });
 await ws.withLock(async()=>{
  const seen=[];
  for await(const name of ws.metadataNames('.observanda/names')){
   seen.push(name);await ws.writeMetadata('.observanda/derived/'+name+'.json',JSON.stringify({name}));
  }
  assert.deepEqual(seen,expected);
 });
 const controller=new AbortController(),original=ResearchCatalogue.prototype.objectIdPage;let pages=0;
 ResearchCatalogue.prototype.objectIdPage=function(...args){pages++;return original.apply(this,args);};
 try{
  await assert.rejects(async()=>{for await(const name of ws.metadataNames('.observanda/names',{signal:controller.signal})){assert.equal(name,'a');controller.abort();}}, {name:'AbortError'});
  assert.equal(pages,1);
 }finally{ResearchCatalogue.prototype.objectIdPage=original;}
});

test('identity pages detect omitted and substituted SQL rows without decrypting unrelated values',async t=>{
 const ws=await fixture(t);
 await ws.withLock(()=>ws.catalogue(async s=>{for(let i=0;i<70;i++)await s.putObject(base+String(i).padStart(3,'0'),{i});}));
 await ws.withLock(()=>ws.catalogue(async s=>{
  const id=base+'001',row=await s.db.get('SELECT payload FROM objects WHERE id=$1',id);
  await s.db.run('DELETE FROM objects WHERE id=$1',id);
  await assert.rejects(s.objectIdPage(base),{code:'CATALOGUE_DAMAGED'});
  await s.db.run('INSERT INTO objects VALUES ($1,$2)',base+'extra',row.payload);
  await assert.rejects(s.objectIdPage(base),{code:'CATALOGUE_DAMAGED'});
  await s.db.run('DELETE FROM objects WHERE id=$1',base+'extra');
  await s.db.run('INSERT INTO objects VALUES ($1,$2)',id,row.payload);
  assert.equal((await s.objectIdPage(base)).items.length,32);
 }));
});

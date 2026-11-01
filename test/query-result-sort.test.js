import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {QueryResultSort,QueryCachePressure} from '../src/query-result-sort.js';
function storage({budget=64*1024*1024}={}){
 const files=new Map(),work={reads:0,writes:0,maxWrite:0,bytes:0,peakBytes:0};
 return {files,work,async read(file,at,size){work.reads++;const bytes=files.get(file);assert.ok(bytes&&at+size<=bytes.length);return Buffer.from(bytes.subarray(at,at+size));},async write(file,at,bytes){
  work.writes++;work.maxWrite=Math.max(work.maxWrite,bytes.length);const before=files.get(file)??Buffer.alloc(0),length=Math.max(before.length,at+bytes.length),growth=length-before.length;if(work.bytes+growth>budget)throw new QueryCachePressure();
  const next=Buffer.alloc(length);before.copy(next);bytes.copy(next,at);files.set(file,next);work.bytes+=growth;work.peakBytes=Math.max(work.bytes,work.peakBytes);
 },async truncate(file,size){const before=files.get(file)??Buffer.alloc(0);assert.ok(size<=before.length);files.set(file,Buffer.from(before.subarray(0,size)));work.bytes-=before.length-size;}};
}
const collator=new Intl.Collator('en',{numeric:true}),order=(a,b)=>collator.compare(a.title,b.title)||(a.id<b.id?-1:a.id>b.id?1:0);
test('encrypted external runs preserve exact numeric collation with bounded frames and random pages',async t=>{
 const rows=Array.from({length:10000},(_,i)=>({id:randomUUID(),title:['Alpha','alpha','Sample','界','🐝'][i%5]+' '+(10000-i),note:'z'.repeat(i%130)})),expected=[...rows].sort(order),io=storage(),sort=new QueryResultSort(io,randomBytes(32),randomUUID()),receipt=await sort.build(rows,order);
 assert.equal(receipt.total,10000);assert.ok(io.work.maxWrite<=512*1024+44);for(const bytes of io.files.values())assert.equal(bytes.includes(Buffer.from('Sample 999')),false);
 for(const offset of [0,25,127,128,129,5000,9975,9999,10000])assert.deepEqual(await sort.page(receipt,offset,25),expected.slice(offset,offset+25));
 const before=io.work.reads;assert.deepEqual(await sort.page(receipt,5000,25),expected.slice(5000,5025));const pageReads=io.work.reads-before;assert.ok(pageReads<20);
 for(const offset of [0,127,5000,9999]){assert.equal(await sort.rank(receipt,expected[offset],order),offset+1);assert.equal(await sort.rank(receipt,expected[offset],order,{includeEqual:false}),offset);}
 t.diagnostic(JSON.stringify({rows:rows.length,page:25,pageReads,maxFrameWrite:io.work.maxWrite,peakScratchBytes:io.work.peakBytes}));
});
test('result sorting observes pressure, cancellation, empty sources and authenticated corruption',async()=>{
 const io=storage(),key=randomBytes(32),controller=new AbortController(),sort=new QueryResultSort(io,key,randomUUID(),{check:()=>controller.signal.throwIfAborted()}),empty=await sort.build([],order);assert.deepEqual(await sort.page(empty,0,25),[]);
 const limited=new QueryResultSort(storage({budget:100}),key,randomUUID());await assert.rejects(limited.build([{id:'a',title:'sample'}],order),QueryCachePressure);
 await assert.rejects(sort.build([{id:'a',title:'x'.repeat(512*1024)}],order),QueryCachePressure);
 const receipt=await sort.build([{id:'a',title:'one'},{id:'b',title:'two'}],order);io.files.get(receipt.file)[10]^=1;await assert.rejects(sort.page(receipt,0,2),{code:'ENCRYPTION_DAMAGED'});
 controller.abort();await assert.rejects(sort.page(receipt,0,2),{name:'AbortError'});
});
test('earlier authenticated sort passes cannot be replayed as finalized pages or data',async()=>{
 const io=storage(),write=io.write,key=randomBytes(32),id=randomUUID();let oldData,oldPage;
 io.write=async(file,at,bytes)=>{if(!at&&file==='a.data')oldData??=Buffer.from(bytes);if(!at&&file==='pages')oldPage??=Buffer.from(bytes);return write(file,at,bytes);};
 const rows=Array.from({length:2048},(_,i)=>({id:String(i),title:'Sample '+(2048-i)})),sort=new QueryResultSort(io,key,id),receipt=await sort.build(rows,order);assert.equal(receipt.file,'a.data');assert.ok(receipt.generation>=3);
 const pages=Buffer.from(io.files.get('pages')),data=Buffer.from(io.files.get(receipt.file));oldPage.copy(io.files.get('pages'));await assert.rejects(new QueryResultSort(io,key,id).page(receipt,0,25),{code:'ENCRYPTION_DAMAGED'});io.files.set('pages',pages);
 oldData.copy(io.files.get(receipt.file));await assert.rejects(new QueryResultSort(io,key,id).page(receipt,0,25),{code:'ENCRYPTION_DAMAGED'});io.files.set(receipt.file,data);assert.deepEqual(await new QueryResultSort(io,key,id).page(receipt,0,25),[...rows].sort(order).slice(0,25));
});

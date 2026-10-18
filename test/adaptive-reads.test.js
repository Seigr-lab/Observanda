import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {setImmediate as turn} from 'node:timers/promises';
import {AdaptiveReadPool,adaptiveReadMap} from '../src/adaptive-reads.js';
const GiB=1024**3;
function fixture(){
 let sample={cores:16,total:32*GiB,available:24*GiB,busy:0.1,delayMs:2},started=0,stopped=0;
 const pool=new AdaptiveReadPool({sampler:{start(){started++;},read(){return sample;},stop(){stopped++;}},intervalMs:60000});
 return {pool,set:patch=>sample={...sample,...patch},counts:()=>({started,stopped})};
}
test('shared read admission grows with spare capacity and drains under CPU, memory and interface pressure',async()=>{
 const f=fixture(),releases=[];let active=0,peak=0;
 const work=Array.from({length:20},()=>f.pool.run(async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>releases.push(resolve));active--;}));
 await turn();assert.equal(active,2);
 for(let i=0;i<6;i++)f.pool.refresh();await turn();assert.equal(active,8);assert.equal(peak,8);
 f.set({busy:0.95});f.pool.refresh();assert.equal(f.pool.limit,1);
 releases.splice(0).forEach(release=>release());await turn();assert.equal(active,1);
 f.set({busy:0,available:200*1024**2});f.pool.refresh();assert.equal(f.pool.limit,1);
 f.set({available:24*GiB,delayMs:1});f.pool.refresh();await turn();assert.equal(active,2);
 f.set({delayMs:100});f.pool.refresh();assert.equal(f.pool.limit,1);
 while(releases.length){releases.splice(0).forEach(release=>release());await turn();}
 await Promise.all(work);await turn();assert.deepEqual(f.counts(),{started:1,stopped:1});assert.equal(f.pool.timer,null);
});
test('small machines keep a single streaming read and queued work retains its owner context',async()=>{
 const f=fixture(),context=new AsyncLocalStorage();f.set({cores:2,total:2*GiB,available:300*1024**2});
 let release;const first=f.pool.run(()=>new Promise(resolve=>release=resolve));await turn();
 const second=context.run('owner two',()=>f.pool.run(()=>context.getStore()));
 release();await first;assert.equal(await second,'owner two');assert.equal(f.pool.limit,1);await turn();assert.equal(f.counts().stopped,1);
});
test('ordered mapping overlaps independent reads with bounded discovery',async()=>{
 const f=fixture();let discovered=0,peak=0,active=0;
 async function* entries(){for(let i=0;i<40;i++){discovered++;yield i;}}
 const mapped=adaptiveReadMap(entries(),async(value)=>{active++;peak=Math.max(peak,active);await turn();active--;return value*2;},{pool:f.pool});
 const first=await mapped.next();assert.equal(first.value,0);assert.ok(discovered<=8);
 const remaining=[];for await(const value of mapped)remaining.push(value);
 assert.deepEqual([first.value,...remaining],Array.from({length:40},(_,i)=>i*2));assert.equal(peak,2);
});
test('a failed read cancels siblings and drains them before closing the source',async()=>{
 const f=fixture(),failure=Error('Corrupt original');let active=0,closed=false,discovered=0;
 async function* entries(){try{for(let i=0;i<100;i++){discovered++;yield i;}}finally{assert.equal(active,0);closed=true;}}
 await assert.rejects(async()=>{for await(const value of adaptiveReadMap(entries(),async(i,signal)=>{
  active++;try{await turn();if(i===1)throw failure;await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));signal.throwIfAborted();}finally{active--;}
 },{pool:f.pool}))void value;},error=>error===failure);
 assert.ok(closed);assert.ok(discovered<=8);await turn();assert.equal(f.pool.active,0);assert.equal(f.pool.pending.length,0);
});
test('caller cancellation and early iterator return drain reads without admitting the backlog',async()=>{
 for(const early of [false,true]){
  const f=fixture(),controller=new AbortController();let active=0,started=0;
  const mapped=adaptiveReadMap(Array.from({length:100},(_,i)=>i),async(i,signal)=>{
   active++;started++;try{await turn();signal.throwIfAborted();return i;}finally{active--;}
  },{pool:f.pool,signal:controller.signal});
  if(early){await mapped.next();await mapped.return();}
  else{const first=mapped.next();controller.abort(Error('Stop requested'));await assert.rejects(first,/Stop requested/);}
  await turn();assert.equal(active,0);assert.equal(f.pool.pending.length,0);assert.ok(started<=8);
 }
});
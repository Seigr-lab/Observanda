import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {PinnedQueryResults} from '../src/pinned-query-result.js';
import {QueryCachePressure} from '../src/query-result-sort.js';
import {clearVault} from '../src/encryption.js';
import {drainRetiredVault} from '../src/vault-lifecycle.js';
import {withQueryCacheHandoff} from '../src/query-cache-lifecycle.js';
import {withQueryCacheScope,retireQueryCacheScope} from '../src/query-cache-scope.js';
import {cloneVault} from '../src/encryption.js';
import {catalogueContext} from '../src/catalogue-context.js';
import {databaseScope,scopedDatabaseConnection} from '../src/workspace-database-context.js';
const order=(a,b)=>a.title.localeCompare(b.title,'en',{numeric:true})||a.id.localeCompare(b.id),point=row=>({id:row.id,title:row.title});
function fixture(){
 let opens=0,closes=0,reservations=0,produced=0;
 const budget={reserve(){reservations++;let released=false;return {release(){if(!released){released=true;reservations--;}}};}},workspace={root:path.resolve('synthetic-query-owner'),vault:{id:randomUUID(),key:randomBytes(32)}},rows=Array.from({length:400},(_,i)=>({id:String(i),title:'Sample '+(400-i)}));
 const open=async(_workspace,{check})=>{opens++;const files=new Map();let closed=false;return {id:randomUUID(),async read(file,at,size){check();assert.equal(closed,false);return Buffer.from(files.get(file).subarray(at,at+size));},async write(file,at,bytes){check();const before=files.get(file)??Buffer.alloc(0),next=Buffer.alloc(Math.max(before.length,at+bytes.length));before.copy(next);bytes.copy(next,at);files.set(file,next);},async truncate(file,size){files.set(file,Buffer.from((files.get(file)??Buffer.alloc(0)).subarray(0,size)));},async finish(){check();},async assertNamed(){check();},async close(){if(!closed){closed=true;closes++;files.clear();}}};};
 const cache=new PinnedQueryResults({open,budget,ttl:60000}),options={workspace,ownerId:randomUUID(),snapshotId:'a'.repeat(64),queryHash:'b'.repeat(64),order,point,limit:25},produce=()=>{produced++;return {rows,finish:()=>({counts:{other:rows.length}})};};
 return {cache,options,produce,rows,workspace,stats:()=>({opens,closes,reservations,produced})};
}
test('pinned result pages reuse immutable results with request cancellation isolated from the builder',async()=>{
 const f=fixture(),controller=new AbortController(),first=await f.cache.window({...f.options,signal:controller.signal},f.produce);assert.equal(first.total,400);controller.abort();
 const second=await f.cache.window({...f.options,after:first.records.at(-1)},f.produce);assert.equal(second.skipped,25);assert.deepEqual(second.records,[...f.rows].sort(order).slice(25,50));assert.equal(f.stats().produced,1);
 const changed=await f.cache.window({...f.options,snapshotId:'c'.repeat(64)},f.produce);assert.equal(changed.total,400);assert.equal(f.stats().produced,2);await f.cache.clear();assert.deepEqual(f.stats(),{opens:2,closes:2,reservations:0,produced:2});
});
test('vault clear and workspace handoff retire and drain before external mutation, then permit new generations',async()=>{
 const f=fixture();await f.cache.window(f.options,f.produce);
 await withQueryCacheHandoff(f.workspace.root,async()=>{assert.equal(f.stats().closes,1);assert.equal(await f.cache.window(f.options,f.produce),null);});
 await f.cache.window(f.options,f.produce);clearVault(f.workspace.vault);await drainRetiredVault(f.workspace.vault);assert.equal(f.stats().closes,2);assert.equal(f.cache.stats().entries,0);
 f.workspace.vault.key=randomBytes(32);await f.cache.window(f.options,f.produce);await f.cache.clear();assert.equal(f.stats().produced,3);assert.equal(f.stats().reservations,0);
});
test('cancelled waiters do not cancel another reader and failed source checks never become cached success',async()=>{
 const f=fixture();let release,started;const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{started=resolve;});
 const build=f.cache.window(f.options,async()=>{started();await gate;return {rows:f.rows};});await ready;
 const controller=new AbortController(),waiting=f.cache.window({...f.options,signal:controller.signal},f.produce);controller.abort();await assert.rejects(waiting,{name:'AbortError'});release();assert.equal((await build).total,400);assert.equal(f.stats().opens,1);await f.cache.clear();
 const failure=Object.assign(Error('source damage'),{code:'CATALOGUE_DAMAGED'});await assert.rejects(f.cache.window(f.options,()=>{throw failure;}),error=>error===failure);assert.equal(f.cache.stats().entries,0);
 assert.equal(await f.cache.window(f.options,()=>{throw new QueryCachePressure();}),null);assert.equal(f.stats().reservations,0);
});
test('authorized session results survive transient source keys and retire on grant and application shutdown',async()=>{
 const f=fixture(),source=cloneVault(f.workspace.vault),session=new Map(),application={workspace:{vault:{id:randomUUID(),key:randomBytes(32)}},session:()=>session},client={},grant={vault:cloneVault(source),expires:Date.now()+60000};
 const request=()=>withQueryCacheScope(application,client,[grant],()=>f.cache.window(f.options,f.produce));
 try{
  await request();await clearVault(f.workspace.vault);f.workspace.vault=cloneVault(source);await request();assert.equal(f.stats().produced,1);
  await retireQueryCacheScope(session);assert.equal(f.cache.stats().entries,0);await request();assert.equal(f.stats().produced,2);
  await clearVault(grant.vault);assert.equal(f.cache.stats().entries,0);grant.vault=cloneVault(source);await request();await retireQueryCacheScope(application);assert.equal(f.cache.stats().entries,0);
  assert.equal(f.stats().reservations,0);
 }finally{await f.cache.clear();await clearVault(source);await clearVault(grant.vault);await clearVault(f.workspace.vault);await clearVault(application.workspace.vault);}
});
test('handoff waits for a retirement already draining its retained file handles',async()=>{
 const f=fixture(),open=f.cache.open,closing=Promise.withResolvers(),release=Promise.withResolvers();f.cache.open=async(...args)=>{const files=await open(...args),close=files.close;return {...files,async close(){closing.resolve();await release.promise;await close();}};};
 await f.cache.window(f.options,f.produce);const retired=clearVault(f.workspace.vault);await closing.promise;let entered=false;
 const handoff=withQueryCacheHandoff(f.workspace.root,async()=>{entered=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(entered,false);release.resolve();await retired;await handoff;assert.equal(entered,true);
});
test('ancestor handoff retires descendant caches and suspends fresh descendants without affecting siblings',async()=>{
 const f=fixture();f.workspace.root=path.join(f.workspace.root,'project','book');await f.cache.window(f.options,f.produce);
 await withQueryCacheHandoff(path.dirname(f.workspace.root),async()=>{assert.equal(f.stats().closes,1);assert.equal(await f.cache.window(f.options,f.produce),null);const prior=f.workspace.root;f.workspace.root=path.join(path.dirname(path.dirname(prior)),'project-other');assert.equal((await f.cache.window(f.options,f.produce)).total,400);f.workspace.root=prior;});
 await f.cache.clear();
});
test('grant retirement during a cached window rejects access instead of triggering a scan fallback',async()=>{
 const f=fixture(),session=new Map(),application={workspace:f.workspace,session:()=>session},client={},entered=Promise.withResolvers(),release=Promise.withResolvers(),open=f.cache.open;let pause=false;
 f.cache.open=async(...args)=>{const files=await open(...args),assertNamed=files.assertNamed;return {...files,async assertNamed(){if(pause){entered.resolve();await release.promise;}return assertNamed();}};};
 const request=()=>withQueryCacheScope(application,client,[],()=>f.cache.window(f.options,f.produce));await request();pause=true;const pending=request();await entered.promise;const retired=retireQueryCacheScope(session);release.resolve();await assert.rejects(pending,{code:'ACCESS_LOCKED'});await retired;assert.equal(f.stats().produced,1);assert.equal(f.cache.stats().entries,0);
});
test('durable filesystem resources and expiry timers exclude catalogue contexts while source reads retain them',async t=>{
 const f=fixture(),connection={},held={db:connection},open=f.cache.open,schedule=setTimeout;let detachedOpens=0,detachedTimers=0;
 f.cache.open=async(...args)=>{assert.equal(catalogueContext.getStore(),undefined);assert.equal(scopedDatabaseConnection(),undefined);await Promise.resolve();assert.equal(scopedDatabaseConnection(),undefined);detachedOpens++;return open(...args);};
 t.mock.method(globalThis,'setTimeout',(...args)=>{assert.equal(catalogueContext.getStore(),undefined);assert.equal(scopedDatabaseConnection(),undefined);detachedTimers++;return schedule(...args);});
 await catalogueContext.run(held,()=>databaseScope({},()=>f.cache.window(f.options,()=>{assert.equal(catalogueContext.getStore(),held);assert.equal(scopedDatabaseConnection(),connection);return f.produce();}),connection));
 assert.equal(detachedOpens,1);assert.equal(detachedTimers,1);assert.equal([...f.cache.entries.values()][0].build,null);await f.cache.clear();
});
test('a fresh query revalidates source facts while a cursor continuation reuses its authenticated result',async()=>{
 const f=fixture();await f.cache.window({...f.options,reuse:false},f.produce);await f.cache.window(f.options,()=>{throw Error('Continuation rescanned');});
 await assert.rejects(f.cache.window({...f.options,reuse:false},()=>{throw Object.assign(Error('Damaged source summary'),{code:'CATALOGUE_DAMAGED'});}),{code:'CATALOGUE_DAMAGED'});assert.equal(f.cache.stats().entries,0);
});

test('ordinal windows reuse only the same owner query and accept exhausted offsets',async()=>{
 const f=fixture();try{
  const expected=[...f.rows].sort(order);await f.cache.window(f.options,f.produce);
  const page=await f.cache.window({...f.options,offset:225},f.produce);assert.equal(page.skipped,225);assert.deepEqual(page.records,expected.slice(225,250));assert.equal(f.stats().produced,1);
  const empty=await f.cache.window({...f.options,offset:1000},f.produce);assert.deepEqual(empty.records,[]);assert.equal(empty.total,400);
  await f.cache.window({...f.options,queryHash:'changed',offset:25},f.produce);await f.cache.window({...f.options,ownerId:randomUUID(),offset:25},f.produce);assert.equal(f.stats().produced,3);
  for(const offset of [-1,1.5,Number.MAX_SAFE_INTEGER+1])await assert.rejects(f.cache.window({...f.options,offset},f.produce),{code:'INVALID'});
  await assert.rejects(f.cache.window({...f.options,offset:0,after:expected[0]},f.produce),{code:'INVALID'});
 }finally{await f.cache.clear();}
});

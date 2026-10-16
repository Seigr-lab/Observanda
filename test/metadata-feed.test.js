import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {MetadataFeed} from '../src/metadata-feed.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
async function fixture(t){const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-feed-')),f=await encryptedFixture(directory,sampleNotebook());t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});return f.workspace;}

test('chronological metadata pages seek by immutable keys while updates and newer work continue',async t=>{
 const ws=await fixture(t),source='.observanda/synthetic-imports',feed=new MetadataFeed(ws,source),items=Array.from({length:63},(_,i)=>({id:randomUUID(),createdAt:new Date(1700000000000+i*1000).toISOString(),privateText:'Private original '+i}));
 await ws.withLock(async()=>{await feed.ensureLocked();for(const item of items){await ws.writeMetadata(source+'/'+item.id+'.json',JSON.stringify(item));await feed.putLocked(item);}});
 const first=await feed.page({limit:10});assert.deepEqual(first.items.map(i=>i.id),items.slice(-10).reverse().map(i=>i.id));assert.ok(first.next);
 const latest={id:randomUUID(),createdAt:new Date(1800000000000).toISOString()};
 await ws.withLock(async()=>{await ws.writeMetadata(source+'/'+latest.id+'.json',JSON.stringify(latest));await feed.putLocked(latest);await ws.writeMetadata(source+'/'+items[55].id+'.json',JSON.stringify({...items[55],privateText:'Updated processing progress'}));});
 ws.listMetadata=()=>{throw Error('A built feed must not rescan its source');};
 let cursor=first.next,seen=[...first.items];do{const page=await feed.page({cursor,limit:10});seen.push(...page.items);cursor=page.next;}while(cursor);
 assert.deepEqual(seen.map(i=>i.id),items.toReversed().map(i=>i.id));assert.ok(seen.every(i=>Object.keys(i).sort().join() === 'createdAt,id'));
 assert.equal((await feed.page({limit:1})).items[0].id,latest.id);
 await assert.rejects(new MetadataFeed(ws,'.observanda/another-source').page({cursor:first.next}),{code:'INVALID'});
 for(const data of [{cursor:'not-json'},{cursor:'x'.repeat(600)},{limit:0},{limit:101}])await assert.rejects(feed.page(data),{code:'INVALID'});
});

test('an interrupted ordering-index build rolls back and retries in place without hiding existing imports',async t=>{
 const ws=await fixture(t),source='.observanda/synthetic-imports',feed=new MetadataFeed(ws,source),items=Array.from({length:3},(_,i)=>({id:randomUUID(),createdAt:new Date(1700000000000+i).toISOString()}));
 await ws.withLock(async()=>{for(const item of items)await ws.writeMetadata(source+'/'+item.id+'.json',JSON.stringify(item));});
 const put=feed.putLocked.bind(feed);let count=0;feed.putLocked=async item=>{await put(item);if(++count===2)throw Error('Interrupted index build');};
 await assert.rejects(feed.ensure(),/Interrupted index build/);assert.equal(await ws.readMetadata(feed.marker,1024),null);assert.deepEqual(await ws.listMetadata(feed.order),[]);
 feed.putLocked=put;await feed.ensure();assert.deepEqual((await feed.page()).items,items.toReversed());
 assert.equal((await ws.listMetadata(source)).length,3);
});


test('nested library reads reuse one read snapshot without granting writer authority',async t=>{
 const ws=await fixture(t),name='.observanda/reader-test.json';await ws.withLock(()=>ws.writeMetadata(name,JSON.stringify({value:1})));
 const open=ws.openCatalogue.bind(ws);let connections=0;ws.openCatalogue=(...args)=>{connections++;return open(...args);};
 await ws.catalogue(async()=>{
  for(let i=0;i<8;i++)assert.equal(JSON.parse(await ws.readMetadata(name,1024)).value,1);
  assert.equal(connections,1);
  await assert.rejects(ws.writeMetadata(name,JSON.stringify({value:2})),{code:'LOCKED'});
 });
 assert.equal(connections,1);
 await ws.withLock(()=>ws.writeMetadata(name,JSON.stringify({value:3})));
 assert.equal(JSON.parse(await ws.readMetadata(name,1024)).value,3);
});

test('uninitialized feeds read complete ordered pages without writing, then keep cursors after a writer builds the index',async t=>{
 const ws=await fixture(t),feed=new MetadataFeed(ws,'.observanda/legacy-list'),items=Array.from({length:43},(_,i)=>({id:randomUUID(),createdAt:new Date(1700000000000+(i%7)*1000).toISOString(),privateText:'Only summary fields leave this feed'}));
 await ws.withLock(async()=>{for(const item of items)await ws.writeMetadata(feed.source+'/'+item.id+'.json',JSON.stringify(item));});
 const write=ws.withLock;ws.withLock=()=>{throw Error('A feed read requested the writer');};
 const expected=items.map(item=>({id:item.id,createdAt:item.createdAt})).sort((a,b)=>feed.key(a)<feed.key(b)?-1:1),first=await feed.page({limit:7});
 assert.deepEqual(first.items,expected.slice(0,7));assert.equal(await ws.readMetadata(feed.marker,1024),null);
 const empty=new MetadataFeed(ws,'.observanda/empty-list');assert.deepEqual(await empty.page(),{items:[],next:null});assert.equal(await ws.readMetadata(empty.marker,1024),null);
 let cursor=first.next,seen=[...first.items];while(cursor){const page=await feed.page({cursor,limit:7});seen.push(...page.items);cursor=page.next;}assert.deepEqual(seen,expected);
 ws.withLock=write;await ws.withLock(()=>feed.ensureLocked());
 assert.deepEqual((await feed.page({cursor:first.next,limit:7})).items,expected.slice(7,14));
});

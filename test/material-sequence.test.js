import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MaterialSequence} from '../src/material-sequence.js';
import {ObjectIndex} from '../src/object-index.js';
import {digest,serialize} from '../src/storage-format.js';

function fixture(){
 const objects=new Map(),reads=[];let writes=0;
 const sequence=new MaterialSequence({
  async readMetadata(key){reads.push(key);return objects.get(key)??null;},
  async writeMetadata(key,bytes){objects.set(key,bytes);writes++;}
 });
 return {sequence,objects,reads,get writes(){return writes;}};
}
const descriptor=i=>({hash:digest(String(i)),count:256});
test('custom immutable node owners retain preflight authentication by default',async()=>{
 let reads=0,writes=0;const storage={read:async()=>{reads++;return {corrupt:true};},write:async()=>{writes++;}},index=new ObjectIndex(null,{immutable:true,nodeStorage:storage}),root=await index.change(null,'node','a'.repeat(64));
 await assert.rejects(index.flush(root),{code:'CATALOGUE_DAMAGED'});assert.equal(reads,1);assert.equal(writes,0);
 assert.throws(()=>new ObjectIndex(null,{nodeStorage:storage,authenticateOnWrite:true}),{code:'INVALID'});assert.throws(()=>new ObjectIndex(null,{immutable:true,authenticateOnWrite:true}),{code:'INVALID'});
 for(const options of [{immutable:1,nodeStorage:storage},{immutable:true,nodeStorage:{write:storage.write}},{immutable:true,nodeStorage:{read:storage.read}}])assert.throws(()=>new ObjectIndex(null,{...options,authenticateOnWrite:true}),{code:'INVALID'});
});
test('large page manifests keep constant-size roots and point inspection reads only one bounded chunk',async()=>{
 const f=fixture(),build=async count=>{const builder=f.sequence.builder('pages',fn=>fn());for(let i=0;i<count;i++)await builder.append(descriptor(i));return builder.finish();};
 const early=await build(65),large=await build(65537);
 assert.equal(large.count,65537);assert.equal(large.root.count,1025);assert.ok(JSON.stringify(large).length<350);
 f.reads.length=0;assert.deepEqual(await f.sequence.item(large,65536),descriptor(65536));
 assert.ok(f.reads.length<=large.root.height+1);assert.equal(f.reads.filter(p=>p.includes('/chunks/')).length,1);
 assert.deepEqual((await f.sequence.page(large,{offset:62,limit:4})).items,[62,63,64,65].map(descriptor));
 assert.deepEqual((await f.sequence.page(early,{offset:64})).items,[descriptor(64)]);
 const writes=f.writes;assert.deepEqual(await build(65),early);assert.equal(f.writes,writes,'Identical manifests reuse retained chunks and branches');
 await assert.rejects(f.sequence.page(large,{offset:65538}),{code:'INVALID'});
 await assert.rejects(f.sequence.page(large,{limit:257}),{code:'INVALID'});
});

test('an interrupted chunk transaction can restart without changing an earlier manifest',async()=>{
 const f=fixture(),old=f.sequence.builder('pages',fn=>fn());await old.append(descriptor(0));const pinned=await old.finish();
 let count=0;const interrupted=f.sequence.builder('pages',async fn=>{
  const before=new Map(f.objects);
  try{await fn();if(++count===2)throw Error('Storage full');}catch(error){f.objects.clear();for(const [key,bytes] of before)f.objects.set(key,bytes);throw error;}
 });
 await assert.rejects(async()=>{for(let i=0;i<128;i++)await interrupted.append(descriptor(i));await interrupted.finish();},/Storage full/);
 const retained=new Set(f.objects.keys()),retry=f.sequence.builder('pages',fn=>fn());
 for(let i=0;i<130;i++)await retry.append(descriptor(i));
 const current=await retry.finish();assert.equal(current.count,130);
 for(const key of retained)assert.ok(f.objects.has(key));
 assert.deepEqual(await f.sequence.item(pinned,0),descriptor(0));
 assert.deepEqual(await f.sequence.item(current,129),descriptor(129));
});

test('missing or altered schema chunks and malformed authenticated nodes fail visibly',async()=>{
 const f=fixture(),builder=f.sequence.builder('columns',fn=>fn());
 for(let i=0;i<35;i++)await builder.append({name:'Field '+i});
 const schema=await builder.finish();f.reads.length=0;
 assert.equal((await f.sequence.page(schema,{offset:16})).items.length,16);
 assert.equal(f.reads.filter(p=>p.includes('/chunks/')).length,1);
 const chunk=f.reads.find(p=>p.includes('/chunks/')),bytes=f.objects.get(chunk);f.objects.delete(chunk);
 await assert.rejects(f.sequence.page(schema,{offset:16}),{code:'MATERIAL_MISSING'});
 f.objects.set(chunk,serialize({...JSON.parse(bytes),items:[]}));
 await assert.rejects(f.sequence.page(schema,{offset:16}),{code:'MATERIAL_MISSING'});
 f.objects.set(chunk,bytes);
 const node='.observanda/materials/sequences/nodes/'+schema.root.hash+'.json';
 f.objects.set(node,serialize({...JSON.parse(f.objects.get(node)),revision:'a'.repeat(64)}));
 await assert.rejects(f.sequence.page(schema),{code:'MATERIAL_MISSING'});
});

test('reference appends preserve earlier tails when short batches cross chunk boundaries',async()=>{
 const f=fixture(),build=f.sequence.builder('references',fn=>fn()),items=Array.from({length:131},(_,i)=>({kind:'artifact',id:'input-'+i,revision:digest(String(i))}));
 const empty=await build.finish(),first=await f.sequence.append(empty,items.slice(0,63)),second=await f.sequence.append(first,items.slice(63,67)),last=await f.sequence.append(second,items.slice(67));
 assert.equal(last.count,131);assert.deepEqual((await f.sequence.page(first,{limit:64})).items,items.slice(0,63));
 assert.deepEqual((await f.sequence.page(second,{limit:128})).items,items.slice(0,67));
 assert.deepEqual((await f.sequence.page(last,{limit:256})).items,items);assert.equal(empty.count,0);
});

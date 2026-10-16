import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MaterialSequence} from '../src/material-sequence.js';
import {MaterialUploadChunks} from '../src/material-upload-chunks.js';
import {digest} from '../src/storage-format.js';
import {FILE_CHUNK,fileFingerprint,fingerprintFile,matchingUploadPrefix} from '../src/web/evidence-fingerprint.js';
function fixture(){
 const values=new Map(),reads=[];
 const sequence=new MaterialSequence({async readMetadata(key){reads.push(key);return values.get(key)??null;},async writeMetadata(key,value){values.set(key,value);}});
 return {owner:new MaterialUploadChunks(sequence),values,reads};
}
test('indexed upload checkpoints and progress stay bounded as receipts grow tenfold',async()=>{
 const f=fixture(),receipt={size:FILE_CHUNK,sha256:digest('fixture chunk descriptor')};
 for(const count of [96,960]){
  const session={id:'fixture',size:count*FILE_CHUNK,chunkSize:FILE_CHUNK,...f.owner.initial()};
  for(let i=0;i<count;i++)await f.owner.append(session,receipt);
  f.reads.length=0;
  const summary=await f.owner.summary(session);
  assert.equal(summary.receivedBytes,session.size);assert.equal(summary.receivedChunks,count);
  assert.equal(f.reads.length,0);assert.equal(summary.chunks,undefined);assert.equal(summary.chunksIndex,undefined);
  assert.ok(JSON.stringify(summary).length<300);assert.ok(JSON.stringify(session).length<600);
  let seen=0;for await(const chunk of f.owner.entries(session)){assert.deepEqual(chunk,receipt);seen++;}
  assert.equal(seen,count);
  const before=structuredClone(session);
  await assert.rejects(f.owner.append(session,receipt),{code:'MATERIAL_MISSING'});assert.deepEqual(session,before);
 }
});
test('legacy upload receipts resume into the same indexed session and corruption fails verification',async()=>{
 const f=fixture(),chunk={size:FILE_CHUNK,sha256:digest('one')},session={size:FILE_CHUNK*3,chunkSize:FILE_CHUNK,chunks:[chunk]};
 const old=await f.owner.summary(session);
 await f.owner.append(session,chunk);
 assert.equal(session.chunks,undefined);assert.equal(f.owner.count(session),2);assert.notEqual(session.chunkChain,old.receivedChain);
 const saved=structuredClone(session);session.chunkChain='a'.repeat(64);
 await assert.rejects(async()=>{for await(const value of f.owner.entries(session))void value;},{code:'MATERIAL_MISSING'});
 Object.assign(session,saved);
 const page=[...f.values.keys()].find(k=>k.endsWith(session.chunksIndex.root.hash+'.json')),prior=f.values.get(page);
 f.values.delete(page);await assert.rejects(async()=>{for await(const value of f.owner.entries(session))void value;},{code:'CATALOGUE_DAMAGED'});
 f.values.set(page,prior);let count=0;for await(const value of f.owner.entries(session)){void value;count++;}assert.equal(count,2);
});
test('browser fingerprints stream receipts and check the exact received prefix before resuming',async()=>{
 const bytes=Buffer.alloc(FILE_CHUNK*2+7,0x61),file=new Blob([bytes]),chunks=[];
 for(let offset=0;offset<bytes.length;offset+=FILE_CHUNK){const part=bytes.subarray(offset,offset+FILE_CHUNK);chunks.push({size:part.length,sha256:digest(part)});}
 const expected=await fileFingerprint(bytes.length,chunks,digest);
 assert.equal(await fingerprintFile(file),expected);
 assert.equal(await fileFingerprint(bytes.length,(async function*(){yield* chunks;})(),digest),expected);
 const f=fixture(),session={size:bytes.length,chunkSize:FILE_CHUNK,...f.owner.initial()};
 await f.owner.append(session,chunks[0]);const summary=await f.owner.summary(session);
 assert.equal(await matchingUploadPrefix(file,summary),true);
 const changed=Buffer.from(bytes);changed[0]^=1;assert.equal(await matchingUploadPrefix(new Blob([changed]),summary),false);
 changed[0]^=1;changed[FILE_CHUNK]^=1;assert.equal(await matchingUploadPrefix(new Blob([changed]),summary),true,'Only already accepted bytes define the resume prefix');
 const controller=new AbortController();controller.abort();
 await assert.rejects(fingerprintFile(file,{signal:controller.signal}),{name:'AbortError'});
 await assert.rejects(fileFingerprint(bytes.length,chunks.slice(0,1),digest),/Incomplete/);
});

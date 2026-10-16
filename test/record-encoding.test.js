import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {RecordValueTree} from '../src/record-value-tree.js';
import {recordEncoding,recordContentRevision} from '../src/record-encoding.js';
import {jsonChunks,jsonByteLength,jsonFitsBytes} from '../src/web/json-chunks.js';
import {digest,serialize} from '../src/storage-format.js';
import {revisionText} from '../src/web/revision-model.js';
import {recordEncodingCases} from './fixtures/record-encoding-cases.js';

test('record writer preserves the original block graph and exact revision inputs',async t=>{
 const expected=JSON.parse(await readFile(new URL('./fixtures/record-encoding-identities.json',import.meta.url),'utf8')),cases=recordEncodingCases();assert.equal(expected.length,cases.length);
 let count=0;
 for(const [i,value] of cases.entries()){
  const nodes=new Map(),storage={async put(kind,value){const raw=serialize(value),hash=digest(raw);assert.ok(Buffer.byteLength(raw)<=65536);nodes.set(kind+':'+hash,raw);return hash;},async read(kind,hash){return JSON.parse(nodes.get(kind+':'+hash));}};
  const tree=new RecordValueTree(storage),root=await tree.retain(value);
  assert.deepEqual({root,blocks:nodes.size,inventory:digest(JSON.stringify([...nodes].sort(([a],[b])=>a.localeCompare(b))))},expected[i]);
  assert.deepEqual(await tree.read(root),value);count+=nodes.size;
  const raw=serialize(value);
  assert.deepEqual(recordEncoding(value),{revision:digest(raw),bytes:Buffer.byteLength(raw),memberBytes:Buffer.byteLength(raw.slice(0,-1).split('\n').map(line=>'    '+line).join('\n'))});
  assert.equal(recordContentRevision(value),digest(revisionText(value)));
 }
 t.diagnostic(JSON.stringify({cases:cases.length,identicalBlocks:count}));
});

test('canonical and representation encoders preserve ordering and reject executable values',async()=>{
 const object=JSON.parse('{"z":0,"1":1,"01":2,"4294967294":3,"4294967295":4,"a":5,"__proto__":6}');
 for(const value of [object,{optional:undefined,object,array:[object,undefined,NaN,-0]}]){
  assert.equal(Buffer.concat([...jsonChunks(value,{canonical:true})]).toString(),revisionText(value));
  assert.equal(jsonByteLength(value,{canonical:true}),Buffer.byteLength(revisionText(value)));
  for(const pretty of [true,false]){const bytes=Buffer.byteLength(JSON.stringify(value,null,pretty?2:0));assert.equal(jsonFitsBytes(value,bytes,{pretty}),true);assert.equal(jsonFitsBytes(value,bytes-1,{pretty}),false);}
 }
 const tree=new RecordValueTree({put(){assert.fail('No invalid value can be stored.');}}),getter={};Object.defineProperty(getter,'body',{enumerable:true,get(){assert.fail('Getter invoked.');}});
 await assert.rejects(tree.retain(getter),{code:'INVALID'});
 const array=['value'];Object.defineProperty(array,'0',{get(){assert.fail('Array getter invoked.');}});await assert.rejects(tree.retain(array),{code:'INVALID'});
 const controller=new AbortController();controller.abort();
 for(const encode of [recordEncoding,recordContentRevision])assert.throws(()=>encode(object,{signal:controller.signal}),{name:'AbortError'});
 assert.throws(()=>jsonFitsBytes(object,9000,{signal:controller.signal}),{name:'AbortError'});
});

test('record storage encoding and revision identities avoid whole-record copies under a small heap',async t=>{
 const {stdout}=await promisify(execFile)(process.execPath,['--max-old-space-size=48','--max-semi-space-size=4','test/fixtures/encode-large-record.js'],{cwd:process.cwd(),windowsHide:true,timeout:120000});
 const result=JSON.parse(stdout.trim());assert.ok(result.bytes>130*1024*1024);assert.ok(result.heapLimit<64*1024*1024);assert.ok(result.peakHeapMiB<60);assert.ok(result.maxBlock<=65536);t.diagnostic(stdout.trim());
});

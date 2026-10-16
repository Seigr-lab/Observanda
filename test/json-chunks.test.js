import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {jsonChunks,jsonByteLength,utf8ByteLength} from '../src/web/json-chunks.js';
import {recordCheckpointIdentity,directRecordCheckpoint} from '../src/web/record-checkpoint-identity.js';
import {writeRecordCheckpoint} from '../src/web/record-draft-transfer.js';
import {RECORD_DRAFT_CHUNK_BYTES as SIZE} from '../src/web/record-draft-protocol.js';
const digest=value=>createHash('sha256').update(value).digest('hex');
const encoded=(value,options)=>Buffer.concat([...jsonChunks(value,options)]).toString();

test('bounded JSON encoding preserves native spelling, order, Unicode and whitespace',async()=>{
 const text='A'.repeat(4095)+'\ud83d\udc1d'+'\ud800'+'\udfff'+'\u0000\b\t\r\n"\\ç界'.repeat(5000);
 const object=JSON.parse('{"__proto__":{"name":"retained"},"constructor":1,"03":3,"2":2}');
 const values=[null,false,0,-0,1e100,NaN,Infinity,'',text,[],{},[1,undefined,,null],{skipped:undefined,empty:'',a:[object,{text}],small:1e-7}];
 for(const value of values)for(const pretty of [false,true]){
  const expected=JSON.stringify(value,null,pretty?2:0);
  assert.equal(jsonByteLength(value,{pretty}),Buffer.byteLength(expected));
  assert.equal(utf8ByteLength(expected),Buffer.byteLength(expected));
  for(const size of [1,17,SIZE]){
   const chunks=[...jsonChunks(value,{size,pretty})];assert.ok(chunks.every(part=>part.length<=size));
   assert.equal(Buffer.concat(chunks).toString(),expected);
  }
  if(!pretty)assert.deepEqual(await recordCheckpointIdentity(value),{bytes:Buffer.byteLength(expected),sha256:digest(expected)});
 }
});

test('encoding refuses executable/non-JSON values and cycles without invoking accessors',()=>{
 const cycle={};cycle.self=cycle;const getter={};Object.defineProperty(getter,'value',{enumerable:true,get(){assert.fail('Accessor invoked');}});
 for(const value of [cycle,getter,new Date(),{toJSON(){assert.fail('Custom serialization invoked');}},[1n],[()=>{}],{[Symbol('x')]:1}])assert.throws(()=>encoded(value),{code:'INVALID'});
 const shared={text:'valid'};assert.equal(encoded([shared,shared]),JSON.stringify([shared,shared]));
 for(const value of [cycle,getter,new Date(),[1n]])assert.throws(()=>jsonByteLength(value),{code:'INVALID'});
 const controller=new AbortController();controller.abort();
 assert.throws(()=>jsonByteLength(shared,{signal:controller.signal}),{name:'AbortError'});
 assert.throws(()=>utf8ByteLength('',{signal:controller.signal}),{name:'AbortError'});
 assert.equal(utf8ByteLength('a'.repeat(4095)+'\ud83d\udc1d\ud800'),Buffer.byteLength('a'.repeat(4095)+'\ud83d\udc1d\ud800'));
});

test('direct compatibility selection measures the exact envelope and yields for cancellation',async()=>{
 const command={id:'writer',workspaceId:'workspace',expectedRevision:null,changes:[{baseRevision:null,expectedRevision:null,record:{sections:Array.from({length:300},()=>({body:'界'.repeat(3000)}))}}]};
 const expected=Buffer.byteLength(JSON.stringify({formatVersion:2,...command,updatedAt:'2000-01-01T00:00:00.000Z'},null,2));
 assert.equal(await directRecordCheckpoint(command,expected),true);assert.equal(await directRecordCheckpoint(command,expected-1),false);
 const controller=new AbortController();setTimeout(()=>controller.abort(),0);
 await assert.rejects(recordCheckpointIdentity(command.changes,{signal:controller.signal}),{name:'AbortError'});
 const early=new AbortController();early.abort();let calls=0;
 await assert.rejects(writeRecordCheckpoint(async()=>{calls++;},command,{signal:early.signal}),{name:'AbortError'});assert.equal(calls,0);
});

test('resuming transfer skips accepted chunks and cancellation never sends a finish',async()=>{
 const command={id:'writer',workspaceId:'workspace',expectedRevision:null,changes:[{baseRevision:null,expectedRevision:null,record:{sections:Array.from({length:80},()=>({body:'界'.repeat(20000)}))}}]};
 const content=Buffer.from(JSON.stringify(command.changes)),seen=[],controller=new AbortController();
 await assert.rejects(writeRecordCheckpoint(async(route,data)=>{
  if(route.endsWith('/start')){assert.equal(data.sha256,digest(content));assert.equal(data.bytes,content.length);return {receivedChunks:5};}
  assert.ok(route.endsWith('/part'));seen.push(data.index);assert.deepEqual(Buffer.from(data.bytes,'base64'),content.subarray(data.index*SIZE,(data.index+1)*SIZE));
  controller.abort();return {index:data.index};
 },command,{signal:controller.signal}),{name:'AbortError'});assert.deepEqual(seen,[5]);
});

test('browser checkpoint encoding uploads a 126 MiB draft under a 60 MiB heap',async t=>{
 const {stdout}=await promisify(execFile)(process.execPath,['--max-old-space-size=48','--max-semi-space-size=4','test/fixtures/encode-large-draft.js'],{cwd:process.cwd(),timeout:180000,windowsHide:true});
 const result=JSON.parse(stdout.trim());assert.ok(result.bytes>120*1024*1024);assert.ok(result.heapLimit<64*1024*1024);
 assert.ok(result.maxRequestBytes<2*SIZE);assert.ok(result.peakHeapMiB<60);assert.equal(result.parts,Math.ceil(result.bytes/SIZE));t.diagnostic(stdout.trim());
});

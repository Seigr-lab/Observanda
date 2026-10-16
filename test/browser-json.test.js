import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {incrementalJSONDecoder as sourceDecoder} from '../src/json/browser-parser.js';
import {incrementalJSONDecoder as browserDecoder} from '../src/web/vendor/json-parser.js';
import {readRecordCheckpoint} from '../src/web/record-draft-transfer.js';
import {upgradeOwnedRecord,upgradeRecord} from '../src/web/record-model.js';
import {RECORD_DRAFT_CHUNK_BYTES as SIZE} from '../src/web/record-draft-protocol.js';
const digest=value=>createHash('sha256').update(value).digest('hex');

for(const [name,create] of [['source',sourceDecoder],['browser bundle',browserDecoder]]){
 test(name+' decodes exact values across token and Unicode boundaries',()=>{
  const values=[null,false,true,-0,1.7e-12,9007199254740992,'界🐝\ud800!\udfff\u0000\n',[],{},[1,{},[null]],JSON.parse('{"__proto__":{"label":"owned"},"constructor":1,"text":"value"}')];
  for(const value of values){const text=JSON.stringify(value);
   for(const size of [1,2,7,127]){const decoder=create();for(let i=0;i<text.length;i+=size)decoder.write(text.slice(i,i+size));assert.deepEqual(decoder.finish(),JSON.parse(text));assert.throws(()=>decoder.finish(),/closed/);}
  }
 });
 test(name+' refuses malformed/truncated/duplicate JSON and can discard partial values',()=>{
  for(const text of ['', '[', '{"x":', '[1,]', '{"x":1,"x":2}', '{"__proto__":1,"__proto__":2}', 'null true','01','trueX','"\\uZZZZ"','\ufeff{}']){
   const decoder=create();assert.throws(()=>{for(const c of text)decoder.write(c);decoder.finish();});decoder.discard();assert.throws(()=>decoder.write('[]'),/closed/);
  }
  const decoder=create();decoder.write('[{"body":"partial');decoder.discard();assert.throws(()=>decoder.finish(),/closed/);
 });
}

function fixture({raw=null,expectedHash=null,bytes=null}={}){
 const record={id:randomUUID(),title:'Recovered',body:'界🐝'.repeat(50000),author:'Source author',chart:null};
 const content=bytes??Buffer.from(raw??JSON.stringify([{baseRevision:null,expectedRevision:null,record}])),id=randomUUID();let index=0,baseReads=0;
 const header={revision:digest('checkpoint'),draft:{formatVersion:3,id,workspaceId:randomUUID(),updatedAt:'2026-10-10',count:1,base:{recordId:record.id,revision:null},content:{bytes:content.length,sha256:expectedHash??digest(content)}}};
 const api=async(route,command)=>{
  if(route.endsWith('/read'))return header;
  if(route.endsWith('/readBase')){baseReads++;return {base:null};}
  assert.ok(route.endsWith('/readPart'));assert.equal(command.index,index++);const chunk=content.subarray(command.index*SIZE,(command.index+1)*SIZE);return {bytes:chunk.toString('base64'),sha256:digest(chunk)};
 };
 return {api,id,record,get baseReads(){return baseReads;},get parts(){return index;}};
}

test('checkpoint recovery verifies bytes before fetching the base or exposing the decoded record',async()=>{
 const f=fixture(),result=await readRecordCheckpoint(f.api,f.id);assert.deepEqual(result.draft.changes[0].record,upgradeRecord(f.record));assert.equal(f.baseReads,1);assert.ok(f.parts>1);
 for(const options of [{expectedHash:'0'.repeat(64)},{raw:'[{"record":'},{raw:'[{"record":{"id":1,"id":2}}]'}, {bytes:Buffer.from([0x5b,0x22,0xff,0x22,0x5d])}]){
  const bad=fixture(options);await assert.rejects(readRecordCheckpoint(bad.api,bad.id),{code:'FORMAT'});assert.equal(bad.baseReads,0);
 }
 const stopped=fixture(),controller=new AbortController();await assert.rejects(readRecordCheckpoint(async(route,data,options)=>{const value=await stopped.api(route,data);if(route.endsWith('/readPart'))controller.abort();return value;},stopped.id,{signal:controller.signal}),{name:'AbortError'});assert.equal(stopped.baseReads,0);
 const failed=fixture(),network=new TypeError('Connection failed');await assert.rejects(readRecordCheckpoint(async(route,data)=>{if(route.endsWith('/readPart'))throw network;return failed.api(route,data);},failed.id),error=>error===network);assert.equal(failed.baseReads,0);
 const last=fixture({raw:'[]'}),cancelled=new AbortController();await assert.rejects(readRecordCheckpoint(async(route,data)=>{const value=await last.api(route,data);if(route.endsWith('/readPart'))cancelled.abort();return value;},last.id,{signal:cancelled.signal}),{name:'AbortError'});assert.equal(last.baseReads,0);
});

test('owned record upgrade avoids copying a newly decoded body and preserves safe default ownership',()=>{
 const source={id:randomUUID(),author:'Original',chart:null,sections:[{body:'Retained content'}]},safe=upgradeRecord(source);
 assert.ok(Object.hasOwn(source,'author'));assert.notEqual(source.sections,safe.sections);const sections=source.sections;
 assert.equal(upgradeOwnedRecord(source),source);assert.equal(source.sections,sections);assert.deepEqual(source,safe);
});

test('checkpoint recovery retains the selected value without retaining its complete transport text',async t=>{
 const {stdout}=await promisify(execFile)(process.execPath,['--max-old-space-size=48','--max-semi-space-size=4','test/fixtures/decode-large-draft.js'],{cwd:process.cwd(),timeout:180000,windowsHide:true});
 const result=JSON.parse(stdout.trim());assert.ok(result.bytes>32*1024*1024);assert.ok(result.heapLimit<64*1024*1024);assert.ok(result.peakHeapMiB<60);assert.equal(result.sections,300);t.diagnostic(stdout.trim());
});

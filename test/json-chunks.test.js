import {test} from 'node:test';
import assert from 'node:assert/strict';
import {jsonChunks,jsonByteLength,utf8ByteLength} from '../src/web/json-chunks.js';
import {RECORD_DRAFT_CHUNK_BYTES as SIZE} from '../src/web/record-draft-protocol.js';
const encoded=(value,options)=>Buffer.concat([...jsonChunks(value,options)]).toString();

test('bounded JSON encoding preserves native spelling, order, Unicode and whitespace',()=>{
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

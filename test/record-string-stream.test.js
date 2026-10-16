import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordStringJSON,recordStringText,recordTextJSON} from '../src/record-string-stream.js';
import {serialize} from '../src/storage-format.js';

async function* pieces(bytes,size){for(let at=0;at<bytes.length;at+=size)yield bytes.subarray(at,at+size);}
async function collect(chunks,options){let value='';for await(const chunk of recordStringJSON(chunks,options))value+=chunk;return value;}
async function decoded(chunks,options){let value='';for await(const chunk of recordStringText(chunks,options))value+=chunk;return value;}

test('logical text serialization preserves every UTF-16 split and stops within a large input window',async()=>{
 const value='Quotes " and \\ escapes \n controls \u0000 🔬 lone \ud800 / \udfff';
 for(let split=0;split<=value.length;split++)assert.equal((await Array.fromAsync(recordTextJSON([value.slice(0,split),'',value.slice(split)]))).join(''),JSON.stringify(value));
 assert.equal((await Array.fromAsync(recordTextJSON([]))).join(''),'""');
 const controller=new AbortController(),iterator=recordTextJSON(['\ud800'.repeat(30000)],{signal:controller.signal});await iterator.next();await iterator.next();controller.abort();await assert.rejects(iterator.next(),{name:'AbortError'});
 await assert.rejects(Array.fromAsync(recordTextJSON(['valid',17])),{code:'INVALID'});
});

test('stored string traversal preserves every escape and UTF-8 boundary exactly',async()=>{
 const values=['','plain text','\"\\/\b\t\n\f\r\0\u0001\u001f','α🔬中\ufeff','\ud800','\udfff','\ud800\ud800\udfff\udfff','\ud800\\\udfff','\ud800"\udfff','\ud800\n\udfff'];
 for(const value of values){
  const bytes=Buffer.from(serialize(value));
  for(let split=0;split<=bytes.length;split++){
   assert.equal(await collect([bytes.subarray(0,split),bytes.subarray(split)]),JSON.stringify(value));
   assert.equal(await decoded([bytes.subarray(0,split),bytes.subarray(split)]),value);
  }
  assert.equal(await collect(pieces(bytes,1)),JSON.stringify(value));
 }
 let allUnits='';for(let code=0;code<=0xffff;code++)allUnits+=String.fromCharCode(code);
 const encoded=Buffer.from(serialize(allUnits));
 for(const size of [3,127,32768]){
  assert.equal(await collect(pieces(encoded,size)),JSON.stringify(allUnits));
  assert.equal(await decoded(pieces(encoded,size)),allUnits);
 }
});

test('stored string traversal rejects malformed or noncanonical retained encodings',async()=>{
 const invalid=['','"text"','"text"\n\n',' "text"\n','"text" \n','"text"\r\n','42\n','null\n','["text"]\n','"text','"a\nb"\n','"a\0b"\n','"\\q"\n','"\\/"\n','"\\u0061"\n','"\\u0008"\n','"\\u000B"\n','"\\ud800\\udc00"\n','"\\ud800\\ud800\\udfff"\n','"\\u12"\n','"\\"\n','\ufeff"text"\n'];
 const bytes=invalid.map(value=>Buffer.from(value));
 bytes.push(Buffer.from([0x22,0xc0,0xaf,0x22,0x0a]),Buffer.from([0x22,0xed,0xa0,0x80,0x22,0x0a]),Buffer.from([0x22,0xf0,0x9f]));
 for(const value of bytes)for(const size of [1,17]){
  await assert.rejects(collect(pieces(value,size)),{code:'CATALOGUE_DAMAGED'});
  await assert.rejects(decoded(pieces(value,size)),{code:'CATALOGUE_DAMAGED'});
 }
});

test('string traversal closes its input on cancellation, failure and early consumer return',async()=>{
 for(const operation of ['cancel','return','invalid']){
  let consumed=0,closed=false;const controller=new AbortController();
  async function* input(){try{consumed++;yield Buffer.from(operation==='invalid'?'false':'"first');consumed++;yield Buffer.from(' second"\n');}finally{closed=true;}}
  const iterator=recordStringJSON(input(),{signal:controller.signal});
  if(operation==='invalid')await assert.rejects(iterator.next(),{code:'CATALOGUE_DAMAGED'});
  else{
   assert.equal((await iterator.next()).value,'"first');
   if(operation==='cancel'){controller.abort(Error('Stopped by reader'));await assert.rejects(iterator.next(),/Stopped by reader/);}
   else await iterator.return();
  }
  assert.equal(closed,true);assert.equal(consumed,operation==='cancel'?2:1);
 }
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {importContent,selectedJSON} from '../src/migration/content.js';
import {selectorLimits} from '../src/migration/selector-contract.js';

// Each object stays under its own limit. The parent keeps half the keys
// live while its child acquires the other half, outside the selected value.
function* fields(count,width){
 let block='';
 for(let i=0;i<count;i++){
  block+='"'+String(i).padEnd(width,'界')+'":0,';
  if(block.length>=4096){yield Buffer.from(block);block='';}
 }
 if(block)yield Buffer.from(block);
}
function* nestedKeys(count,width,{siblings=1,extra=false}={}){
 const half=Math.floor(count/2);
 yield Buffer.from('[1');
 for(let i=0;i<siblings;i++){
  yield Buffer.from(',{');yield* fields(half-1,width);
  yield Buffer.from('"'+'child'.padEnd(width,'界')+'":{');yield* fields(count-half-1,width);
  yield Buffer.from('"'+'last'.padEnd(width,'界')+'":0'+(extra?',"x":0':'')+'}}');
 }
 yield Buffer.from(']');
}

test('JSON conversion limits all live keys and releases each closed object',async()=>{
 const count=selectorLimits.jsonLiveKeys;
 await assert.rejects(selectedJSON(nestedKeys(count,0,{extra:true}),'/0'),{code:'IMPORT_CONTENT'});
 assert.equal(await selectedJSON(nestedKeys(count,0,{siblings:2}),'/0'),'1');
});

test('JSON conversion bounds retained UTF-16 key bytes across objects',async()=>{
 const width=1024,count=selectorLimits.jsonLiveKeyBytes/(2*width);
 await assert.rejects(selectedJSON(nestedKeys(count,width,{extra:true}),'/0'),{code:'IMPORT_CONTENT'});
 assert.equal(await selectedJSON(nestedKeys(count,width,{siblings:2}),'/0'),'1');
});

test('duplicate detection uses exact decoded key units even outside the selected value',async()=>{
 const chunks=text=>Array.from(Buffer.from(text),byte=>Buffer.from([byte]));
 const read=text=>selectedJSON(chunks(text),'/0');
 assert.equal(await read('[1,{"界":0,"\\ud800":1,"\\ud801":2,"�":3}]'),'1');
 await assert.rejects(read('[1,{"界":0,"\\u754c":1}]'),{code:'IMPORT_CONTENT'});
});

test('JSON conversion decodes the supplied byte view and rejects non-buffer chunks',async()=>{
 const buffer=Uint8Array.of(0xff,0x30,0xff).buffer;
 assert.equal(await selectedJSON([new DataView(buffer,1,1)],''),'0');
 await assert.rejects(selectedJSON([[0x30]],''),{code:'IMPORT_CONTENT'});
});

test('JSON conversion admits the selected byte range and checks actual bytes before decoding',async()=>{
 const limit=selectorLimits.jsonConversionBytes,range={kind:'bytes',offset:limit,length:1};
 let reads=0;
 const content={size:limit+1,read(start,end){
  reads++;assert.equal(start,limit);assert.equal(end,limit);return [Buffer.from('0')];
 }};
 await assert.rejects(importContent(content,{selector:{kind:'json-pointer',value:'/x'}},'json'),{code:'IMPORT_CONTENT'});
 assert.equal(reads,0);
 assert.equal((await importContent(content,{selector:range},'json')).body,'0');
 assert.equal(reads,1);

 const spaces=Buffer.alloc(1024*1024,0x20);
 function* tooLarge(){
  for(let i=0;i<limit;i+=spaces.length)yield spaces;
  yield Buffer.from('0');
 }
 await assert.rejects(selectedJSON(tooLarge(),''),{code:'IMPORT_CONTENT'});
});

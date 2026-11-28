import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {incrementalJSONDecoder as sourceDecoder} from '../src/json/browser-parser.js';
import {incrementalJSONDecoder as browserDecoder} from '../src/web/vendor/json-parser.js';
import {upgradeOwnedRecord,upgradeRecord} from '../src/web/record-model.js';

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

test('owned record upgrade avoids copying a newly decoded body and preserves safe default ownership',()=>{
 const source={id:randomUUID(),author:'Original',chart:null,sections:[{body:'Retained content'}]},safe=upgradeRecord(source);
 assert.ok(Object.hasOwn(source,'author'));assert.notEqual(source.sections,safe.sections);const sections=source.sections;
 assert.equal(upgradeOwnedRecord(source),source);assert.equal(source.sections,sections);assert.deepEqual(source,safe);
});

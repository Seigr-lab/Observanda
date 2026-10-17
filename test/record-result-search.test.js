import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RecordDocument} from '../src/record-document.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {resultDocumentSearchText} from '../src/record-result-document.js';
import {retainSearchVocabulary,verifySearchVocabulary} from '../src/record-search-vocabulary.js';
import {retainedQueryProjection} from '../src/record-query-projection.js';
import {recordSearchText} from '../src/web/record-query.js';
import {sampleNotebook} from '../src/sample.js';
import {digest,serialize} from '../src/storage-format.js';
function memory(){const nodes=new Map();return {tree(){return new RecordValueTree(this);},async put(kind,value){const text=serialize(value),revision=digest(text);assert.ok(Buffer.byteLength(text)<=65536);nodes.set(kind+':'+revision,text);return revision;},async read(kind,revision){return JSON.parse(nodes.get(kind+':'+revision));}};}
const statement=(text,title='Result',limitations='Limits')=>({id:randomUUID(),kind:'conclusion',basis:'authored',source:null,title,text,limitations});

test('result search preserves absent, empty, Unicode and large legacy contributions and query spelling',async()=>{
 const diverse=Array.from({length:5600},(_,i)=>String.fromCharCode(0x1000+i)).join('');
 const cases=[undefined,[],[statement('Observed \ud800 \udfff \ud83c\udf3f \u0130 \u03a3','')],[statement('Quoted " \\ text '.repeat(650))],Array.from({length:8},(_,i)=>statement(diverse.slice(i*700,(i+1)*700),'\u03a3 '+i,'\u0130 limits')),Array.from({length:97},(_,i)=>statement('Observation '+i))];
 for(const statements of cases){
  const record={...sampleNotebook().entries[0],body:'Original prose',sections:[],figures:[],attachments:[],relations:[],contributors:[],tags:[],template:null};delete record.attempt;delete record.results;
  if(statements)record.results={version:1,statements};
  const blocks=memory(),document=new RecordDocument(blocks,await blocks.tree().retain(record)),fields=(statements??[]).flatMap(item=>[item.title,item.text,item.limitations]),expected=fields.length?fields.join(' '):null;
  const source=await resultDocumentSearchText(document),chunks=source===null?null:typeof source==='string'?[source]:await Array.fromAsync(source);
  assert.equal(chunks===null?null:chunks.join('').toLocaleLowerCase(),expected?.toLocaleLowerCase()??null);
  if(source!==null&&typeof source!=='string'){assert.ok(chunks.slice(0,-1).every(chunk=>chunk.length===2048));assert.ok(chunks.at(-1).length<=2048);}
  // A single contribution reproduces the former whole-string vocabulary path.
  // Its field shape is only a search fixture, not an admitted authored value.
  const legacy=structuredClone(record);
  if(fields.length)legacy.results.statements=[statement(fields.at(-2),fields.slice(0,-2).join(' '),fields.at(-1))];
  const baseline=new RecordDocument(blocks,await blocks.tree().retain(legacy));
  for(const version of [1,3]){
   const actual=await retainSearchVocabulary(document,{version}),before=await retainSearchVocabulary(baseline,{version});
   await verifySearchVocabulary(blocks,before,blocks,actual);
   if(version>=2)assert.equal((await Array.fromAsync(document.tree.text(actual.text,[]))).join(''),recordSearchText(record));
  }
  const projected=await retainedQueryProjection(document,'a'.repeat(64),{referenceTargets:await document.tree.retain([])});
  assert.equal((await Array.fromAsync(document.tree.text(projected.root,['searchText']))).join(''),recordSearchText(record));
 }
});

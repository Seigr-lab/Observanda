import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RecordDocument} from '../src/record-document.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {changedRecordFields} from '../src/record-document-comparison.js';
import {digest,serialize} from '../src/storage-format.js';
function memory(){
 const nodes=new Map();return {tree(){return new RecordValueTree(this);},
  async put(kind,value){const encoded=serialize(value),revision=digest(encoded);nodes.set(kind+':'+revision,encoded);return revision;},
  async read(kind,revision){const encoded=nodes.get(kind+':'+revision);assert.equal(digest(encoded),revision);return JSON.parse(encoded);}
 };
}
async function document(blocks,value){return new RecordDocument(blocks,await blocks.tree().retain(value),{mutable:true});}
test('history comparison skips shared large owners and preserves canonical field equality',async()=>{
 const blocks=memory(),value={title:'Original',body:'Observation '.repeat(20000),sections:Array.from({length:73},(_,i)=>({id:String(i),body:'Exact '.repeat(2000)})),results:{version:1,statements:[{title:'Result',text:'Measured',extra:null}]},nullable:null};
 const before=await document(blocks,value),after=await before.replace(['title'],'Amended');
 const shared=await Promise.all(['body','sections','results'].map(name=>before.reference([name])));
 let comparisons=0;
 for(const doc of [before,after]){
  const json=doc.tree.json.bind(doc.tree);doc.tree.json=async function*(reference,options){assert.ok(!shared.includes(reference),'Rehashed an unchanged large owner');comparisons++;yield* json(reference,options);};
 }
 assert.deepEqual(await changedRecordFields(before,after,['title','body','sections','results','missing','nullable']),['title']);assert.equal(comparisons,2);
 const reordered=await document(blocks,{...value,results:{statements:[{extra:null,text:'Measured',title:'Result'}],version:1}});
 assert.notEqual(await before.reference(['results']),await reordered.reference(['results']));
 // Different representations with the same canonical content are unchanged.
 before.tree=blocks.tree();assert.deepEqual(await changedRecordFields(before,reordered,['results']),[]);
 const altered=await reordered.replace(['results','statements','0','text'],'Corrected');
 assert.deepEqual(await changedRecordFields(before,altered,['results']),['results']);
 const absent=await document(blocks,{});assert.deepEqual(await changedRecordFields(before,absent,['nullable','missing']),['nullable']);
 const controller=new AbortController();controller.abort();await assert.rejects(changedRecordFields(before,after,['body'],{signal:controller.signal}),{name:'AbortError'});
});

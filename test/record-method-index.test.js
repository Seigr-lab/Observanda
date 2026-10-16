import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RecordDocument} from '../src/record-document.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {RecordMethodIndex} from '../src/record-method-index.js';
import {recordRunComparison} from '../src/record-run-comparison.js';
import {digest,serialize} from '../src/storage-format.js';
function memory(){const nodes=new Map();return {reads:0,nodes,tree(){return new RecordValueTree(this);},async put(kind,value){const encoded=serialize(value),revision=digest(encoded);assert.ok(Buffer.byteLength(encoded)<=65536);nodes.set(kind+':'+revision,encoded);return revision;},async read(kind,revision){this.reads++;const encoded=nodes.get(kind+':'+revision);assert.equal(digest(encoded),revision);return JSON.parse(encoded);}};}
async function fixture(count=19,{methods=true}={}){
 const relations=Array.from({length:count*3},(_,i)=>({id:randomUUID(),role:methods&&i%3===1?'uses-method':'discusses',label:'Context '+i,target:{revision:digest(String(i))}})),record={title:'Investigation',sections:[],relations},blocks=memory(),root=await blocks.tree().retain(record),source=new RecordDocument(blocks,root,{mutable:true}),methodIndex=await RecordMethodIndex.retain(source),document=new RecordDocument(blocks,root,{mutable:true,methodIndex});
 return {record,blocks,source,methodIndex,document};
}
test('late method windows use counted positions without scanning unrelated or earlier links',async t=>{
 for(const count of [19,257,2003]){
  const {document,record,blocks}=await fixture(count),methods=record.relations.filter(r=>r.role==='uses-method');blocks.reads=0;
  const items=document.items.bind(document);document.items=async function*(path,options){assert.notEqual(path[0],'relations','Method comparison scanned relationships');yield* items(path,options);};
  const comparison=await recordRunComparison(document,{windows:{methods:count-3}});assert.deepEqual(comparison.windows.methods,{offset:count-3,total:count,count:3});assert.deepEqual(comparison.methods,methods.slice(-3).map(r=>({label:r.label,revision:r.target.revision})));
  const reads=blocks.reads;assert.ok(reads<350,`${count} methods: ${reads} reads`);t.diagnostic(`${count} methods among ${record.relations.length} relationships: ${reads} logical block reads`);
  const index=await RecordMethodIndex.open(document),last=await index.window({offset:count+100});assert.deepEqual(last.values,comparison.methods.slice(-1));assert.equal(last.page.offset,count-1);
 }
});
test('method indexes follow exact immutable owners and preserve old comparison results',async()=>{
 const f=await fixture(),before=await recordRunComparison(f.document);await (await RecordMethodIndex.open(f.document)).verify();
 const title=await f.document.replace(['title'],'Later explanation');title.items=()=>{throw Error('Unchanged methods were scanned');};assert.deepEqual(await RecordMethodIndex.retain(title),f.methodIndex);
 const changed=await f.document.replace(['relations','1','label'],'Updated method title');assert.equal(await RecordMethodIndex.open(changed),null);const index=await RecordMethodIndex.retain(changed);assert.notEqual(index.source,f.methodIndex.source);
 const next=new RecordDocument(f.blocks,changed.root,{methodIndex:index});await (await RecordMethodIndex.open(next)).verify();assert.equal((await recordRunComparison(next)).methods[0].label,'Updated method title');assert.deepEqual(await recordRunComparison(f.document),before);assert.deepEqual(await recordRunComparison(f.source),before);
 const controller=new AbortController();controller.abort();for(const run of [()=>RecordMethodIndex.retain(changed,{signal:controller.signal}),()=>recordRunComparison(next,{signal:controller.signal}),()=>(new RecordMethodIndex(next,index)).verify({signal:controller.signal})])await assert.rejects(run(),{name:'AbortError'});
});
test('empty and filtered method owners retain accurate totals and reject invalid windows',async()=>{
 for(const count of [0,19,257]){
  const f=await fixture(count,{methods:false});assert.equal(!!f.methodIndex,count*3>64);const result=await recordRunComparison(f.document,{windows:{methods:99}});assert.deepEqual(result.methods,[]);assert.deepEqual(result.windows.methods,{offset:0,total:0,count:0});if(f.methodIndex)await (await RecordMethodIndex.open(f.document)).verify();
 }
 const f=await fixture(),index=await RecordMethodIndex.open(f.document);for(const opts of [{offset:-1},{offset:1.5},{limit:0},{limit:33}])await assert.rejects(index.window(opts),{code:'INVALID'});
});
test('independent method verification rejects omitted, forged and mismatched positions',async()=>{
 const f=await fixture(),original=await RecordMethodIndex.open(f.document);
 for(const value of [{...f.methodIndex,root:null},{...f.methodIndex,relations:f.methodIndex.relations+1},{...f.methodIndex,source:'0'.repeat(64)}])await assert.rejects(new RecordMethodIndex(f.document,value).verify(),{code:'CATALOGUE_DAMAGED'});
 const entry=await original.index.entryAt(original.value,0),row=await f.document.tree.read(entry.revision);
 for(const bad of [{...row,id:randomUUID()},{...row,position:0}]){
  const index=new RecordMethodIndex(f.document,{...f.methodIndex});index.value.root=await index.index.change(index.value.root,entry.id,await f.document.tree.retain(bad));await index.index.flush(index.value.root);await assert.rejects(index.window(),{code:'CATALOGUE_DAMAGED'});await assert.rejects(index.verify(),{code:'CATALOGUE_DAMAGED'});
 }
 const index=new RecordMethodIndex(f.document,{...f.methodIndex});index.value.root=await index.index.change(index.value.root,'0000000000000000',await f.document.tree.retain({id:f.record.relations[0].id,position:0}));await index.index.flush(index.value.root);await assert.rejects(index.window(),{code:'CATALOGUE_DAMAGED'});await assert.rejects(index.verify(),{code:'CATALOGUE_DAMAGED'});
});

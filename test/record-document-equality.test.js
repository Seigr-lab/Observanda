import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RecordDocument} from '../src/record-document.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {RecordContainerBuilder} from '../src/record-tree-values.js';
import {documentRevision,sameDocumentContent} from '../src/record-document-revision.js';
import {digest,serialize} from '../src/storage-format.js';

function memory(){const nodes=new Map();return {reads:0,
 async put(kind,value){const encoded=serialize(value),hash=digest(encoded);nodes.set(kind+':'+hash,encoded);return hash;},
 async read(kind,hash){this.reads++;return JSON.parse(nodes.get(kind+':'+hash));},tree(){return new RecordValueTree(this);}};}
const document=async(blocks,value)=>new RecordDocument(blocks,await blocks.tree().retain(value),{mutable:true});

test('content equality follows canonical revisions across changed, missing and differently encoded values',async()=>{
 const blocks=memory(),base={id:'Original',title:'Exact title',status:'draft',updatedAt:'Earlier',nullable:null,body:'a'.repeat(70000)+' 🌿 \ud800',sections:[{title:'First',body:'Original'},{title:'Second',body:'Next'}],values:{z:0,a:1,'10':2,'2':3}};
 const previous=await document(blocks,base),cases=[
  {...base,status:'completed',updatedAt:'Later'}, {...base,title:'Changed title'}, {...base,nullable:''},
  {...base,body:base.body+'a'}, {...base,sections:base.sections.slice().reverse()},
  {...base,sections:[...base.sections,{title:'Third',body:'Added'}]},
  {...base,values:{a:1,z:0,'2':3,'10':2}}, {...base,values:{a:1,z:-0,'2':3,'10':2}},
  {...base,extra:null}, Object.fromEntries(Object.entries(base).filter(([name])=>name!=='nullable'))
 ];
 for(const value of cases)for(const omit of [[],['status','updatedAt'],['body','sections']]){
  const next=await document(blocks,value),expected=await documentRevision(previous,{omit})===await documentRevision(next,{omit});
  assert.equal(await sameDocumentContent(previous,next,{omit}),expected);assert.equal(await sameDocumentContent(next,previous,{omit}),expected);
 }
 // Expanded containers and inline values can encode the same canonical value.
 const list=new RecordContainerBuilder(blocks,'array');for(const item of base.sections)await list.add({value:await blocks.tree().retain(item)});
 const expanded=new RecordDocument(blocks,await previous.replaceReference(previous.root,['sections'],await list.finish()));
 assert.notEqual(await previous.reference(['sections']),await expanded.reference(['sections']));assert.equal(await sameDocumentContent(previous,expanded),true);
});

test('content comparison skips unchanged bodies and sections across growth and hashes only changed owners',async t=>{
 const measured=[];
 for(const count of [19,257,2003]){
  const blocks=memory(),base={id:'Original',title:'Exact title',status:'draft',updatedAt:'Earlier',body:'Original summary',sections:Array.from({length:count},(_,i)=>({title:'Section '+i,body:'Exact unchanged observations '.repeat(50)}))},previous=await document(blocks,base),next=await previous.replace(['status'],'completed');
  const original=previous.tree.json,changed=next.tree.json;
  previous.tree.json=next.tree.json=()=>{throw Error('Equality rehashed unchanged content');};blocks.reads=0;
  assert.equal(await sameDocumentContent(previous,next,{omit:['status','updatedAt']}),true);measured.push(blocks.reads);t.diagnostic(`${count} sections: ${blocks.reads} reads and no content hashing`);
  previous.tree.json=original;next.tree.json=changed;
  const amended=await previous.replace(['title'],'Changed title'),allowed=new Set([await previous.reference(['title']),await amended.reference(['title'])]),calls=[];
  const inspect=source=>{const json=source.tree.json;source.tree.json=function(ref,...options){assert.ok(allowed.has(ref),'A different owner was hashed');calls.push(ref);return json.call(this,ref,...options);};};
  inspect(previous);inspect(amended);assert.equal(await sameDocumentContent(previous,amended,{omit:['status','updatedAt']}),false);assert.equal(calls.length,2);
 }
 assert.ok(Math.max(...measured)-Math.min(...measured)<10,'Equality work grew with unchanged sections');
});

test('content equality honors cancellation and rejects invalid changed encodings',async()=>{
 const blocks=memory(),previous=await document(blocks,{body:'kept',sections:[]}),next=await previous.replace(['body'],'changed'),abort=new AbortController();
 abort.abort(Error('Stop comparison'));await assert.rejects(sameDocumentContent(previous,next,{signal:abort.signal}),/Stop comparison/);
 next.tree.json=async function*(){yield '"changed"';throw Error('Damaged trailing content');};await assert.rejects(sameDocumentContent(previous,next),/Damaged trailing content/);
});

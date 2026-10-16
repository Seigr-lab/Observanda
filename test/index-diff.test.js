import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ObjectIndex} from '../src/object-index.js';
import {digest} from '../src/storage-format.js';

function fixture(){
 const nodes=new Map();let reads=0;
 const storage={read:async ref=>{reads++;return nodes.get(ref.hash);},write:async(ref,node)=>nodes.set(ref.hash,node)};
 return {nodes,index:()=>new ObjectIndex({}, {immutable:true,nodeStorage:storage}),reset:()=>{reads=0;},reads:()=>reads};
}
const key=n=>'record:'+String(n).padStart(6,'0'),version=n=>digest(String(n));
const expected=(before,after,prefix='')=>[...new Set([...before.keys(),...after.keys()])].sort().filter(id=>id.startsWith(prefix)&&before.get(id)!==after.get(id)).map(id=>({
 id,before:before.has(id)?{id,revision:before.get(id)}:null,after:after.has(id)?{id,revision:after.get(id)}:null
}));
async function balanced(f,values){
 const index=f.index(),entries=[...values].sort(([a],[b])=>a<b?-1:1);
 const build=(low,high)=>{if(low===high)return null;const mid=(low+high)>>1,[id,revision]=entries[mid];return index.make(id,revision,build(low,mid),build(mid+1,high));};
 const root=build(0,entries.length);await index.flush(root);return root;
}

test('root comparison skips unchanged branches at declared tenfold growth, including insertions and deletions',async t=>{
 // Budgets are declared before execution: <= 24*tree height node reads and
 // <=128 retained cache entries for three edits, independent of corpus size.
 for(const size of [42,420,4200]){
  const f=fixture(),before=new Map();
  for(let i=0;i<size;i++){before.set(key(i),version(i));before.set('book:'+key(i),version(i));}
  const root=await balanced(f,before),writer=f.index(),after=new Map(before);let next=root;
  for(const [id,value] of [[key(0),null],[key(size>>1),version('changed')],[key(size+1),version('new')]]){
   if(value===null)after.delete(id);else after.set(id,value);next=await writer.change(next,id,value);
  }
  await writer.flush(next);f.reset();const reader=f.index();
  assert.deepEqual(await Array.fromAsync(reader.differences(root,next,'record:')),expected(before,after,'record:'));
  assert.ok(f.reads()<=24*Math.max(root.height,next.height),'node reads: '+f.reads());assert.ok(reader.cache.size<=128);
  t.diagnostic(size+' records: '+f.reads()+' node reads, '+reader.cache.size+' retained nodes.');
  f.reset();assert.deepEqual(await Array.fromAsync(f.index().differences(root,root)),[]);assert.equal(f.reads(),0);
 }
});

test('ordered differences match an independent map oracle through mixed rotations, prefix scopes and empty roots',async()=>{
 const f=fixture();let seed=9,root=null,values=new Map();
 const random=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
 for(let batch=0;batch<60;batch++){
  const old=root,before=new Map(values),index=f.index();
  for(let i=0;i<12;i++){
   const id=(random()%5===0?'book:':'')+key(random()%160),value=random()%3===0?null:version(random());
   root=await index.change(root,id,value);if(value===null)values.delete(id);else values.set(id,value);
  }
  await index.flush(root);
  for(const prefix of ['', 'record:', 'book:', 'absent:', 'record:00001']){
   assert.deepEqual(await Array.fromAsync(f.index().differences(old,root,prefix)),expected(before,values,prefix));
   assert.deepEqual(await Array.fromAsync(f.index().differences(root,old,prefix)),expected(values,before,prefix));
  }
 }
 assert.deepEqual(await Array.fromAsync(f.index().differences(root,null)),expected(values,new Map()));
 const rebuilt=await balanced(f,values);
 assert.deepEqual(await Array.fromAsync(f.index().differences(root,rebuilt)),[],'different valid tree shapes can represent identical content');
});

test('changed branches and inconsistent root references fail integrity checks',async()=>{
 const f=fixture(),root=await balanced(f,new Map(Array.from({length:31},(_,i)=>[key(i),version(i)]))),writer=f.index();
 const next=await writer.change(root,key(3),version('new'));await writer.flush(next);
 await assert.rejects(Array.fromAsync(f.index().differences(root,{...root,count:root.count+1})),{code:'CATALOGUE_DAMAGED'});
 f.nodes.delete(next.hash);
 await assert.rejects(Array.fromAsync(f.index().differences(root,next)),{code:'CATALOGUE_DAMAGED'});
});

test('cancelling a traversal stops before reading another branch',async()=>{
 const f=fixture(),root=await balanced(f,new Map(Array.from({length:100},(_,i)=>[key(i),version(i)]))),controller=new AbortController(),reader=f.index();
 const read=reader.readNode.bind(reader);let reads=0;
 reader.readNode=async ref=>{reads++;const node=await read(ref);controller.abort();return node;};
 await assert.rejects(Array.fromAsync(reader.differences(root,null,'record:',{signal:controller.signal})),{name:'AbortError'});
 assert.equal(reads,1);
});

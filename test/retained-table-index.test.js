import '../src/storage.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RetainedTableIndex} from '../src/retained-table-index.js';
import {ComparisonTableIndex} from '../src/analysis-comparison-table.js';
import {MaterialSequence} from '../src/material-sequence.js';
import {digest,serialize} from '../src/storage-format.js';
const key=i=>'value/'+String(i).padStart(8,'0');
function memory(){const nodes=new Map();return {reads:0,async put(kind,value){const raw=serialize(value),revision=digest(raw);nodes.set(kind+':'+revision,raw);return revision;},async read(kind,revision){this.reads++;return JSON.parse(nodes.get(kind+':'+revision));}};}

test('batched table edits preserve sparse ranks, old roots and no-op identity through growth and removal',async t=>{
 const storage=memory(),tree=new RetainedTableIndex(storage,{allowSparseBranches:true}),expected=new Map();let root=null;
 const apply=async changes=>{changes.sort((a,b)=>a.id<b.id?-1:1);root=await tree.changeMany(root,changes);await tree.flush(root);for(const entry of changes){if(entry.revision===null)expected.delete(entry.id);else expected.set(entry.id,entry.revision);}assert.deepEqual(await Array.fromAsync(tree.entries({root})),[...expected].sort(([a],[b])=>a<b?-1:1).map(([id,revision])=>({id,revision})));};
 await apply(Array.from({length:8201},(_,i)=>({id:key(i),revision:digest(key(i))})));const original=root;
 storage.reads=0;const fresh=new RetainedTableIndex(storage,{allowSparseBranches:true}),amendments=Array.from({length:100},(_,i)=>({id:key(8101+i),revision:digest('changed '+i)})),changed=await fresh.changeMany(root,amendments);await fresh.flush(changed);assert.ok(storage.reads<15);t.diagnostic('100 nearby changes among 8,201 entries read '+storage.reads+' index pages');
 await apply(amendments);assert.deepEqual(await tree.changeMany(root,amendments),root);
 await apply(Array.from({length:9500},(_,i)=>({id:key(i),revision:i%3===0?null:digest('next '+i)})));
 for(const ordinal of [0,30,31,1024,expected.size-1]){const entry=await tree.entryAt({root},ordinal);assert.equal(await tree.rank({root},entry.id),ordinal);}
 await apply([...expected.keys()].filter(id=>id!==key(9499)).map(id=>({id,revision:null})));assert.equal(root.height,1);assert.equal(root.count,1);
 await apply([{id:key(9499),revision:null}]);assert.equal(root,null);assert.equal((await Array.fromAsync(tree.entries({root:original}))).length,8201);
 await assert.rejects(tree.changeMany(original,[{id:key(0),revision:null},{id:key(0),revision:null}]),{code:'INVALID'});
 await assert.rejects(tree.changeMany(original,[{id:key(0),revision:null}],{signal:AbortSignal.abort()}),{name:'AbortError'});
});

test('retained table differences match full maps across splits, removals, sparse branches and independently packed roots',async()=>{
 const storage=memory(),tree=new RetainedTableIndex(storage,{allowSparseBranches:true}),before=new Map(),after=new Map();let a=null,b=null;
 for(let i=0;i<1103;i++){const id=key(i*1297%1103),revision=digest(id);before.set(id,revision);a=await tree.change(a,id,revision);if(i%32===0)await tree.flush(a);}await tree.flush(a);
 for(let i=1400;i>=0;i--){if(i%7===0)continue;const id=key(i),revision=digest(i%13===0?'changed '+id:id);after.set(id,revision);b=await tree.change(b,id,revision);if(i%32===0)await tree.flush(b);}await tree.flush(b);
 const reader=new RetainedTableIndex(storage,{allowSparseBranches:true}),expected=(own,other)=>[...new Set([...own.keys(),...other.keys()])].sort().filter(id=>own.get(id)!==other.get(id)).map(id=>({id,before:own.has(id)?{id,revision:own.get(id)}:null,after:other.has(id)?{id,revision:other.get(id)}:null}));
 for(const [x,y,m,n] of [[a,b,before,after],[b,a,after,before],[null,b,new Map(),after],[a,null,before,new Map()],[null,null,new Map(),new Map()]])assert.deepEqual(await Array.fromAsync(reader.differences(x,y)),expected(m,n));
 let changed=a;for(let i=0;i<1103;i+=2)changed=await tree.remove(changed,key(i));await tree.flush(changed);
 assert.deepEqual(await Array.fromAsync(reader.differences(a,changed)),expected(before,new Map([...before].filter(([id])=>Number(id.slice(6))%2))));
 await assert.rejects(Array.fromAsync(reader.differences(a,{...a,count:a.count+1})),{code:'MATERIAL_MISSING'});
 await assert.rejects(Array.fromAsync(reader.differences(a,b,{signal:AbortSignal.abort()})),{name:'AbortError'});
});

test('a selected table edit reads only changed index paths as retained collections grow',async t=>{
 for(const count of [257,8201]){
  const storage=memory(),tree=new RetainedTableIndex(storage,{allowSparseBranches:true});let root=null;
  for(let i=0;i<count;i++){root=await tree.change(root,key(i),digest(key(i)));if(i%32===0)await tree.flush(root);}await tree.flush(root);
  const last=key(count-1),next=await tree.change(root,last,digest('changed'));await tree.flush(next);storage.reads=0;
  const reader=new RetainedTableIndex(storage,{allowSparseBranches:true});assert.deepEqual(await Array.fromAsync(reader.differences(root,next)),[{id:last,before:{id:last,revision:digest(last)},after:{id:last,revision:digest('changed')}}]);
  assert.ok(storage.reads<=2*root.height+2,'Read work should follow index height');t.diagnostic(`${count} entries: ${storage.reads} index reads for one changed value`);
  storage.reads=0;assert.deepEqual(await Array.fromAsync(reader.differences(root,root)),[]);assert.equal(storage.reads,0);
 }
});

test('packed work tables delete across branches without changing retained checkpoints',async()=>{
 const objects=new Map(),sequences=new MaterialSequence({readMetadata:async name=>objects.get(name)??null,writeMetadata:async(name,text)=>objects.set(name,text)});
 let tree=new RetainedTableIndex(sequences,{allowSparseBranches:true}),root=null;const total=1103;
 for(let i=0;i<total;i++){const id=key(i*1297%total);root=await tree.change(root,id,digest(id));if(i%64===0)await tree.flush(root);}
 await tree.flush(root);const checkpoint=root;assert.ok(root.height>=3);
 const survivors=[];
 for(let i=0;i<total;i++){
  if(i%2||i===0||i===total-1)root=await tree.remove(root,key(i));else survivors.push(i);
  if(i%64===0)await tree.flush(root);
 }
 await tree.flush(root);tree=new RetainedTableIndex(sequences,{allowSparseBranches:true});
 assert.equal(root.count,survivors.length);
 assert.deepEqual((await Array.fromAsync(tree.entries({root}))).map(row=>row.id),survivors.map(key));
 for(let i=0;i<survivors.length;i++){assert.equal((await tree.entryAt({root},i)).id,key(survivors[i]));assert.equal(await tree.rank({root},key(survivors[i])),i);}
 assert.equal((await tree.find({root:checkpoint},key(0))).revision,digest(key(0)));assert.equal(checkpoint.count,total);
 const same=await tree.remove(root,'absent');assert.deepEqual(same,root);
 for(const i of survivors)if(i!==500)root=await tree.remove(root,key(i));
 await tree.flush(root);assert.equal(root.count,1);assert.equal(root.height,1);assert.equal((await tree.entryAt({root},0)).id,key(500));
 root=await tree.change(root,key(5),digest('new'));root=await tree.remove(root,key(500));root=await tree.remove(root,key(5));await tree.flush(root);assert.equal(root,null);
 assert.equal((await Array.fromAsync(tree.entries({root:checkpoint}))).length,total);
 await assert.rejects(new ComparisonTableIndex(sequences).remove(checkpoint,key(0)),{code:'INVALID'});
 assert.ok([...objects.keys()].every(name=>name.includes('/table-nodes/')));
});


test('multi-root flush retains shared frontiers once and rejects corrupt duplicate references',async()=>{
 const storage=memory(),put=storage.put,writes=[];storage.put=async(kind,value)=>{const revision=await put(kind,value);writes.push(revision);return revision;};
 const tree=new RetainedTableIndex(storage,{allowSparseBranches:true});let first=null,other=null;
 for(let i=0;i<70;i++){first=await tree.change(first,key(i),digest(key(i)));other=await tree.change(other,'other/'+key(i),digest(key(i)));}
 const second=await tree.change(first,key(69),digest('changed'));
 assert.ok(tree.pendingBytes>0);await tree.flushRoots([first,second,other]);assert.equal(new Set(writes).size,writes.length);assert.equal(tree.pendingBytes,0);
 const reader=new RetainedTableIndex(storage,{allowSparseBranches:true});assert.equal((await reader.find({root:first},key(69))).revision,digest(key(69)));assert.equal((await reader.find({root:second},key(69))).revision,digest('changed'));assert.equal((await Array.fromAsync(reader.entries({root:other}))).length,70);
 const changed=await tree.change(second,key(0),digest('next'));
 await assert.rejects(tree.flushRoots([changed,{...changed,count:changed.count+1}]),{code:'MATERIAL_MISSING'});
 assert.ok(tree.pending.size>0,'An unsuccessful multi-root flush must not discard any pending frontier');
 await tree.flushRoots([changed]);assert.equal((await reader.find({root:changed},key(0))).revision,digest('next'));
});

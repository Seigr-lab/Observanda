import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ComparisonTableIndex} from '../src/analysis-comparison-table.js';
import {MaterialSequence} from '../src/material-sequence.js';
import {digest,serialize} from '../src/storage-format.js';

const fixture=()=>{
 const objects=new Map(),sequences=new MaterialSequence({readMetadata:async name=>objects.get(name)??null,writeMetadata:async(name,text)=>objects.set(name,text)});
 return {objects,sequences,tree:new ComparisonTableIndex(sequences)};
};
const key=i=>'row/'+String(i).padStart(8,'0');

test('packed comparison trees retain exact ordered seeks across splits, checkpoints and revised values',async()=>{
 const f=fixture();let root=null;const total=3503,expected=new Map();
 // A coprime stride exercises insertions at both edges and in existing leaves.
 for(let i=0;i<total;i++){
  const id=key(i*1297%total),revision=digest(id);expected.set(id,revision);root=await f.tree.change(root,id,revision);
  if(i%97===0)await f.tree.flush(root);
 }
 await f.tree.flush(root);const original=root,before=[...expected].sort(([a],[b])=>a<b?-1:1),reopened=new ComparisonTableIndex(f.sequences);
 assert.equal(root.count,total);assert.ok(root.height>=3);
 for(const i of [0,1,31,32,511,1024,total-1]){
  assert.deepEqual(await reopened.entryAt({root},i),{id:before[i][0],revision:before[i][1]});
  assert.equal(await reopened.rank({root},key(i)),i);assert.equal((await reopened.find({root},key(i))).revision,digest(key(i)));
 }
 assert.equal(await reopened.rank({root},'zzzz'),total);assert.equal(await reopened.entryAt({root},total),null);assert.equal(await reopened.find({root},'missing'),null);
 const revised=digest('revised');root=await reopened.change(root,key(1024),revised);await reopened.flush(root);
 assert.equal((await reopened.find({root:original},key(1024))).revision,digest(key(1024)));assert.equal((await reopened.find({root},key(1024))).revision,revised);assert.equal(root.count,total);
 assert.deepEqual((await Array.fromAsync(reopened.entries({root:original}))).map(entry=>[entry.id,entry.revision]),before);
 await assert.rejects(reopened.node({...root,count:root.count+1}),{code:'MATERIAL_MISSING'});
 await assert.rejects(Array.fromAsync(reopened.nodes(root,{signal:AbortSignal.abort()})),{name:'AbortError'});
});

test('packed comparison trees reject damaged pages and authenticated but inconsistent child bounds',async()=>{
 const f=fixture();let root=null;for(let i=0;i<70;i++)root=await f.tree.change(root,key(i),digest(key(i)));await f.tree.flush(root);
 const node=await f.tree.node(root),child=node.children[0],file='.observanda/materials/sequences/comparison-nodes/'+child.hash+'.json',original=f.objects.get(file);
 f.objects.set(file,original.replace('row/00000000','row/00000001'));
 await assert.rejects(new ComparisonTableIndex(f.sequences).find({root},key(0)),{code:'MATERIAL_MISSING'});f.objects.set(file,original);
 const inconsistent={children:node.children.map((ref,i)=>i===0?{...ref,last:'row/00000000'}:ref)},version=digest(serialize(inconsistent));f.objects.set('.observanda/materials/sequences/comparison-nodes/'+version+'.json',serialize(inconsistent));
 await assert.rejects(new ComparisonTableIndex(f.sequences).entryAt({root:{...root,hash:version}},0),{code:'MATERIAL_MISSING'});
});

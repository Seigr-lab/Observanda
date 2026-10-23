import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RecordDocument} from '../src/record-document.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {digest,serialize} from '../src/storage-format.js';
import {hasRetainedFigures,retainedFigureDocument} from '../src/record-retained-figures.js';
import {ownedStorageLeaseFile,workspaceOwnerLeaseFile} from '../src/owned-storage-control.js';

async function document(value){
 const nodes=new Map(),reads=new Set(),memory={
  async put(kind,node){const hash=digest(serialize(node));nodes.set(kind+':'+hash,node);return hash;},
  async read(kind,hash){reads.add(kind+':'+hash);return structuredClone(nodes.get(kind+':'+hash));}
 };
 const tree=new RecordValueTree(memory),root=await tree.retain(value);
 return {tree,nodes,reads,document:new RecordDocument({tree:()=>tree},root)};
}

test('retained storage admission recognizes top-level and mixed-panel figures without reading point collections',async()=>{
 const points=Array.from({length:3000},(_,index)=>({x:String(index),y:String(index+1)})),inline={kind:'scatter',series:[{points}]};
 for(const value of [{},{figures:[inline]},{figures:[{kind:'retained'}]},{figures:[{kind:'panels',panels:[{figure:inline}]}]},{figures:[{kind:'panels',panels:[{figure:inline},{figure:{kind:'retained'}}]}]}]){
  const expected=value.figures?.some(figure=>figure.kind==='retained'||figure.panels?.some(panel=>panel.figure.kind==='retained'))===true,f=await document(value);
  const pointRoots=new Set([...f.nodes].filter(([,node])=>node.type==='inline'&&node.value&&typeof node.value==='object'&&!Array.isArray(node.value)&&Object.hasOwn(node.value,'x')&&Object.hasOwn(node.value,'y')).map(([key])=>key));
  if(value.figures?.includes(inline)||value.figures?.some(figure=>figure.panels?.some(panel=>panel.figure===inline)))assert.ok(pointRoots.size>0,'point-page assertion must exercise stored point nodes');
  assert.equal(hasRetainedFigures(value),expected);assert.equal(await retainedFigureDocument(f.document),expected);
  for(const key of pointRoots)assert.equal(f.reads.has(key),false,'admission must not read point pages');
 }
});

test('retained storage admission honors cancellation before examining an empty document',async()=>{
 const f=await document({}),controller=new AbortController(),reason=new Error('cancelled');controller.abort(reason);
 await assert.rejects(retainedFigureDocument(f.document,{signal:controller.signal}),error=>error===reason);assert.equal(f.reads.size,0);
});

test('review OS lease controls are excluded only at their exact internal location',()=>{
 const id='12345678-1234-1234-1234-123456789abc',lease='.observanda/reviews/leases/'+id+'.lock';
 assert.equal(ownedStorageLeaseFile(lease),true);assert.equal(workspaceOwnerLeaseFile(lease),true);
 for(const relative of ['attachments/'+id+'.lock','.observanda/reviews/parts/'+id+'.lock',lease+'.json',lease+'/content','.observanda/reviews/leases/other.lock'])assert.equal(ownedStorageLeaseFile(relative),false);
});

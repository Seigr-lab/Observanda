import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {figureValueFixture} from './record-figure-values-fixture.js';
import {preparationCheckpoint} from './record-preparation-fixture.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {RecordBlockStore} from '../src/record-block-store.js';
import {RecordValueDrafts} from '../src/record-value-drafts.js';
import {ResearchDrafts} from '../src/research-drafts.js';

test('selected preparation checkpoints read and write bounded rows at independent nested collection scales',async t=>{
 const f=await figureValueFixture();t.after(f.close);const edit=await preparationCheckpoint(f,{count:8}),samples=[];let measured=false,reads=0,blocks=new Set();
 const read=RecordValueTree.prototype.read,put=RecordBlockStore.prototype.put;
 t.mock.method(RecordValueTree.prototype,'read',async function(...args){const value=await read.apply(this,args);if(measured&&value?.id&&typeof value.label==='string')reads++;return value;});
 t.mock.method(RecordBlockStore.prototype,'put',async function(...args){const hash=await put.apply(this,args);if(measured)blocks.add(args[0]+':'+hash);return hash;});
 for(const count of [8,800]){
  if(count===800)for(let offset=8;offset<count;offset+=20)await edit.change(Array.from({length:Math.min(20,count-offset)},(_,i)=>({type:'append',collection:'observations',value:{id:randomUUID(),label:'Observation '+(offset+i)}})));
  const page=await edit.owner.window({...edit.command,collection:'observations',offset:count-1}),row=page.items[0];reads=0;blocks=new Set();measured=true;
  await edit.change([{type:'replace',collection:'observations',position:row.position,id:row.value.id,revision:row.revision,value:{...row.value,label:'Selected late observation '+count}}]);
  const current=await edit.owner.window({...edit.command,collection:'observations',offset:count-1});measured=false;
  assert.equal(current.items[0].value.label,'Selected late observation '+count);assert.equal(current.total,count);assert.ok(reads<=24,'read row bodies '+reads);assert.ok(blocks.size<=100,'wrote immutable blocks '+blocks.size);samples.push({count,readRows:reads,writtenBlocks:blocks.size});
  await assert.rejects(edit.change([{type:'append',collection:'observations',value:current.items[0].value}]),{code:'INVALID'});
 }
 console.log('Selected preparation work',JSON.stringify(samples));
 const saved=await new ResearchDrafts(f.workspace).read(edit.id,{header:true});await f.workspace.catalogue(store=>assert.rejects(new RecordValueDrafts(f.workspace).verify(store,{...saved.draft,preparationEdit:{...saved.draft.preparationEdit,identities:{...saved.draft.preparationEdit.identities,root:null}}}),{code:'CATALOGUE_DAMAGED'}));
 await edit.owner.save(edit.command);
});

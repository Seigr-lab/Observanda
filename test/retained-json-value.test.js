import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MaterialSequence} from '../src/material-sequence.js';
import {RetainedJsonValue} from '../src/retained-json-value.js';
import {digest,serialize} from '../src/storage-format.js';

function fixture(){
 const data=new Map(),workspace={async readMetadata(key,limit){const value=data.get(key)??null;if(value!==null)assert.ok(Buffer.byteLength(value)<=limit);return value;},async writeMetadata(key,value){assert.ok(Buffer.byteLength(value)<=131072);data.set(key,value);}};
 const sequences=new MaterialSequence(workspace),store=new RetainedJsonValue(sequences,fn=>fn());return {data,sequences,store};
}
test('retained JSON values span multiple indexed chunk pages and verify exact UTF-8 content',async()=>{
 const f=fixture(),value={text:'Ω𐐷\n'.repeat(620000),exact:'9007199254740993/7'},ref=await f.store.put(value);
 assert.ok(ref.chunks.count>64);assert.deepEqual(await f.store.read(ref),value);assert.equal(ref.hash,digest(serialize(value)));
 await assert.rejects(f.store.read({...ref,bytes:ref.bytes+1}),{code:'MATERIAL_MISSING'});
 await assert.rejects(f.store.read({...ref,hash:'0'.repeat(64)}),{code:'MATERIAL_MISSING'});
 const id=await f.sequences.item(ref.chunks,ref.chunks.count-1),path='.observanda/materials/sequences/json-value-chunks/'+id+'.json';
 const original=f.data.get(path);f.data.delete(path);await assert.rejects(f.store.read(ref),{code:'MATERIAL_MISSING'});
 f.data.set(path,original.replace('data','wrong'));await assert.rejects(f.store.read(ref),{code:'MATERIAL_MISSING'});
});
test('retained JSON values validate chunk encoding and cancellation before exposing a value',async()=>{
 const f=fixture(),ref=await f.store.put({text:'small'}),chunks=f.sequences.builder('pages',fn=>fn());
 const bad=await f.sequences.put('json-value-chunks',{data:'e30=\n'});await chunks.append(bad);
 await assert.rejects(f.store.read({...ref,bytes:2,hash:digest('{}'),chunks:await chunks.finish()}),{code:'MATERIAL_MISSING'});
 const signal=AbortSignal.abort(),cancelled=new RetainedJsonValue(f.sequences,fn=>fn(),{signal});
 await assert.rejects(cancelled.put({text:'small'}),{name:'AbortError'});await assert.rejects(cancelled.read(ref),{name:'AbortError'});
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EvaluationPageCache} from '../src/evaluation-page-cache.js';
import {DatasetWindowReader} from '../src/dataset-window-reader.js';
import {GraphSourceReader} from '../src/graph-source-reader.js';
import {defaultWindow} from '../src/web/dataset-window-model.js';

test('calculation page cache bounds bytes and entries, refreshes recency and skips oversized pages',()=>{
 const cache=new EvaluationPageCache({maxPages:2,maxBytes:100});cache.set('a',{v:1});cache.set('b',{v:2});assert.deepEqual(cache.get('a'),{v:1});cache.set('c',{v:3});assert.equal(cache.get('b'),undefined);
 cache.set('large',{text:'x'.repeat(200)});assert.equal(cache.get('large'),undefined);assert.ok(cache.bytes<=100);assert.equal(cache.size,2);
 cache.set('a',{text:'\u754c'.repeat(28)});assert.equal(cache.size,1);assert.equal(cache.get('c'),undefined);assert.ok(cache.bytes<=100);
 cache.clear();assert.equal(cache.size,0);assert.equal(cache.bytes,0);
 for(const options of [{maxPages:0},{maxBytes:0},{maxPages:129},{maxBytes:Infinity}])assert.throws(()=>new EvaluationPageCache(options),RangeError);
});

function fixture(){
 let reads=0,pages=0,denied=false;
 const source={kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},binding={source},location={kind:'dataset',page:0,row:0,id:'row0',excluded:null},node={operation:'sum',column:0,window:{...defaultWindow(),start:0,end:0}},doc={content:{datasetFormat:3,rowCount:1}};
 const materials={async read(){reads++;if(denied)throw Error('revoked');return doc;},async retainedDatasetPage(_doc,page,{columns=[0]}={}){pages++;return {rows:[{id:'row'+page,cells:[String(columns[0])],valueKinds:['string'],excluded:null}]};}};
 return {source,binding,location,node,materials,get reads(){return reads;},get pages(){return pages;},deny(){denied=true;}};
}

test('alternating window columns reuse pages while every open rechecks visibility',async()=>{
 const f=fixture(),reader=new DatasetWindowReader(f.materials);
 for(let i=0;i<100;i++){const column=i%2,window=await reader.open({...f.node,column},f.binding,f.location);assert.equal((await window.at(0)).value,String(column));}
 assert.equal(f.reads,100);assert.equal(f.pages,2);assert.equal(reader.pages.size,2);
 const next={source:{...f.source,revision:'b'.repeat(64)}};await reader.open(f.node,next,f.location);assert.equal(f.pages,3);
 f.deny();await assert.rejects(reader.open(f.node,f.binding,f.location),/revoked/);
});

test('alternating graph sources and pages remain isolated and cache misses obey admission',async()=>{
 const f=fixture(),reader=new GraphSourceReader(f.materials),other={source:{...f.source,id:randomUUID()}};
 for(let i=0;i<100;i++)assert.equal((await reader.read(i%2?other:f.binding,f.location)).row.id,'row0');
 assert.equal(f.reads,100);assert.equal(f.pages,2);
 await reader.read(f.binding,{...f.location,page:1,id:'row1'});assert.equal(f.pages,3);
 f.deny();await assert.rejects(reader.read(f.binding,f.location),/revoked/);
});

test('oversized window pages are usable but never retained, and cancellation after a read cannot populate the cache',async()=>{
 const f=fixture(),reader=new DatasetWindowReader(f.materials,{maxBytes:1});
 for(let i=0;i<2;i++)assert.equal((await (await reader.open(f.node,f.binding,f.location)).at(0)).value,'0');assert.equal(reader.pages.size,0);assert.ok(f.pages>=2);
 const controller=new AbortController(),reason=Error('cancel page read'),cancelled=new DatasetWindowReader({...f.materials,retainedDatasetPage:async()=>{controller.abort(reason);return {rows:[]};}});
 await assert.rejects(cancelled.open(f.node,f.binding,f.location,{signal:controller.signal}),error=>error===reason);assert.equal(cancelled.pages.size,0);
});

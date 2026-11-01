import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatasetOrdinalCache} from '../src/dataset-ordinal-cache.js';
import {DatasetWindowReader} from '../src/dataset-window-reader.js';
import {defaultWindow} from '../src/web/dataset-window-model.js';

test('legacy ordinal anchors preserve variable and empty pages under eviction and source changes',async()=>{
 const cache=new DatasetOrdinalCache({maxAnchors:3,maxBytes:512}),lengths=[0,3,0,1,7,0,2],load=async page=>lengths[page],prefix=lengths.map((_,i)=>lengths.slice(0,i).reduce((a,b)=>a+b,0));
 for(let iteration=0;iteration<5;iteration++)for(const ordinal of [12,0,7,2,3,10,1,11,4]){
  const source=iteration%2?'owner-a/revision-a':'owner-b/revision-a',address=await cache.locate(source,ordinal,lengths.length,load),page=lengths.findIndex((count,i)=>ordinal>=prefix[i]&&ordinal<prefix[i]+count);
  assert.deepEqual(address,{page,row:ordinal-prefix[page]});assert.ok(cache.anchors.size<=3);assert.ok(cache.bytes<=512);
 }
 for(let page=0;page<lengths.length;page++)assert.equal(await cache.pageStart('another-revision',page,load),prefix[page]);
 await assert.rejects(cache.locate('source',13,lengths.length,load),{code:'DATASET_WINDOW_INVALID'});
 cache.remember('stable',1,4);assert.throws(()=>cache.remember('stable',1,5),{code:'DATASET_WINDOW_INVALID'});
 const controller=new AbortController();controller.abort();await assert.rejects(cache.pageStart('cancelled',100,load,{signal:controller.signal}),{name:'AbortError'});
 cache.clear();assert.equal(cache.bytes,0);assert.equal(cache.anchors.size,0);
});

for(const count of [100,1000])test(`adjacent legacy windows reuse prefix ordinals at ${count} pages while rechecking visibility`,async()=>{
 const source={kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},binding={source},doc={content:{datasetFormat:2,rowCount:count*3}},node={operation:'sum',column:0,window:{...defaultWindow(),start:0,end:0}},location={kind:'dataset',page:count-1,row:1,id:'row-'+(count-1)+'-1',excluded:null};let reads=0,pages=0,denied=false;
 const materials={async read(){reads++;if(denied)throw Error('revoked');return doc;},datasetPageCount(){return count;},async retainedDatasetPage(_doc,page,{columns}){pages++;return {rows:Array.from({length:3},(_,row)=>({id:'row-'+page+'-'+row,cells:[String(page*3+row+columns[0])],excluded:null}))};}},reader=new DatasetWindowReader(materials);
 for(let i=0;i<100;i++){const column=i%2,window=await reader.open({...node,column},binding,location);assert.equal(window.anchor,(count-1)*3+1);assert.equal((await window.at(0)).value,String((count-1)*3+1+column));}
 assert.equal(reads,100);assert.ok(pages<=count+2,`Repeated windows read ${pages} pages`);assert.ok(reader.ordinals.anchors.size<=128);
 const before=pages;await reader.open(node,{source:{...source,revision:'b'.repeat(64)}},location);assert.ok(pages>=before+count,'Another revision cannot reuse ordinal proofs');denied=true;await assert.rejects(reader.open(node,binding,location),/revoked/);
});

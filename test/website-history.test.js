import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {WebsiteHistory} from '../src/web/website-history.js';
import {WebsitePageContexts} from '../src/web/website-page-contexts.js';

test('undo and redo remain contiguous across byte eviction and new edits discard redo',()=>{
 const history=new WebsiteHistory({maxEntries:50,maxBytes:50});
 let current={title:'one'};const capture=()=>structuredClone(current);
 history.checkpoint(capture);current={title:'two'};
 history.checkpoint(capture);current={title:'three'};
 assert.equal(history.undoCount,1);assert.equal(history.trimmed,true);assert.ok(history.bytes<=50);
 current=history.step('undo',capture);assert.deepEqual(current,{title:'two'});assert.equal(history.undoCount,0);
 current=history.step('redo',capture);assert.deepEqual(current,{title:'three'});
 current=history.step('undo',capture);
 history.checkpoint(capture);current={title:'four'};
 assert.equal(history.redoCount,0);current=history.step('undo',capture);assert.deepEqual(current,{title:'two'});
 history.clear();assert.equal(history.bytes,0);assert.equal(history.trimmed,false);
});

test('grouped typing captures once and count limits span both undo directions',()=>{
 const history=new WebsiteHistory({maxEntries:3});let current=0,captures=0;
 const capture=()=>{captures++;return current;};
 for(let i=1;i<=12;i++){history.checkpoint(capture,'typing');current=i;}
 assert.equal(captures,1);assert.equal(history.undoCount,1);
 for(let i=13;i<=16;i++){history.checkpoint(capture,'field:'+i);current=i;}
 assert.equal(history.undoCount,3);
 current=history.step('undo',capture);assert.equal(current,15);
 current=history.step('undo',capture);assert.equal(current,14);
 current=history.step('undo',capture);assert.equal(current,13);
 assert.equal(history.undoCount,0);assert.equal(history.redoCount,3);
 current=history.step('redo',capture);assert.equal(current,14);
 current=history.step('redo',capture);assert.equal(current,15);
 current=history.step('redo',capture);assert.equal(current,16);
});

test('an oversized checkpoint retains the live draft and does not leave an undo gap',()=>{
 const history=new WebsiteHistory({maxBytes:80});let current={body:'small'};const capture=()=>structuredClone(current);
 history.checkpoint(capture);current={body:'x'.repeat(100)};
 current=history.step('undo',capture);assert.deepEqual(current,{body:'small'});
 assert.equal(history.redoCount,0);assert.equal(history.trimmed,true);
 history.checkpoint(capture);current={body:'another small edit'};
 history.checkpoint(capture);current={body:'x'.repeat(100)};
 const large=current;history.checkpoint(capture,'oversized');
 assert.equal(current,large);assert.equal(history.undoCount,0);assert.equal(history.redoCount,0);assert.equal(history.bytes,0);
});

test('recent page contexts are bounded, restored safely and retain the current page at eviction',()=>{
 const contexts=new WebsitePageContexts({maxEntries:3}),paths=Array.from({length:5},()=> 'entries/'+randomUUID()+'.html');
 for(let i=0;i<3;i++)contexts.set(paths[i],{tool:'page',scroll:i});
 contexts.set(paths[0],{tool:'selection',scroll:99});contexts.set(paths[3],{tool:'site',designTab:'colors'});
 assert.equal(contexts.size,3);assert.equal(contexts.get(paths[1]),null);assert.equal(contexts.get(paths[0]).scroll,99);
 const persisted=JSON.parse(JSON.stringify(contexts)),restored=new WebsitePageContexts({maxEntries:2});restored.restore(persisted);
 assert.equal(restored.size,2);assert.equal(restored.get(paths[3]).designTab,'colors');
 restored.set(paths[4],{tool:'<script>',scroll:-10,section:'x'.repeat(500),media:{id:'x'.repeat(500),scope:'home'}});
 assert.equal(restored.get(paths[4]).tool,'page');assert.equal(restored.get(paths[4]).scroll,0);assert.equal(restored.get(paths[4]).media,null);
 assert.equal(restored.get(paths[4]).section,null);restored.set('__proto__',{});assert.equal(restored.size,2);
 restored.restore([]);assert.equal(restored.size,0);
});

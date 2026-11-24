import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validTree,MAX_ELEMENTS} from '../src/web/composition-tree.js';
test('composition trees nest only inside containers and reject cycles, duplicates, missing parents and excess depth',()=>{
 const row={id:'row',kind:'container'},title={id:'title',kind:'heading',parentId:'row'},other={id:'other',kind:'container'};
 assert.ok(validTree([row,title,other]));
 assert.equal(validTree([row,{...title,parentId:'missing'}]),false);
 assert.equal(validTree([{...row,parentId:'other'},{...other,parentId:'row'}]),false);
 assert.equal(validTree([row,{...row}]),false);
 assert.equal(validTree([{id:'a',kind:'heading'},{id:'b',kind:'text',parentId:'a'}]),false);
 const deep=Array.from({length:8},(_,i)=>({id:'c'+i,kind:'container',...(i?{parentId:'c'+(i-1)}:{})}));
 assert.equal(validTree(deep.slice(0,7)),true);assert.equal(validTree(deep),false);
 assert.equal(validTree(Array.from({length:MAX_ELEMENTS+1},(_,i)=>({id:'e'+i,kind:'text'}))),false);assert.equal(validTree(null),false);
});

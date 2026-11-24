import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inventoryWindow} from '../src/web/website-inventory.js';

test('inventory windows stream a large label source, clamp after removal and never read body fields',()=>{
 const source=function*(count){for(let i=0;i<count;i++)yield {label:'Item '+i,get body(){throw Error('Original read');}};};
 const first=inventoryWindow(source(10003)),last=inventoryWindow(source(10003),{offset:9996});
 assert.equal(first.items.length,12);assert.equal(first.total,10003);assert.equal(last.items.length,7);assert.equal(last.next,null);assert.equal(last.previous,9984);
 const removed=inventoryWindow(source(9990),{offset:9996});assert.equal(removed.offset,9984);assert.equal(removed.items.length,6);assert.equal(removed.items[0].label,'Item 9984');
 const found=inventoryWindow(source(10003),{query:'item 10002'});assert.equal(found.total,1);assert.equal(found.items[0].label,'Item 10002');
 assert.equal(inventoryWindow(source(0),{offset:24}).offset,0);assert.throws(()=>inventoryWindow([],{offset:Infinity}));
});


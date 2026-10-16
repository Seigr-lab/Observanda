import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RecordDocument} from '../src/record-document.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {digest,serialize} from '../src/storage-format.js';
import {bookSelectors} from '../src/web/book-selectors.js';
import {recordSelectorPage} from '../src/record-selector-page.js';
function memory(){const nodes=new Map();return {reads:0,tree(){return new RecordValueTree(this);},async put(kind,value){const encoded=serialize(value),hash=digest(encoded);nodes.set(kind+':'+hash,encoded);return hash;},async read(kind,hash){this.reads++;return JSON.parse(nodes.get(kind+':'+hash));}};}
const body=count=>({type:'doc',content:Array.from({length:count},(_,i)=>({type:'heading',attrs:{id:randomUUID()},content:[{type:'text',text:'Inline destination '+i}]}))});
test('selector windows preserve complete private and embedded destination order through empty sources and long prose',async()=>{
 const blocks=memory(),value={sections:Array.from({length:67},(_,i)=>({id:randomUUID(),title:'Section '+i,body:i===33?body(43):''})),figures:[{id:randomUUID(),title:'Plot'}],attachments:[...Array.from({length:45},()=>({id:randomUUID(),kind:'audio',caption:'Audio'})),{id:randomUUID(),kind:'image',caption:'Private apparatus',alt:'Original',share:false}],body:body(29)},document=new RecordDocument(blocks,await new RecordValueTree(blocks).retain(value));
 for(const search of ['', 'destination 2','private apparatus','missing']){
  const found=[];let position,steps=0;do{const page=await recordSelectorPage(document,{position,search});assert.ok(page.items.length<=20);assert.equal(page.first,page.items.length?found.length+1:0);found.push(...page.items);assert.equal(page.last,found.length);position=page.next;assert.ok(++steps<100);}while(position);
  assert.deepEqual(found,bookSelectors(value).filter(item=>item.label.toLocaleLowerCase().includes(search)));
 }
});
test('late selector windows seek values without enumerating research collections',async t=>{
 const counts=[];
 for(const count of [257,2003]){
  const blocks=memory(),value={sections:Array.from({length:count},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Heavy prose '.repeat(100)})),figures:[],attachments:[],body:''},document=new RecordDocument(blocks,await new RecordValueTree(blocks).retain(value));
  const original=document.tree.read;document.tree.read=async function(ref){const node=await this.node(ref);assert.equal(node.type,'inline');assert.ok(typeof node.value==='string');return original.call(this,ref);};
  document.items=()=>{throw Error('Unbounded collection traversal');};blocks.reads=0;
  const page=await recordSelectorPage(document,{position:{source:count-21,within:0,emitted:0}});assert.deepEqual(page.items,bookSelectors(value).slice(count-21,count-1));counts.push(blocks.reads);t.diagnostic(`${count} sections: ${blocks.reads} logical reads`);
  const cancelled=new AbortController();cancelled.abort(Error('Stop'));await assert.rejects(recordSelectorPage(document,{signal:cancelled.signal}),/Stop/);
 }
 assert.ok(Math.max(...counts)<Math.min(...counts)*1.5,'Late windows grew with total content');
});

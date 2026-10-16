import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MaterialSequence} from '../src/material-sequence.js';
import {ComparisonIndex} from '../src/analysis-comparison-index.js';

test('byte-bounded comparison windows traverse both directions without losing observations',async()=>{
 const objects=new Map(),sequences=new MaterialSequence({readMetadata:async name=>objects.get(name)??null,writeMetadata:async(name,text)=>objects.set(name,text)}),index=new ComparisonIndex(sequences);
 for(let i=0;i<17;i++)await index.put('observations',String(i),{id:i,value:String(i).repeat(180000)},i,index.filters('all','correct','group'));
 const root=await index.flush(),fresh=new ComparisonIndex(sequences,root),seen=[];
 let page=await fresh.page('observations',{view:'all',limit:20});
 for(;;){seen.push(...page.items.map(o=>o.id));assert.ok(Buffer.byteLength(JSON.stringify(page.items))<=1048700);if(page.next===null)break;page=await fresh.page('observations',{view:'all',offset:page.next,limit:20});}
 assert.deepEqual(seen,Array.from({length:17},(_,i)=>i));const backwards=page.items.map(o=>o.id);
 while(page.offset){page=await fresh.page('observations',{view:'all',offset:page.offset,limit:20,backward:true});backwards.unshift(...page.items.map(o=>o.id));}
 assert.deepEqual(backwards,seen);
 await assert.rejects(fresh.page('observations',{offset:18}),{code:'INVALID'});
 await assert.rejects(fresh.page('observations',{signal:AbortSignal.abort()}),{name:'AbortError'});
 const original=await fresh.get('observations','16'),name='.observanda/materials/sequences/comparison-values/'+(await fresh.tree.find({root},'row/observations/0000000000000016')).revision+'.json';
 objects.set(name,JSON.stringify({...original,value:{...original.value,id:15}}));
 await assert.rejects(fresh.page('observations',{offset:16}),{code:'MATERIAL_MISSING'});await assert.rejects(fresh.verify(),{code:'MATERIAL_MISSING'});
});

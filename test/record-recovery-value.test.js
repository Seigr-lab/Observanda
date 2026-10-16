import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recoveryValuePager,describeRecoveryValue} from '../src/web/record-recovery-value.js';
import {recordRecoveryMessage as message} from '../src/web/record-recovery-messages.js';
import {proseText} from '../src/web/prose-model.js';
const book={projects:[],notebooks:[]};

test('recovery windows retain every exact value and Unicode boundary through forward and backward navigation',()=>{
 const value=[{title:'Measurements',x:'9007199254740993',y:'1/3',included:false},'a'.repeat(29)+'😀🧪'+'<>&\\\ud800'.repeat(200),null,undefined,-0];
 const expected='Title: Measurements\nx: 9007199254740993\ny: 1/3\nincluded: No\n'+value[1]+'\nNone\nRemoved\n-0';
 const pager=recoveryValuePager(value,book,{size:32}),pages=[];
 let page=pager.page();for(;;){assert.ok(page.text.length<=33);assert.ok(!/[\ud800-\udbff]$/.test(page.text)||page.text.endsWith('\ud800'));assert.equal(page.number,pages.length+1);pages.push(page);if(!page.next)break;page=pager.next();}
 assert.equal(pages.map(p=>p.text).join(''),expected);assert.deepEqual(pager.next(),pages.at(-1));
 for(let i=pages.length-2;i>=0;i--)assert.deepEqual(pager.previous(),pages[i]);
 assert.deepEqual(pager.previous(),pages[0]);assert.deepEqual(pager.next(),pages[1]);assert.equal(describeRecoveryValue(value,book),expected);
});

test('formatted descriptions page paragraph and nested list text without flattening the whole document',()=>{
 const value={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Exact '},{type:'text',text:'1/3'},{type:'hard_break'},{type:'text',text:'<authored>'}]},{type:'bullet_list',content:[{type:'list_item',content:[{type:'paragraph',content:[{type:'text',text:'9007199254740993'}]}]},{type:'list_item',content:[{type:'paragraph',content:[{type:'text',text:'Repeat 😀'.repeat(100)}]}]}]}]};
 const expected=proseText(value)+'\n'+message('formatted'),pager=recoveryValuePager(value,book,{size:37}),parts=[];
 let part=pager.page();for(;;){parts.push(part.text);if(!part.next)break;part=pager.next();}
 assert.equal(parts.join(''),expected);
});

test('late value windows continue from their traversal position rather than revisiting the prefix',()=>{
 const rows=Array.from({length:20000},(_,i)=>({label:'Observation '+i,value:String(i)+'/3'}));let reads=[];
 const source=new Proxy(rows,{get(target,key){if(/^\d+$/.test(String(key)))reads.push(Number(key));return Reflect.get(target,key);}}),pager=recoveryValuePager(source,book,{size:256});
 const first=pager.page();assert.ok(reads.length<20);assert.ok(first.next);
 let page;for(let i=0;i<200;i++)page=pager.next();
 reads=[];const next=pager.next();assert.ok(reads.length<20);assert.ok(reads[0]>1000);const nextReads=reads.slice();
 assert.deepEqual(pager.previous(),page);reads=[];assert.deepEqual(pager.next(),next);assert.deepEqual(reads,nextReads);
});

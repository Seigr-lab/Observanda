import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectChoiceAncestry} from '../src/project-choice-ancestry.js';
const normalize=value=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
function fixture(entries){const rows=new Map(),byId=new Map(entries.map(entry=>[entry.projectId,entry])),stats={reads:0,gets:0,puts:0,maxValueBytes:0};return {stats,rows,view:{get:async id=>{stats.reads++;return byId.has(id)?{state:'active',entry:byId.get(id)}:null;}},work:{get:async key=>{stats.gets++;return structuredClone(rows.get(key));},put:async(key,value)=>{stats.puts++;stats.maxValueBytes=Math.max(stats.maxValueBytes,Buffer.byteLength(JSON.stringify(value)));rows.set(key,structuredClone(value));}}};}
for(const count of [1000,10000])test('ancestry source reads grow linearly for '+count+' nested projects',async t=>{
 const entries=Array.from({length:count},(_,i)=>({projectId:String(i),parentId:i+1===count?null:String(i+1),summary:{title:i+1===count?'Ecology':'Child '+i}})),f=fixture(entries),inspect=projectChoiceAncestry(f.view,f.work,{query:'ecology',exclude:String(count-1),normalize});
 for(const entry of entries){const value=await inspect(entry.projectId);assert.equal(value.matched,true);assert.equal(value.excluded,true);}
 assert.equal(f.stats.reads,count);assert.equal(f.stats.puts,count*2);assert.equal(f.rows.size,count);assert.ok(f.stats.maxValueBytes<256);assert.ok(f.stats.gets<=count*3);t.diagnostic(JSON.stringify({depth:count,...f.stats}));
});
test('memoized and exact fallback ancestry preserve substring boundaries across several labels',async()=>{
 const entries=Array.from({length:80},(_,i)=>({projectId:String(i),parentId:i===0?null:String(Math.floor((i-1)/2)),summary:{title:['Écology','a','b','c','','Study 2','Field'].at(i%7)}}));
 for(const query of ['ecology','a b','b c a','c  b','field study','study 2','x','e',''])for(const useWork of [true,false]){
  const f=fixture(entries),inspect=projectChoiceAncestry(f.view,useWork?f.work:null,{query,exclude:'3',normalize});
  for(const entry of entries){const chain=[];for(let current=entry;current;current=current.parentId===null?null:entries[Number(current.parentId)])chain.push(current);const text=chain.map(value=>normalize(value.summary.title)).join(' '),value=await inspect(entry.projectId);assert.equal(value.matched,!!query&&text.includes(query),JSON.stringify({query,id:entry.projectId,useWork,text}));assert.equal(value.prefix,text.slice(0,Math.max(0,query.length-1)));assert.equal(value.excluded,chain.some(row=>row.projectId==='3'));}
 }
});
test('memoization rechecks access while resolving a chain and rejects inactive parent rows',async()=>{
 const entries=Array.from({length:1000},(_,i)=>({projectId:String(i),parentId:i===999?null:String(i+1)})),f=fixture(entries);let checks=0;await assert.rejects(projectChoiceAncestry(f.view,f.work,{check:()=>{if(++checks===80)throw Object.assign(new Error('Locked'),{code:'ACCESS_LOCKED'});}})('0'),{code:'ACCESS_LOCKED'});assert.ok(f.stats.reads<30);
 await assert.rejects(projectChoiceAncestry({get:async()=>({state:'deleted',entry:entries[0]})},fixture([]).work)('0'),{code:'FORMAT'});
});

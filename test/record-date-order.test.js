import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {recordDateRank,ascendingDateOrdinals} from '../src/record-date-order.js';
import {readingKey} from '../src/record-reading-index.js';
import {compareRecordDates} from '../src/web/record-date.js';
const order=(a,b)=>compareRecordDates(a,b)||(a.id<b.id?-1:a.id>b.id?1:0);
const dates=['2026-01-01','2026-01-01','2026-02-01',{kind:'unknown'},{kind:'unknown'},{kind:'range',from:'2026-01-01',to:'2026-02-01',estimated:true},{kind:'year',value:'2025',estimated:false},{kind:'month',value:'2026-01',estimated:true}];
function fixture(values){
 const rows=values.map(occurredOn=>({id:randomUUID(),occurredOn})),start='date:'+randomUUID()+':',entries=rows.map(row=>({id:start+readingKey(row,'date'),row}));entries.push({id:'a'},{id:'z'});entries.sort((a,b)=>a.id<b.id?-1:1);
 const index={async rank(_head,key){let lo=0,hi=entries.length;while(lo<hi){const at=(lo+hi)>>1;if(entries[at].id<key)lo=at+1;else hi=at;}return lo;},async entryAt(_head,at){return entries[at];}};
 return {rows,entries,index,start};
}
test('ascending date groups preserve every tie, unknown date and cursor boundary',async()=>{
 for(const values of [[],[dates[0]],dates.slice(3,5),dates.slice(0,3),dates]){
  const f=fixture(values),expected=[...f.rows].sort(order),anchors=[null,...f.rows,...dates.map(occurredOn=>({id:randomUUID(),occurredOn})),{id:randomUUID(),occurredOn:'1900-01-01'},{id:randomUUID(),occurredOn:'2099-01-01'}];
  for(const after of anchors)for(const inclusive of [false,true])for(const backward of [false,true]){
   const selected=expected.filter(row=>!after||(backward?(inclusive?order(row,after)<=0:order(row,after)<0):(inclusive?order(row,after)>=0:order(row,after)>0)));
   if(backward)selected.reverse();
   const ordinals=await Array.fromAsync(ascendingDateOrdinals(f.index,{},f.start,after?readingKey(after,'date'):null,{inclusive,backward}));assert.deepEqual(ordinals.map(i=>f.entries[i].row),selected);
   const rank=await recordDateRank(f.index,{},f.start,after?readingKey(after,'date'):null,{ascending:true,includeEqual:!inclusive});
   assert.equal(rank.total,values.length);assert.equal(rank.skipped,after?expected.filter(row=>inclusive?order(row,after)<0:order(row,after)<=0).length:0);
  }
 }
});
test('ascending traversal observes cancellation between groups and rows',async()=>{
 const f=fixture(dates),controller=new AbortController(),rows=ascendingDateOrdinals(f.index,{},f.start,null,{signal:controller.signal});await rows.next();controller.abort();await assert.rejects(rows.next(),{name:'AbortError'});
});

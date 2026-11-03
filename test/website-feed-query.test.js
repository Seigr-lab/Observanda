import test from 'node:test';
import assert from 'node:assert/strict';
import {enumerateFeedMembers,normalizeFeedCriteria,feedMemberForSource} from '../src/website-feed-query.js';

test('a 10,000-entry rule reads each compact shard once and reads no research or saved fragment',async()=>{
 const rows={},overrides={},reads=new Map(),pending=new Set();
 for(let i=0;i<10000;i++){
  const id=i.toString(16).padStart(64,'0'),revision=(i+10000).toString(16).padStart(64,'0');
  rows[id]={id,revision,title:'Survey '+i,tags:[i%2?'CO':'Co'],dateFrom:i%3===0?'2025-10-01':'2026-01-10',dateTo:'2026-01-10',status:'completed',media:false,searchVersion:1};
 }
 const [first]=Object.values(rows);overrides[first.id]={baseRevision:first.revision,row:{...first,title:'New survey',tags:['CO']}};
 const scope={member:async(path,visit)=>visit({async *entries(){for(const id of Object.keys(rows))yield {name:id,directory:true};}})};
 const store={workspace:{vault:{},root:'virtual-rule-test'},absolute:path=>path,pendingSources:async()=>pending,
  scope:async(fn,opts)=>{assert.equal(opts.write,true);return fn(scope);},control:async path=>{
   reads.set(path,(reads.get(path)??0)+1);
   if(path.endsWith('/generation.json'))return 'current';
   if(path.includes('feed-index'))return overrides;
   if(path.includes('picker/00.json'))return rows;
   assert.fail('Unexpected file read');
  }};
 const criteria=normalizeFeedCriteria({tags:['Co','Co'],status:'completed',sort:'date-asc'}),matched=await enumerateFeedMembers(store,criteria);
 assert.equal(matched.length,4999);assert.ok(!matched.some(r=>r.id===first.id));assert.ok(matched[0].dateFrom<matched.at(-1).dateFrom);
 assert.deepEqual(Object.keys(matched[0]).sort(),['dateFrom','dateTo','id','revision']);
 assert.equal(reads.get('.observanda/website-files/picker/00.json'),1);assert.equal(reads.get('.observanda/website-files/feed-index/00.json'),1);
 const priorReads=[...reads];
 assert.equal(await feedMemberForSource(store,criteria,{visible:true,target:'website',feedRow:overrides[first.id].row}),null);
 assert.equal(await feedMemberForSource(store,criteria,{visible:false,target:'website'}),null);assert.deepEqual([...reads],priorReads);
 pending.add(first.id);await assert.rejects(enumerateFeedMembers(store,criteria),{code:'CONFLICT'});
});

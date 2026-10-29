import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ModuleBrowseIndex} from '../src/modules/browse-index.js';
import {moduleBrowsePage} from '../src/modules/browse-page.js';
import {ModuleReader} from '../src/modules/reader.js';
const order=sort=>sort==='title'?(a,b)=>{const x=a.title.toLowerCase(),y=b.title.toLowerCase();return (x<y?-1:x>y?1:0)||(a.id<b.id?-1:a.id>b.id?1:0);}:(a,b)=>b.createdAt.localeCompare(a.createdAt)||(a.id<b.id?-1:a.id>b.id?1:0);
async function fixture(count=100){
 const state=new Map(),members=new Map(),views=new Map(),calls={member:0,view:0,nodes:0};
 const store={encode:(_kind,_id,value)=>Buffer.from(JSON.stringify(value)),decode:(_kind,_id,value)=>JSON.parse(value),db:{
  async get(_sql,key){calls.nodes++;return state.has(key)?{payload:state.get(key)}:null;},
  async run(sql,...values){if(sql.startsWith('INSERT INTO state ')){for(let i=0;i<values.length;i+=2)state.set(values[i],values[i+1]);}else if(sql.startsWith('DELETE FROM state ')){for(const key of values[0])state.delete(key);}else assert.fail('Unexpected SQL');}
 }};
 const catalogue={store,async *members(){yield* members.values();},async member(_head,id){calls.member++;return members.get(id)??null;},async view(_head,member){calls.view++;return views.get(member.id);}};
 const names=['Alpha','alpha','Item 2','Item 10','\u754c','\u{1f41d}','a','a\0b','a:b','\uffff'];
 for(let i=0;i<count;i++){const id=randomUUID();members.set(id,{id,revision:1,type:i%2?'resource':'task',hash:String(i)});views.set(id,{id,type:members.get(id).type,revision:1,title:names[i%names.length]+(i%7?String(i):''),createdAt:new Date(Date.UTC(2026,0,1+i%28)).toISOString()});}
 const index=new ModuleBrowseIndex(catalogue),legacy={entities:[...members.values()]},root=await index.prepare(legacy),head={...legacy,browseIndex:{version:1,root}};Object.assign(calls,{member:0,view:0,nodes:0});
 return {state,members,views,calls,catalogue,index,head};
}
test('indexed module pages preserve exact full-scan order, counts and backward boundaries',async()=>{
 const f=await fixture(87);
 for(const sort of ['title','created-desc'])for(const types of [null,['resource'],['task','resource'],[]]){
  const expected=[...f.views.values()].filter(value=>!types||types.includes(value.type)).sort(order(sort)),seen=[];let offset=0,after=null;
  do{
   const plan=await f.index.plan(f.head,{sort,types,after}),page=await moduleBrowsePage([plan],{offset,limit:11,order:order(sort)});assert.equal(page.total,expected.length);assert.deepEqual(page.records,expected.slice(offset,offset+11));
   if(offset>11)assert.equal(page.previousAfter.id,expected[offset-12].id);
   seen.push(...page.records);offset+=page.records.length;after=page.after;
  }while(offset<expected.length);
  assert.deepEqual(seen,expected);
 }
 await f.index.verify(f.head);
});
test('a 25-row module page reads page facts rather than ten thousand unrelated views',async t=>{
 const f=await fixture(10000),workspaceId=randomUUID(),context={book:{id:workspaceId},head:{...f.head,revision:1},members(){assert.fail('Indexed list must not traverse membership');},browse:async options=>[await new ModuleBrowseIndex(f.catalogue).plan(f.head,options)],encode:value=>Buffer.from(JSON.stringify(value)).toString('base64url'),decode:value=>JSON.parse(Buffer.from(value,'base64url'))};
 const reader=new ModuleReader({root:'.'},{context:async(_id,operation)=>operation(context)}),query={workspaceId,type:'resource'},first=await reader.list(query);
 assert.equal(first.total,5000);assert.equal(first.items.length,25);assert.equal(f.calls.view,25);assert.equal(f.calls.member,25);const firstNodes=f.calls.nodes;
 f.calls.view=0;f.calls.member=0;const second=await reader.list({...query,cursor:first.nextCursor});assert.equal(second.offset,25);assert.equal(f.calls.view,25);assert.deepEqual((await reader.list({...query,cursor:second.previousCursor})).items,first.items);
 t.diagnostic(JSON.stringify({members:10000,page:25,firstPageViews:25,firstPageMembers:25,firstPageIndexNodes:firstNodes}));
});
test('module ordered projections follow edits and refuse stale members or altered index nodes',async()=>{
 const f=await fixture(20),member=[...f.members.values()][0],before=f.views.get(member.id),after={...before,title:'Renamed',revision:2},next={...member,revision:2};
 f.head.browseIndex.root=await f.index.replace(f.head.browseIndex.root,before,after,next);f.members.set(member.id,next);f.views.set(member.id,after);await new ModuleBrowseIndex(f.catalogue).verify(f.head);
 f.members.set(member.id,{...next,revision:3});await assert.rejects(new ModuleBrowseIndex(f.catalogue).verify(f.head),{code:'CATALOGUE_DAMAGED'});f.members.set(member.id,next);
 const root=f.head.browseIndex.root,slot='module-browse-index:'+root.key,stored=f.state.get(slot),value=JSON.parse(stored);value.revision='0'.repeat(64);f.state.set(slot,Buffer.from(JSON.stringify(value)));
 await assert.rejects(new ModuleBrowseIndex(f.catalogue).plan(f.head),{code:'CATALOGUE_DAMAGED'});f.state.set(slot,stored);
 assert.equal(await new ModuleBrowseIndex(f.catalogue).plan({entities:[member]}),null);assert.equal((await new ModuleBrowseIndex(f.catalogue).plan({entities:[]})).total,0);
});
test('merged module pages preserve owner ordering and close iterators on cancellation',async()=>{
 const fixtures=await Promise.all([fixture(30),fixture(30)]),sort='title',expected=fixtures.flatMap(f=>[...f.views.values()]).sort(order(sort));
 const plans=await Promise.all(fixtures.map(f=>f.index.plan(f.head,{sort,after:expected[29]}))),page=await moduleBrowsePage(plans,{offset:30,limit:10,order:order(sort)});
 assert.deepEqual(page.records,expected.slice(30,40));assert.equal(page.previousAfter.id,expected[19].id);
 await assert.rejects(moduleBrowsePage(plans,{offset:29,limit:10,order:order(sort)}),{code:'MODULE_QUERY_CURSOR'});
 const controller=new AbortController(),reason=Error('cancel merge');let closed=false;
 const plan={total:2,offset:0,async *rows(){try{yield expected[0];controller.abort(reason);yield expected[1];}finally{closed=true;}}};
 await assert.rejects(moduleBrowsePage([plan],{offset:0,limit:2,order:order(sort),signal:controller.signal}),error=>error===reason);assert.equal(closed,true);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ModuleFacetBrowseIndex} from '../src/modules/facet-browse-index.js';
import {ModuleBrowseIndex} from '../src/modules/browse-index.js';
import {ModuleReader} from '../src/modules/reader.js';
import {matchesResourceTags} from '../src/web/modules/resource-tags.js';

const compare=sort=>sort==='created-desc'?(a,b)=>b.createdAt.localeCompare(a.createdAt)||(a.id<b.id?-1:a.id>b.id?1:0):(a,b)=>{const x=a.title.toLowerCase(),y=b.title.toLowerCase();return (x<y?-1:x>y?1:0)||(a.id<b.id?-1:a.id>b.id?1:0);};
async function fixture(count){
 const state=new Map(),members=new Map(),views=new Map(),constraints=new Map(),calls={member:0,view:0,constraint:0,nodes:0,scan:0};
 const store={encode:(_kind,_key,value)=>Buffer.from(JSON.stringify(value)),decode:(_kind,_key,value)=>JSON.parse(value),db:{
  async get(_sql,key){calls.nodes++;return state.has(key)?{payload:state.get(key)}:null;},
  async run(sql,...values){if(sql.startsWith('INSERT INTO state ')){for(let i=0;i<values.length;i+=2)state.set(values[i],values[i+1]);}else if(sql.startsWith('DELETE FROM state ')){for(const key of values[0])state.delete(key);}else assert.fail('Unexpected SQL');}
 }};
 const catalogue={store,async *members(){calls.scan++;yield* members.values();},async member(_head,id){calls.member++;return members.get(id)??null;},async view(_head,member){calls.view++;return views.get(member.id);},async constraint(_head,member){calls.constraint++;return constraints.get(member.id);}};
 for(let i=0;i<count;i++){
  const id=randomUUID(),type=i%7===6?'task':'resource',tags=[...(i<60?['Rare']:[]),...(i%2===0?['group A']:[]),...(i%3===0?['group B']:[])],status=i%3===0?'reserved':'available';
  members.set(id,{id,type,revision:1,hash:String(i)});views.set(id,{id,type,revision:1,title:['Alpha','alpha','Item 2','Item 10','界','🐝','a\0b','a:b'][i%8]+(i%5?i:''),status,createdAt:new Date(Date.UTC(2026,0,1+i%28)).toISOString(),...(type==='resource'?{tags}:{})});constraints.set(id,{id,type,data:{kind:i%2?'equipment':'material',resourceId:id}});
 }
 const index=new ModuleFacetBrowseIndex(catalogue),head={revision:1,entities:[...members.values()]};head.facetIndex=await index.prepare(head);
 const workspaceId=randomUUID(),context={book:{id:workspaceId,projects:[],notebooks:[]},head,members:options=>catalogue.members(head,options),member:id=>catalogue.member(head,id),view:member=>catalogue.view(head,member),constraint:member=>catalogue.constraint(head,member),search:async member=>views.get(member.id).title.toLowerCase(),
  browse:async options=>{const plan=await new ModuleBrowseIndex(catalogue).plan(head,options);return plan?[plan]:null;},encode:value=>Buffer.from(JSON.stringify(value)).toString('base64url'),decode:value=>JSON.parse(Buffer.from(value,'base64url'))};
 const reader=new ModuleReader({root:'.'},{context:async(_id,operation)=>operation(context)}),reset=()=>Object.keys(calls).forEach(key=>calls[key]=0);reset();
 return {state,members,views,constraints,calls,catalogue,index,head,workspaceId,reader,reset,context};
}
function expected(f,query){return [...f.views.values()].filter(view=>(!query.type||view.type===query.type)&&(!query.status||view.status===query.status)&&(!query.kind||f.constraints.get(view.id).data.kind===query.kind)&&matchesResourceTags(view.tags,query.tags??[],query.tagMode)&&(!query.query||view.title.toLowerCase().includes(query.query))).sort(compare(query.sort));}

test('facet pages and residual intersections match exact scans in both orders and backward pages',async()=>{
 const f=await fixture(95),queries=[{status:'available'},{type:'resource',kind:'material'},{type:'resource',status:'reserved',kind:'equipment'},{type:'resource',tags:['rare']},{type:'resource',tags:['group A','group B']},{type:'resource',tags:['rare','group A'],tagMode:'any'},{type:'resource',status:'available',tags:['group A']},{type:'resource',kind:'equipment',tags:['rare'],query:'alpha'},{type:'resource',status:'unmatched'}];
 for(const filters of queries)for(const sort of ['title','created-desc']){
  const query={workspaceId:f.workspaceId,...filters,sort,limit:7},wanted=expected(f,query);let cursor=null,offset=0,seen=[];
  do{const page=await f.reader.list({...query,cursor});assert.equal(page.total,wanted.length);assert.deepEqual(page.items,wanted.slice(offset,offset+7));
   if(page.previousCursor)assert.deepEqual((await f.reader.list({...query,cursor:page.previousCursor})).items,wanted.slice(Math.max(0,offset-7),offset));
   seen.push(...page.items);offset+=page.items.length;cursor=page.nextCursor;
  }while(cursor);
  assert.deepEqual(seen,wanted);
 }
 assert.equal(f.calls.scan,0);await f.index.verify(f.head);
});

for(const count of [1000,10000])test('common facet pages decode only requested rows among '+count+' members',async t=>{
 const f=await fixture(count);
 for(const filter of [{status:'available'},{kind:'material'},{status:'reserved',kind:'equipment'},{tags:['rare']}]){
  f.reset();const query={workspaceId:f.workspaceId,type:'resource',...filter},first=await f.reader.list(query),firstCalls={...f.calls};
  assert.equal(first.items.length,25);assert.equal(first.total,expected(f,query).length);assert.equal(firstCalls.scan,0);assert.equal(firstCalls.view,25);assert.equal(firstCalls.member,25);
  f.reset();const second=await f.reader.list({...query,cursor:first.nextCursor});assert.equal(second.offset,25);assert.equal(f.calls.view,25);assert.equal(f.calls.member,25);assert.equal(f.calls.scan,0);
  t.diagnostic(JSON.stringify({members:count,filter,firstPageViews:firstCalls.view,firstPageMembers:firstCalls.member,indexReads:firstCalls.nodes}));
 }
});

test('filtered candidates retain cancellation, stale cursors and authenticated tamper detection',async()=>{
 const f=await fixture(90),query={workspaceId:f.workspaceId,type:'resource',status:'available'},page=await f.reader.list(query);
 f.head.revision++;await assert.rejects(f.reader.list({...query,cursor:page.nextCursor}),{code:'MODULE_QUERY_CURSOR'});f.head.revision--;
 const member=[...f.members.values()][0],before=f.views.get(member.id),after={...before,title:'Changed',status:'available',tags:['new'],revision:2},next={...member,revision:2},constraint=f.constraints.get(member.id);
 f.head.facetIndex=await f.index.replace(f.head.facetIndex,before,after,constraint,constraint,next);f.members.set(member.id,next);f.views.set(member.id,after);await new ModuleFacetBrowseIndex(f.catalogue).verify(f.head);
 f.members.set(member.id,{...next,revision:3});await assert.rejects(new ModuleFacetBrowseIndex(f.catalogue).verify(f.head),{code:'CATALOGUE_DAMAGED'});f.members.set(member.id,next);
 const slot='module-facet-index:'+f.head.facetIndex.root.key,bytes=f.state.get(slot);f.state.delete(slot);await assert.rejects(f.reader.list(query),{code:'CATALOGUE_DAMAGED'});f.state.set(slot,bytes);
 const controller=new AbortController(),reason=Error('cancel filtered query');controller.abort(reason);await assert.rejects(f.reader.list(query,{signal:controller.signal}),error=>error===reason);
 const legacy={...f.head};delete legacy.facetIndex;assert.equal(await new ModuleFacetBrowseIndex(f.catalogue).plan(legacy,{status:'available'}),null);
 assert.throws(()=>new ModuleFacetBrowseIndex(f.catalogue).check({...f.head,facetIndex:null}),{code:'CATALOGUE_DAMAGED'});
});

test('compound selected filters fetch each supporting constraint once',async()=>{
 const f=await fixture(20),view=[...f.views.values()].find(value=>value.type==='resource'&&f.constraints.get(value.id).data.kind==='material');f.reset();
 const page=await f.reader.list({workspaceId:f.workspaceId,type:'resource',keys:[view.id],resourceId:view.id,kind:'material',moduleId:'resources',scopeIds:[null]});
 assert.equal(page.total,1);assert.equal(f.calls.constraint,1);assert.equal(f.calls.scan,0);
});

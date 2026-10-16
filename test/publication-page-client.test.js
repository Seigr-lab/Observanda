import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {publicationPageClient,publicationPageSections} from '../src/web/publication-page-client.js';
import {websiteLinkDestinations} from '../src/web/website-link-destinations.js';

function fixture(){
 const sources=Array.from({length:3},()=>({workspaceId:id(),projectIds:[],selection:{defaultShare:false,includeProjects:[],records:[]}}));
 const state={page:'website',websiteId:id(),book:{id:id(),projects:[],notebooks:[],entries:[],pages:[],website:{home:{enabled:true},researchSources:sources}},etag:'a'.repeat(64),storage:{contextId:'host'}},calls=[];
 const lists=sources.map((source,index)=>Array.from({length:index===1?0:31},(_,n)=>{const record={id:id(),notebookId:id(),title:'Owner '+index+' record '+n};return {target:'entry:'+record.id,path:'entries/'+record.id+'.html',title:record.title,context:'Source '+index,owner:{workspaceId:source.workspaceId,projectId:id(),labBookId:id()},recordId:id(),record};}));
 const api=async(route,command,options)=>{
  calls.push(command);assert.equal(route,'/api/projects/publication-source');assert.equal(command.operation,'pages');assert.equal(options.adopt,false);
  const index=sources.findIndex(source=>source.workspaceId===command.sourceId),query=command.query,rows=lists[index].filter(item=>item.title.toLowerCase().includes(query.search.toLowerCase())),offset=query.cursor?Number(query.cursor):0;
  return {owner:{workspaceId:sources[index].workspaceId},value:{workspaceId:sources[index].workspaceId,snapshotId:String(index+1).repeat(64),items:rows.slice(offset,offset+25),previousCursor:offset?String(Math.max(0,offset-25)):null,nextCursor:offset+25<rows.length?String(offset+25):null}};
 };
 return {sources,state,lists,calls,api,query:publicationPageClient({state,api})};
}

test('page discovery traverses selected owners and empty books in both directions without adopting records',async()=>{
 const f=fixture(),before=structuredClone(f.state.book),pages=[];let cursor=null;
 do{const result=await f.query({cursor});pages.push(result);cursor=result.nextCursor;}while(cursor);
 assert.deepEqual(pages.flatMap(page=>page.items.map(({snapshotId,...item})=>item)),f.lists.flat());assert.ok(pages.every(page=>page.items.length<=25));assert.equal(pages.length,4);
 for(let i=pages.length-1;i>0;i--)assert.deepEqual((await f.query({cursor:pages[i].previousCursor})).items,pages[i-1].items);
 assert.deepEqual(f.state.book,before);assert.ok(f.calls.some(call=>call.query.snapshotId==='1'.repeat(64)));
 const found=await f.query({search:'Owner 2 record 30'});assert.deepEqual(found.items.map(({snapshotId,...item})=>item),[f.lists[2][30]]);assert.equal(found.previousCursor,null);assert.equal(found.nextCursor,null);
});

test('independent-source pages also supply link destinations and reject changed site or consent cursors',async()=>{
 const f=fixture(),links=websiteLinkDestinations({state:f.state,api:f.api,recordPages:f.query}),first=await links(),second=await links({cursor:first.nextCursor});
 assert.equal(first.items[0].href,'home');assert.equal(first.items[1].href,f.lists[0][0].target);assert.deepEqual((await links({cursor:second.previousCursor})).items,first.items);
 const page=await f.query();f.state.websiteId=id();await assert.rejects(f.query({cursor:page.nextCursor}),/verified/);await assert.rejects(links({cursor:first.nextCursor}),/verified/);
 const next=await f.query();f.state.book.website.researchSources[0].projectIds.push(id());await assert.rejects(f.query({cursor:next.nextCursor}),/verified/);
});

test('a pending source page cannot cross websites and invalid source labels never enter the picker',async()=>{
 const f=fixture(),query=publicationPageClient({state:f.state,api:async(...args)=>{const result=await f.api(...args);f.state.websiteId=id();return result;}});
 await assert.rejects(query(),{name:'AbortError'});
 const bad=publicationPageClient({state:f.state,api:async(...args)=>{const result=await f.api(...args);result.value.items[0]={...result.value.items[0],target:'entry:'+id()};return result;}});await assert.rejects(bad(),/verified/);
 const controller=new AbortController();controller.abort();await assert.rejects(f.query({signal:controller.signal}),{name:'AbortError'});
});


test('section links use the selected page snapshot and reject stale or substituted source replies',async()=>{
 const f=fixture(),item=(await f.query()).items[0],sectionId='record-section-'+id(),calls=[];
 const api=async(route,command,options)=>{calls.push(command);assert.equal(command.operation,'page-sections');assert.equal(command.query.snapshotId,item.snapshotId);assert.equal(command.sourceId,item.owner.workspaceId);assert.equal(options.adopt,false);return {owner:item.owner,value:{workspaceId:item.owner.workspaceId,snapshotId:item.snapshotId,target:item.target,items:[{id:sectionId,title:'Selected method'}],total:1,offset:0,previous:null,next:null}};};
 const result=await publicationPageSections({state:f.state,api,item});assert.equal(result.items[0].id,sectionId);assert.equal(calls.length,1);
 await assert.rejects(publicationPageSections({state:f.state,item,api:async(...args)=>{const response=await api(...args);response.value.snapshotId='f'.repeat(64);return response;}}),/verified/);
 await assert.rejects(publicationPageSections({state:f.state,item,api:async(...args)=>{const response=await api(...args);f.state.websiteId=id();return response;}}),{name:'AbortError'});
});

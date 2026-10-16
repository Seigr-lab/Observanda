import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {websiteLinkDestinations} from '../src/web/website-link-destinations.js';
import {websiteRecordPages} from '../src/web/website-page-query.js';

function fixture({pages=60,records=63,indexed=true}={}){
 const notebookId=randomUUID(),entries=Array.from({length:records},(_,i)=>({id:randomUUID(),notebookId,title:'Record '+String(i).padStart(2,'0')}));
 const book={id:randomUUID(),website:{home:{enabled:true}},pages:Array.from({length:pages},(_,i)=>({id:randomUUID(),title:'Authored '+i})),projects:[],notebooks:[{id:notebookId,title:'Field journal'}]};
 Object.defineProperty(book,'entries',{get(){if(indexed)throw Error('Link discovery inspected record originals');return entries;}});
 const state={book,page:'website',etag:'a'.repeat(64),storage:{contextId:'test',researchStorage:indexed?'catalogue':'plain',researchFormatVersion:21}};
 const calls=[],api=async(url,command,options)=>{
  calls.push(command);assert.equal(url,'/api/research/records/query');assert.equal(command.snapshotId,state.etag);assert.equal(command.selection.includeRevisions,false);assert.equal(options.adopt,false);
  const offset=command.cursor?Number(command.cursor.slice(1)):0,filtered=entries.filter(e=>e.title.toLowerCase().includes(command.query.search));
  return {workspaceId:book.id,snapshotId:state.etag,records:filtered.slice(offset,offset+25),total:filtered.length,offset,cursor:'p'+offset,previousCursor:offset?'p'+(offset-25):null,nextCursor:offset+25<filtered.length?'p'+(offset+25):null,changed:false};
 };
 return {state,entries,calls,api,discover:websiteLinkDestinations({state,api})};
}

test('link destination windows traverse structural and record boundaries in both directions without duplicating destinations',async()=>{
 const f=fixture(),windows=[];let cursor=null;
 do{const result=await f.discover({cursor});assert.ok(result.items.length<=50);windows.push(result);cursor=result.nextCursor;}while(cursor);
 const actual=windows.flatMap(w=>w.items.map(i=>i.href)),expected=['home',...f.state.book.pages.map(p=>'page:'+p.id),'notebook:'+f.state.book.notebooks[0].id,...f.entries.map(r=>'entry:'+r.id)];
 assert.deepEqual(actual,expected);assert.equal(new Set(actual).size,actual.length);assert.ok(f.calls.length<6);
 for(let i=windows.length-1;i>0;i--)assert.deepEqual((await f.discover({cursor:windows[i].previousCursor})).items,windows[i-1].items);
 const selected=await f.discover({query:'Record 62'});assert.equal(selected.items.length,1);assert.equal(selected.items[0].href,'entry:'+f.entries[62].id);
 const old=windows[0].nextCursor;await assert.rejects(f.discover({query:'Changed search',cursor:old}),/verified/);
 await assert.rejects(f.discover({cursor:{...old,offset:1000}}),/verified/);
 f.state.etag='b'.repeat(64);await assert.rejects(f.discover({cursor:old}),/verified/);
});

test('empty results, unsaved page edits and plain-workspace windows have the same navigation contract',async()=>{
 const f=fixture({pages:51,records:51,indexed:false}),first=await f.discover({query:'Record'}),next=await f.discover({query:'Record',cursor:first.nextCursor});
 assert.equal(first.items.length,25);assert.equal(next.items.length,25);assert.deepEqual((await f.discover({query:'Record',cursor:next.previousCursor})).items,first.items);
 assert.equal((await f.discover({query:'missing'})).items.length,0);assert.equal(f.calls.length,0);
 f.state.book.pages[0].title='Unsaved title';assert.equal((await f.discover({query:'Unsaved title'})).items[0].label,'Unsaved title');
});

test('invalid or stale summary replies and aborted requests never become link destinations',async()=>{
 const f=fixture({pages:0,records:2}),command={state:f.state,search:'Record'};
 await assert.rejects(websiteRecordPages({...command,api:async(...args)=>({...await f.api(...args),snapshotId:'b'.repeat(64)})}),/verified/);
 await assert.rejects(websiteRecordPages({...command,api:async(...args)=>{const result=await f.api(...args);result.records[1]=result.records[0];return result;}}),/verified/);
 await assert.rejects(websiteRecordPages({...command,api:async(...args)=>{const result=await f.api(...args);result.records[0]=null;return result;}}),/verified/);
 const controller=new AbortController();controller.abort();await assert.rejects(websiteRecordPages({...command,api:f.api,signal:controller.signal}),{name:'AbortError'});
 await assert.rejects(websiteRecordPages({...command,api:async(...args)=>{const result=await f.api(...args);f.state.storage={...f.state.storage,contextId:'changed'};return result;}}),{name:'AbortError'});
});

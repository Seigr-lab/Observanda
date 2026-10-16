import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {moduleDashboardFixture} from './module-dashboard-fixture.js';
import {ProjectApplication,projectRequest} from '../src/project-application.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {ProjectDomains} from '../src/project-domains.js';
import {defaultPanelConfig} from '../src/web/dashboard-model.js';

test('planning and inventory cards compose dedicated owners with bounded originals and independent cursors',{timeout:240000},async t=>{
 const f=await moduleDashboardFixture(t),app=new ProjectApplication(f.workspace,{deviceStore:f.deviceStore}),client={};t.after(()=>app.close());
 for(const p of f.projects)await app.unlock(client,p.projectId,{});
 for(const b of f.books)await app.run(client,projectRequest('/api/projects/'+b.projectId+'/lab-books/'+b.labBookId+'/access/unlock','POST'),{password:'Protected observations 456!'});
 const base={workspaceId:f.workspaceId,area:'planning',type:'event',config:defaultPanelConfig(),options:{},mode:'page',key:null,cursor:null,limit:2,offset:0,keys:null};
 const route=projectRequest('/api/projects/dashboard-collection/modules','POST');assert.equal(route.write,false);
 const read=(values={},selected=route,who=client)=>app.run(who,selected,{...base,...values});
 const originals=[],selected=ModuleCatalogue.prototype.selected;t.mock.method(ModuleCatalogue.prototype,'selected',async function(head,id){originals.push(id);return selected.call(this,head,id);});
 const first=await read();assert.equal(first.total,5);assert.equal(first.items.length,2);assert.equal(originals.length,2);assert.equal(new Set(first.items.map(item=>item.key)).size,2);assert.ok(first.items.every(item=>item.action.name==='module-open-owned'));
 const seen=[...first.items];let page=first;
 while(page.nextCursor){const previous=page;page=await read({cursor:page.nextCursor});seen.push(...page.items);const back=await read({cursor:page.previousCursor});assert.deepEqual(back.items,previous.items);}
 assert.equal(new Set(seen.map(item=>item.key)).size,5);assert.deepEqual(new Set(seen.map(item=>item.owner.workspaceId)),new Set(f.owners.map(owner=>owner.workspaceId)));
 await assert.rejects(read({cursor:first.nextCursor},route,{}),{code:'RECORD_QUERY_CURSOR'});
 const pinned=await read({key:f.books[0].namespaceId+'/'+f.eventId});assert.equal(pinned.items[0].owner.labBookId,f.books[0].labBookId);
 const legacy=await read({key:f.eventId});assert.equal(legacy.total,1);assert.equal(legacy.items[0].owner.projectId,null);
 const projectRoute=projectRequest('/api/projects/'+f.projects[0].projectId+'/dashboard-collection/modules','POST');
 assert.equal((await read({workspaceId:f.projects[0].namespaceId,limit:25},projectRoute)).total,4);
 const own={scopeMode:'selected',projectIds:[f.projects[0].projectId],includeWorkspace:false,includeDescendants:false};assert.equal((await read({options:own})).total,2);
 const book={...own,notebookMode:'selected',notebookIds:[f.books[0].labBookId]},bookPage=await read({options:book});assert.equal(bookPage.total,1);assert.equal(bookPage.items[0].owner.labBookId,f.books[0].labBookId);assert.equal(bookPage.items[0].data.owner,[bookPage.items[0].owner.projectTitle,bookPage.items[0].owner.notebookTitle].join(' / '));
 const stock=await read({area:'inventory',type:'resource',limit:25});assert.equal(stock.total,5);
 for(const [i,owner] of f.owners.entries())assert.equal(stock.items.find(item=>item.owner.workspaceId===owner.workspaceId).data.physical,String(i+1));
 const amount=originals.length,choices=await read({area:'inventory',type:'resource',mode:'choices'});assert.equal(choices.total,5);assert.equal(originals.length,amount);
 const discover=await read({mode:'discovery',offset:2});assert.equal(discover.items.length,2);assert.equal(discover.total,5);assert.equal(originals.length,amount);
 const missing=randomUUID(),labels=await read({area:'inventory',type:'resource',mode:'labels',limit:25,keys:[f.books[0].namespaceId+'/'+f.resourceId,f.resourceId,missing]});assert.equal(labels.items.length,2);assert.deepEqual(labels.missing,[missing]);assert.equal(originals.length,amount);
 const chosen=await read({area:'inventory',type:'resource',options:{resourceMode:'selected',resourceIds:[f.books[0].namespaceId+'/'+f.resourceId]}});assert.equal(chosen.total,1);assert.equal(chosen.items[0].owner.labBookId,f.books[0].labBookId);
 await assert.rejects(read({area:'inventory',type:'resource',options:{resourceMode:'selected',resourceIds:[missing]}}),{code:'NOT_FOUND'});
 t.mock.restoreAll();
 let release,started;const ready=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve),owner=f.owners[3];
 const writing=new ProjectDomains(owner.storage,owner.workspaceId).run(['calculator'],async()=>{started();await gate;},{write:['calculator']});await ready;
 try{assert.equal((await read({cursor:first.nextCursor})).total,5);}finally{release();await writing;}
 await owner.command('calculation.save',{id:randomUUID(),expectedRevision:null,data:{name:'Unrelated calculation',links:[],engine:1,mode:'expression',angle:'rad',expression:'2+3',digits:'',fromBase:10,toBase:16}});
 assert.equal((await read({cursor:first.nextCursor})).total,5);
 await owner.command('calendar.save',{id:f.calendarId,expectedRevision:1,data:{...owner.calendar,name:'Changed calendar'}});
 await assert.rejects(read({cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});

 const bookCall=(book,suffix,data)=>app.run(client,projectRequest('/api/projects/'+book.projectId+'/lab-books/'+book.labBookId+'/'+suffix,'POST'),{workspaceId:book.namespaceId,...data});
 const original=await bookCall(f.books[0],'modules/item',{id:f.eventId});assert.equal(original.entity.data.location,'Location 3');
 await bookCall(f.books[0],'modules/command',{commandId:randomUUID(),action:'event.save',payload:{id:f.eventId,expectedRevision:1,data:{...original.entity.data,location:'Changed in its book'}}});
 assert.equal((await bookCall(f.books[0],'modules/item',{id:f.eventId})).entity.data.location,'Changed in its book');
 assert.equal((await bookCall(f.books[1],'modules/item',{id:f.eventId})).entity.data.location,'Location 4');
 for(const book of f.books){const calendar=await bookCall(book,'calendars/page',{from:'2026-10-01',to:'2026-11-01',timeZone:'UTC',limit:5});assert.equal(calendar.total,1);assert.equal(calendar.events[0].id,f.eventId);}
 assert.equal(app.calendars.owners.size,2);assert.equal(new Set([...app.calendars.owners].map(entry=>entry.id)).size,2);
 await assert.rejects(read({options:{...own,notebookMode:'selected',notebookIds:[randomUUID()]}}),{code:'RECORD_VIEW_SCOPE'});
 await app.run(client,projectRequest('/api/projects/'+f.books[0].projectId+'/lab-books/'+f.books[0].labBookId+'/access/lock','POST'),{});
 await assert.rejects(read(),error=>error.code==='ACCESS_LOCKED'&&error.labBookId===f.books[0].labBookId);
 assert.equal(app.calendars.owners.size,1);
 assert.equal((await read({options:{...own,projectIds:[f.projects[1].projectId]}})).total,2);
 await app.lock(client,f.projects[1].projectId);assert.equal(app.calendars.owners.size,0);
});

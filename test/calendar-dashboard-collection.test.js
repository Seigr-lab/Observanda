import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {moduleDashboardFixture} from './module-dashboard-fixture.js';
import {ProjectApplication,projectRequest} from '../src/project-application.js';
import {defaultPanelConfig} from '../src/web/dashboard-model.js';
import {CalendarSources} from '../src/calendar/service.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {ProjectDomains} from '../src/project-domains.js';

test('combined agenda retains separate owners, stable pages and authenticated feed caches',{timeout:240000},async t=>{
 const f=await moduleDashboardFixture(t),app=new ProjectApplication(f.workspace,{deviceStore:f.deviceStore}),client={};t.after(()=>app.close());
 for(const p of f.projects)await app.unlock(client,p.projectId,{});
 for(const b of f.books)await app.run(client,projectRequest('/api/projects/'+b.projectId+'/lab-books/'+b.labBookId+'/access/unlock','POST'),{password:'Protected observations 456!'});
 const base={workspaceId:f.workspaceId,config:defaultPanelConfig(),options:{},from:'2026-10-01',to:'2026-11-01',timeZone:'UTC',mode:'agenda',limit:2,key:null,cursor:null,offset:0,search:''};
 const route=projectRequest('/api/projects/dashboard-collection/calendar','POST');assert.equal(route.write,false);
 const read=(values={},selected=route,options={})=>app.run(client,selected,{...base,...values},options);
 let originals=0;const selected=ModuleCatalogue.prototype.selected;t.mock.method(ModuleCatalogue.prototype,'selected',async function(...args){originals++;return selected.apply(this,args);});
 const first=await read();assert.equal(first.total,5);assert.equal(first.events.length,2);const events=[...first.events];let page=first;
 while(page.nextCursor){const before=page;page=await read({cursor:page.nextCursor});events.push(...page.events);const back=await read({cursor:page.previousCursor});assert.deepEqual(back.events,before.events);}
 assert.equal(new Set(events.map(e=>e.collectionKey)).size,5);assert.equal(originals,0);
 const chosen=events.find(e=>e.owner.labBookId===f.books[0].labBookId),pinned=await read({key:chosen.collectionKey});assert.deepEqual(pinned.events,[chosen]);assert.equal(pinned.total,1);
 assert.equal((await read({key:f.calendarId+':'+f.eventId})).events[0].owner.projectId,null);
 const projectRoute=projectRequest('/api/projects/'+f.projects[0].projectId+'/dashboard-collection/calendar','POST');assert.equal((await read({workspaceId:f.projects[0].namespaceId},projectRoute)).total,4);
 const own={scopeMode:'selected',projectIds:[f.projects[0].projectId],includeWorkspace:false,includeDescendants:false,notebookMode:'selected',notebookIds:[f.books[0].labBookId]};assert.deepEqual((await read({options:own})).events,[chosen]);
 const discovered=await read({mode:'discovery',offset:2,limit:2});assert.equal(discovered.total,5);assert.equal(discovered.events.length,2);assert.equal(originals,0);
 assert.equal((await read({search:'no such event'})).total,0);
 await assert.rejects(read({from:'invalid',options:{scopeMode:'selected',projectIds:[],includeWorkspace:false}}),{code:'INVALID'});
 await assert.rejects(app.run({},route,{...base,cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});
 await assert.rejects(read({options:{...own,notebookIds:[randomUUID()]}}),{code:'RECORD_VIEW_SCOPE'});
 let release,started;const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>started=resolve),owner=f.owners[3];
 const writing=new ProjectDomains(owner.storage,owner.workspaceId).run(['calculator'],async()=>{started();await gate;},{write:['calculator']});await ready;
 try{assert.equal((await read({cursor:first.nextCursor})).total,5);}finally{release();await writing;}
 await owner.command('calculation.save',{id:randomUUID(),expectedRevision:null,data:{name:'Independent calculation',links:[],engine:1,mode:'expression',angle:'rad',expression:'2+3',digits:'',fromBase:10,toBase:16}});
 assert.equal((await read({cursor:first.nextCursor})).total,5);
 await owner.command('calendar.save',{id:f.calendarId,expectedRevision:1,data:{...owner.calendar,name:'Changed calendar'}});await assert.rejects(read({cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});
 t.mock.restoreAll();
 const subscriptionId=randomUUID(),fetches=[];
 const fake={fetch:async url=>{fetches.push(url);return url;},parse:async()=>[{id:'external-event',title:'Feed event',startsAt:'2026-10-03',endsAt:'2026-10-04',allDay:true,notes:'Private feed details'}]};app.calendars.options={...fake};
 // Existing owner caches keep their original provider; recreate them before admitting feeds.
 app.calendars.clear();const rootSources=new CalendarSources(fake);t.after(()=>rootSources.clear());
 for(const [index,o] of [f.owners[0],owner].entries())await o.command('subscription.save',{id:subscriptionId,expectedRevision:null,data:{name:'Feed '+index,projectId:null,color:'#123456',url:'https://calendar.invalid/feed-'+index+'.ics',enabled:true}});
 const feed=await read({limit:25},route,{calendarSources:rootSources});assert.equal(feed.total,7);const external=feed.events.filter(e=>e.readOnly);assert.equal(external.length,2);assert.equal(new Set(external.map(e=>e.collectionKey)).size,2);assert.ok(external.every(e=>e.notes===undefined));assert.equal(fetches.length,2);
 await read({limit:25},route,{calendarSources:rootSources});assert.equal(fetches.length,2);rootSources.clear();await read({limit:25},route,{calendarSources:rootSources});assert.equal(fetches.length,3);
 await app.run(client,projectRequest('/api/projects/'+f.books[1].projectId+'/lab-books/'+f.books[1].labBookId+'/access/lock','POST'),{});
 assert.equal((await read({key:chosen.collectionKey})).total,1);await assert.rejects(read(),e=>e.code==='ACCESS_LOCKED'&&e.labBookId===f.books[1].labBookId);
});

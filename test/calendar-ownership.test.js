import {ResearchCatalogue} from '../src/research-catalogue.js';
import {assertPrivateCatalogue} from './postgres-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../src/storage.js';
import {sampleNotebook} from '../src/sample.js';
import {workspaceModules} from '../src/modules/index.js';
import {ownerOf,scopedItems} from '../src/web/modules/scope.js';
import {localCalendar,visibleCalendar} from '../src/web/modules/calendar-model.js';
import {parseCalendar} from '../src/calendar/ical.js';
import {parseFeed} from '../src/calendar/parse.js';
import {publicAddress,fetchCalendar} from '../src/calendar/fetch.js';
import {CalendarSources} from '../src/calendar/service.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {calendarPage} from '../src/calendar/pages.js';
const material=projectId=>({projectId,name:'Pigment',code:'P1',kind:'material',description:'',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'Cupboard A',unit:'g',capacity:1,status:'available',links:[]});
const cal=projectId=>({projectId,name:'Studio',color:'#3958ba',archived:false});
const event=calendarId=>({calendarId,title:'Recording',startsAt:'2026-10-01',endsAt:'2026-10-03',allDay:true,timeZone:'Europe/Oslo',location:'Studio',notes:'Private event',status:'confirmed'});
async function setup(){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-calendar-')),book=sampleNotebook(),wing=book.projects[0],parent={...wing,id:randomUUID(),title:'Collective',parentId:null},sibling={...wing,id:randomUUID(),title:'Field work',parentId:null};
 wing.parentId=parent.id;book.projects.push(parent,sibling);for(const project of book.projects)project.tools=['resources','planning'];
 const vault={id:randomUUID(),key:Buffer.alloc(32,9)},workspace=new Workspace(root,vault);await workspace.create(book);const store=workspaceModules(workspace);
 const command=(action,payload)=>store.execute({workspaceId:book.id,commandId:randomUUID(),action,payload});
 const save=(type,id,data,expectedRevision=null)=>command(type+'.save',{id,data,expectedRevision});
 return {root,book,wing,parent,sibling,vault,workspace,store,command,save};
}
test('ownership drives nested inventory, duplicate codes are local, and stock history follows the resource',async()=>{
 const s=await setup(),a=randomUUID(),b=randomUUID();
 await s.save('resource',a,material(s.wing.id));await s.save('resource',b,material(s.sibling.id));
 await s.command('stock.move',{resourceId:a,expectedRevision:1,delta:'2.5',reason:'Receipt',links:[]});
 const before=await s.store.read();
 await assert.rejects(s.save('resource',randomUUID(),material(s.wing.id)));
 await assert.rejects(s.save('resource',randomUUID(),{...material(randomUUID()),code:'X'}),{code:'MODULE_REFERENCE'});
 assert.deepEqual(await s.store.read(),before);
 const items=scopedItems(s.book,before.entities,s.parent.id);assert.equal(items.filter(e=>e.type==='resource').length,1);
 assert.equal(ownerOf(items.find(e=>e.type==='movement'),before.entities),s.wing.id);
 assert.equal(scopedItems(s.book,before.entities,s.parent.id,false).length,0);
 // Rollups change immediately with a hierarchy edit, without rewriting inventory.
 s.wing.parentId=s.sibling.id;
 assert.equal(scopedItems(s.book,before.entities,s.parent.id).length,0);
 assert.equal(scopedItems(s.book,before.entities,s.sibling.id).filter(e=>e.type==='resource').length,2);
 await assertPrivateCatalogue(s.root,'Pigment');
});
test('calendar edits are revision guarded, events aggregate through owners and cancelled events disappear',async()=>{
 const s=await setup(),calendar=randomUUID(),id=randomUUID();await s.save('calendar',calendar,cal(s.wing.id));await s.save('event',id,event(calendar));
 let snapshot=await s.store.read(),data=localCalendar(s.book,snapshot.entities);
 assert.equal(visibleCalendar(s.book,data,{projectId:s.parent.id,from:'2026-10-01',to:'2026-11-01'}).events.length,1);
 assert.equal(visibleCalendar(s.book,data,{projectId:s.sibling.id}).events.length,0);
 assert.equal(visibleCalendar(s.book,data,{hidden:new Set([calendar])}).events.length,0);
 await s.save('calendar',calendar,{...cal(s.sibling.id),name:'New owner'},1);
 snapshot=await s.store.read();data=localCalendar(s.book,snapshot.entities);
 assert.equal(visibleCalendar(s.book,data,{projectId:s.parent.id}).events.length,0);
 await assert.rejects(s.save('event',id,event(calendar),0),{code:'MODULE_CHANGED'});
 await assert.rejects(s.save('event',randomUUID(),event(randomUUID())),{code:'MODULE_REFERENCE'});
 await s.save('event',id,{...event(calendar),status:'cancelled'},1);
 assert.equal(localCalendar(s.book,(await s.store.read()).entities).events.length,0);
});
test('task deadlines and bookings share the calendar while booking conflicts span owner locations',async()=>{
 const s=await setup(),equipment=randomUUID();await s.save('resource',equipment,{...material(s.wing.id),kind:'equipment',unit:''});
 const booking={projectId:s.sibling.id,title:'Shared instrument',resourceId:equipment,startsAt:'2026-10-02T10:00:00.000Z',endsAt:'2026-10-02T11:00:00.000Z',timeZone:'UTC',places:1,kind:'work',status:'confirmed',notes:'',links:[]};
 await s.save('booking',randomUUID(),booking);
 await assert.rejects(s.save('booking',randomUUID(),{...booking,projectId:s.wing.id}),{code:'BOOKING_CONFLICT'});
 await s.save('task',randomUUID(),{projectId:s.wing.id,title:'Prepare',description:'',status:'todo',priority:'normal',dueOn:'2026-10-01',assignees:[],checklist:[],dependencies:[],links:[]});
 const data=localCalendar(s.book,(await s.store.read()).entities);
 assert.equal(data.events.length,2);assert.equal(visibleCalendar(s.book,data,{projectId:s.parent.id}).events[0].type,'task');
});
const ics=lines=>['BEGIN:VCALENDAR','VERSION:2.0',...lines,'END:VCALENDAR'].join('\r\n');
test('subscription parser handles quoted text, folded lines, DST, exclusions, moved exceptions and exclusive all-day ends',async()=>{
 const feed=ics(['BEGIN:VEVENT','UID:recurring','DTSTART;TZID=Europe/Oslo:20261024T100000','DTEND;TZID=Europe/Oslo:20261024T110000','RRULE:FREQ=DAILY;COUNT=4','EXDATE;TZID=Europe/Oslo:20261026T100000','SUMMARY:Band\\, rehearsal','DESCRIPTION:Long','  description','END:VEVENT','BEGIN:VEVENT','UID:recurring','RECURRENCE-ID;TZID=Europe/Oslo:20261027T100000','DTSTART;TZID=Europe/Oslo:20261027T120000','DTEND;TZID=Europe/Oslo:20261027T130000','SUMMARY:Moved rehearsal','END:VEVENT','BEGIN:VEVENT','UID:day','DTSTART;VALUE=DATE:20261029','DTEND;VALUE=DATE:20261031','SUMMARY:Exhibition','END:VEVENT']);
 const range={from:'2026-10-01',to:'2026-11-01',timeZone:'Europe/Oslo'},items=await parseFeed(feed,range);
 assert.equal(items.length,4);assert.equal(items[0].startsAt,'2026-10-24T08:00:00.000Z');assert.equal(items[1].startsAt,'2026-10-25T09:00:00.000Z');
 assert.equal(items[2].title,'Moved rehearsal');assert.equal(items[2].startsAt,'2026-10-27T11:00:00.000Z');assert.equal(items[3].endsAt,'2026-10-31');assert.equal(items[0].title,'Band, rehearsal');
 assert.throws(()=>parseCalendar('Not a calendar',range),{code:'CALENDAR_FORMAT'});
});
test('subscription transport refuses private addresses and unsafe URLs before issuing requests',async()=>{
 for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','192.168.1.1','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1','224.1.1.1'])assert.equal(publicAddress(ip),false,ip);
 assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
 await assert.rejects(fetchCalendar('https://calendar.example/feed',{resolve:async()=>[{address:'127.0.0.1',family:4}]}),{code:'CALENDAR_URL'});
 await assert.rejects(fetchCalendar('http://calendar.example/feed'),{code:'CALENDAR_URL'});
});
test('connected calendars read no research bodies and session-only keys clear access immediately',async t=>{
 const source=await setup(),destination=await setup(),cid=randomUUID();await source.save('calendar',cid,cal(source.wing.id));await source.save('event',randomUUID(),event(cid));
 const id=randomUUID(),connection={name:'Other organization',projectId:destination.parent.id,color:'#38786c',path:source.root,enabled:true};
 await destination.save('calendar-connection',id,connection);
 t.mock.method(ResearchCatalogue.prototype,'read',()=>{throw Error('Complete research read');});
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Research body read');});
 t.mock.method(ModuleCatalogue.prototype,'read',()=>{throw Error('Complete module read');});
 const service=new CalendarSources(),range={from:'2026-10-01',to:'2026-11-01',timeZone:'UTC'};
 let result=await service.data(destination.workspace,range);assert.equal(result.sources[0].locked,true);
 const key=Buffer.from(source.vault.key);await service.unlock({id,data:connection},{},async()=>({id:source.vault.id,key}));
 result=await service.data(destination.workspace,range);assert.equal(result.events.length,1);assert.equal(result.events[0].readOnly,true);assert.equal(result.events[0].projectId,destination.parent.id);
 const page=await calendarPage(destination.workspace,service,{workspaceId:destination.book.id,...range});assert.equal(page.events.length,1);
 assert.equal(result.events[0].notes,undefined);
 const selected=result.events[0],detail=await service.detail(destination.workspace,{sourceId:id,eventId:selected.id,range});assert.equal(detail.event.notes,'Private event');
 service.clear();assert.deepEqual([...key],Array(32).fill(0));
 await assert.rejects(calendarPage(destination.workspace,service,{workspaceId:destination.book.id,...range,cursor:page.cursor}),{code:'CALENDAR_CURSOR'});
 await assert.rejects(service.detail(destination.workspace,{sourceId:id,eventId:selected.id,range}),{code:'CALENDAR_LOCKED'});
 result=await service.data(destination.workspace,range);assert.equal(result.events.length,0);assert.equal(result.sources[0].locked,true);
});

test('subscriptions refresh without duplicate events, preserve local results on feed failure and clear disabled caches',async()=>{
 const s=await setup(),id=randomUUID(),calendar=randomUUID();
 await s.save('calendar',calendar,cal(s.wing.id));await s.save('event',randomUUID(),event(calendar));
 const subscription={name:'Museum',projectId:s.sibling.id,color:'#916730',url:'https://calendar.example/private-feed',enabled:true};
 await s.save('subscription',id,subscription);
 let calls=0,fail=false,title='Exhibition opening';
 const service=new CalendarSources({fetch:async()=>{calls++;if(fail)throw new Error('provider failed');return ics(['BEGIN:VEVENT','UID:opening','DTSTART;VALUE=DATE:20261004','DTEND;VALUE=DATE:20261005','SUMMARY:'+title,'DESCRIPTION:Detailed visitor notes','END:VEVENT']);}});
 const range={from:'2026-10-01',to:'2026-11-01',timeZone:'UTC'};
 let result=await service.data(s.workspace,range);assert.equal(result.events.length,2);assert.equal(calls,1);
 const external=result.events.find(e=>e.readOnly);assert.equal(external.notes,undefined);assert.equal((await service.detail(s.workspace,{sourceId:id,eventId:external.id,range})).event.notes,'Detailed visitor notes');
 const first=await calendarPage(s.workspace,service,{workspaceId:s.book.id,...range,limit:1});
 result=await service.data(s.workspace,range);assert.equal(result.events.length,2);assert.equal(calls,1);
 title='Updated programme';result=await service.data(s.workspace,range,{refresh:true});
 assert.equal(result.events.find(e=>e.readOnly).title,title);assert.equal(calls,2);
 await assert.rejects(calendarPage(s.workspace,service,{workspaceId:s.book.id,...range,limit:1,cursor:first.nextCursor}),{code:'CALENDAR_CURSOR'});
 fail=true;result=await service.data(s.workspace,range,{refresh:true});
 assert.equal(result.events.length,1);assert.ok(result.sources.find(e=>e.id===id).error);
 await s.save('subscription',id,{...subscription,enabled:false},1);service.reconcile((await s.store.read()).entities);
 assert.equal(service.cache.size,0);result=await service.data(s.workspace,range);assert.equal(result.sources.some(e=>e.id===id),false);
});
test('feed parsing releases its worker when the requesting view is cancelled',async()=>{
 const controller=new AbortController(),pending=parseFeed(ics(['BEGIN:VEVENT','UID:abort','DTSTART;VALUE=DATE:20261001','DTEND;VALUE=DATE:20261002','SUMMARY:Cancelled parse','END:VEVENT']),{from:'2026-10-01',to:'2026-11-01'},{signal:controller.signal});
 controller.abort();await assert.rejects(pending,{name:'AbortError'});
});
test('timed feeds use the viewing timezone at month boundaries and embedded timezone definitions',()=>{
 const feed=ics(['BEGIN:VEVENT','UID:boundary','DTSTART:20260930T230000Z','DTEND:20261001T000000Z','SUMMARY:First October hour','END:VEVENT']);
 assert.equal(parseCalendar(feed,{from:'2026-10-01',to:'2026-11-01',timeZone:'Europe/Oslo'}).length,1);
 assert.equal(parseCalendar(feed,{from:'2026-09-01',to:'2026-10-01',timeZone:'Europe/Oslo'}).length,0);
 const embedded=ics(['BEGIN:VTIMEZONE','TZID:Test/Fixed','BEGIN:STANDARD','DTSTART:19700101T000000','TZOFFSETFROM:+0200','TZOFFSETTO:+0200','END:STANDARD','END:VTIMEZONE','BEGIN:VEVENT','UID:fixed','DTSTART;TZID=Test/Fixed:20261001T100000','DTEND;TZID=Test/Fixed:20261001T110000','SUMMARY:Custom time zone','END:VEVENT']);
 assert.equal(parseCalendar(embedded,{from:'2026-10-01',to:'2026-11-01'}).at(0).startsAt,'2026-10-01T08:00:00.000Z');
});

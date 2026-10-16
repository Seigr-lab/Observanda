import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,calculation,calendar} from './project-domain-fixture.js';
import {ProjectModuleCommands} from '../src/project-module-commands.js';
import {ProjectCalendars} from '../src/project-calendar.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
const range={from:'2026-10-01',to:'2026-11-01',timeZone:'UTC'};
test('project calendar pages and selected details use owned facts while research writes remain busy', {timeout:120000},async t=>{
 const f=await fixture(t),commands=new ProjectModuleCommands(f.storage,f.book.id);await commands.initialize();const calendars=new ProjectCalendars(),session=new Map(),a=calendar(f);t.after(()=>calendars.clear());a.payload.data.projectId=null;await commands.execute(a);
 const save=(action,payload)=>commands.execute({workspaceId:f.book.id,commandId:randomUUID(),action,payload}),ids=[];
 for(let i=0;i<3;i++){const id=randomUUID();ids.push(id);await save('event.save',{id,expectedRevision:null,data:{title:'Event '+i,calendarId:a.payload.id,startsAt:'2026-10-02',endsAt:'2026-10-03',allDay:true,timeZone:'UTC',location:'Lab',notes:'Private detail '+i,status:'confirmed'}});}
 const run=(method,data)=>calendars.run(session,f.storage,'access',method,{workspaceId:f.book.id,...data}),query={...range,limit:1},selected=ModuleCatalogue.prototype.selected,loaded=[];
 t.mock.method(ModuleCatalogue.prototype,'selected',async function(head,id){loaded.push(id);return selected.call(this,head,id);});
 const db=await f.storage.openCatalogue();let first;try{await db.run('BEGIN');await db.lock();first=await run('page',query);assert.equal(first.total,3);assert.equal(first.events[0].id,ids[0]);assert.deepEqual(loaded,[]);
  const detail=await run('event',{sourceId:first.events[0].sourceId,eventId:first.events[0].id,range});assert.equal(detail.event.notes,'Private detail 0');assert.deepEqual(loaded,[ids[0]]);
 }finally{await db.close();t.mock.restoreAll();}
 await commands.execute(calculation(f));const next=await run('page',{...query,cursor:first.nextCursor});assert.equal(next.events[0].id,ids[1]);
 await save('calendar.save',{...a.payload,expectedRevision:1,data:{...a.payload.data,name:'Edited'}});await assert.rejects(run('page',{...query,cursor:first.nextCursor}),{code:'CALENDAR_CURSOR'});
 await assert.rejects(calendars.run(session,f.storage,'access','page',{workspaceId:randomUUID(),...query}),{code:'WORKSPACE_CHANGED'});
});
test('calendar subscriptions retain a project/client cache and discard it on access changes or expiry', {timeout:120000},async t=>{
 const f=await fixture(t),commands=new ProjectModuleCommands(f.storage,f.book.id);await commands.initialize();let fetched=0;
 const calendars=new ProjectCalendars({fetch:async()=>{fetched++;return 'isolated feed';},parse:async()=>[]}),session=new Map(),other=new Map();t.after(()=>calendars.clear());
 const source={workspaceId:f.book.id,commandId:randomUUID(),action:'subscription.save',payload:{id:randomUUID(),expectedRevision:null,data:{name:'Local test feed',projectId:null,color:'#123456',url:'https://calendar.example.invalid/feed',enabled:true}}};await commands.execute(source);
 const run=(client=session,etag='one')=>calendars.run(client,f.storage,etag,'page',{workspaceId:f.book.id,...range});
 assert.equal((await run()).sources.length,1);await run();assert.equal(fetched,1);await run(other);assert.equal(fetched,2);calendars.forget(session,f.projectId);await run();assert.equal(fetched,3);await run(session,'two');assert.equal(fetched,4);calendars.expire(Date.now()+9*60*60*1000);await run();assert.equal(fetched,5);calendars.invalidateProject(f.projectId);await run();assert.equal(fetched,6);
 await commands.execute({...source,commandId:randomUUID(),payload:{...source.payload,expectedRevision:1,data:{...source.payload.data,enabled:false}}});assert.equal((await run()).sources.length,0);assert.equal(calendars.owner(session,f.storage,'one').cache.size,0);
});

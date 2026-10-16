import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {startServer} from '../../src/server.js';
import {ModuleCatalogue} from '../../src/modules/catalogue.js';
import {workspaceModules} from '../../src/modules/index.js';
import {defaultDashboard,createPanel} from '../../src/web/dashboard-model.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
import {seedModuleCurrent} from '../module-current-fixture.js';
import {localDate} from '../../src/web/modules/calendar-model.js';
for(const count of [65,650])test('dense calendars retain month totals and page through day plans at '+count+' events',async({page})=>{
 test.setTimeout(90000);page.setDefaultTimeout(12000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-calendar-browser-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),now=new Date().toISOString(),day=localDate(new Date());
 const entities=Array.from({length:count},(_,i)=>({id:randomUUID(),type:'task',revision:1,createdAt:now,updatedAt:now,data:{title:'Deadline '+String(i).padStart(3,'0'),description:'Private original. '.repeat(3500),status:'todo',priority:'normal',dueOn:day,assignees:[],checklist:[],dependencies:[],links:[]}}));
 await seedModuleCurrent(f.workspace,book.id,entities);
 const settings=defaultDashboard();settings.enabledModules=['planning'];const card=createPanel('calendar-agenda','schedule-growth');card.moduleId='planning';card.count=5;settings.views[0].panels=[card];await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
 const app=await startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences')}),read=ModuleCatalogue.prototype.read,selected=ModuleCatalogue.prototype.selected,opened=[],requests=[],errors=[];
 ModuleCatalogue.prototype.read=()=>{throw Error('Calendar read full module data');};ModuleCatalogue.prototype.selected=async function(head,id){opened.push(id);return selected.call(this,head,id);};
 page.on('request',r=>requests.push(new URL(r.url()).pathname));page.on('pageerror',e=>errors.push(e.message));const cdp=await page.context().newCDPSession(page);
 try{
  const auth=await page.request.post(app.origin+'/api/session',{data:{token:app.launchToken},headers:{Origin:app.origin}});expect(auth.ok()).toBe(true);await page.goto(app.origin+'/#/workspace');
  const panel=page.locator('[data-desk-card="schedule-growth"]');await expect(panel.locator('.desk-item')).toHaveCount(5);await panel.getByRole('button',{name:'Next items',exact:true}).click();await expect(panel).toContainText('Deadline 005');expect(opened).toEqual([]);
  await page.goto(app.origin+'/#/modules/planning/agenda');const main=page.locator('main'),cell=main.locator('[data-calendar-day="'+day+'"]');
  await expect(cell.locator('.calendar-event')).toHaveCount(3);await cell.getByRole('button',{name:(count-3)+' more',exact:true}).click();
  await expect(main.locator('.calendar-day-plan .calendar-event')).toHaveCount(50);await expect(main).toContainText('1–50 of '+count+' scheduled items');
  await main.getByRole('button',{name:'Next scheduled items',exact:true}).click();await expect(main).toContainText('Deadline 050');await expect(main.locator('.calendar-day-plan .calendar-event')).toHaveCount(Math.min(50,count-50));
  await main.getByRole('button',{name:'Previous scheduled items',exact:true}).click();await expect(main).toContainText('Deadline 000');expect(opened).toEqual([]);
  await main.getByRole('checkbox',{name:'Task deadlines',exact:true}).uncheck();await expect(main.locator('.calendar-event')).toHaveCount(0);await main.getByRole('checkbox',{name:'Task deadlines',exact:true}).check();await expect(main.locator('.calendar-day-plan .calendar-event')).toHaveCount(50);
  const target=entities[0];await workspaceModules(f.workspace).execute({workspaceId:book.id,commandId:randomUUID(),action:'task.save',payload:{id:target.id,expectedRevision:1,data:{...target.data,title:'Changed deadline'}}},{compact:true});
  await main.getByRole('button',{name:'Next scheduled items',exact:true}).click();await expect(main.getByRole('alert')).toContainText('calendar or its sources changed');await main.getByRole('button',{name:'Refresh',exact:true}).click();await expect(main).toContainText('Changed deadline');
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const heap=(await cdp.send('Runtime.getHeapUsage')).usedSize;expect(heap).toBeLessThan(96*1024*1024);expect(requests).not.toContain('/api/modules/data');expect(requests).not.toContain('/api/calendars');expect(errors).toEqual([]);
  console.log(JSON.stringify({events:count,browserHeapMiB:Math.round(heap/1024/1024)}));
 }finally{ModuleCatalogue.prototype.read=read;ModuleCatalogue.prototype.selected=selected;await cdp.detach();await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

for(const count of [65,650])test('calendar source pages search and filter '+count+' calendars without hiding schedule labels',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-calendar-source-browser-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),now=new Date().toISOString(),day=localDate(new Date());
 const entity=(type,data)=>({id:randomUUID(),type,revision:1,createdAt:now,updatedAt:now,data});
 const calendars=Array.from({length:count},(_,i)=>entity('calendar',{name:'Calendar '+String(i).padStart(3,'0'),color:'#3958ba',projectId:null,archived:false}));
 const last=calendars.at(-1),event=entity('event',{title:'Far calendar event',calendarId:last.id,startsAt:day,endsAt:localDate(new Date(Date.now()+86400000)),allDay:true,timeZone:'UTC',location:'',notes:'Private original',status:'confirmed'});
 await seedModuleCurrent(f.workspace,book.id,[...calendars,event]);
 const settings=defaultDashboard();settings.enabledModules=['planning'];await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
 const app=await startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences')}),read=ModuleCatalogue.prototype.read,selected=ModuleCatalogue.prototype.selected,opened=[],errors=[];
 ModuleCatalogue.prototype.read=()=>{throw Error('Whole module read');};ModuleCatalogue.prototype.selected=async function(head,id){opened.push(id);return selected.call(this,head,id);};page.on('pageerror',e=>errors.push(e.message));
 const cdp=await page.context().newCDPSession(page);
 try{
  const auth=await page.request.post(app.origin+'/api/session',{data:{token:app.launchToken},headers:{Origin:app.origin}});expect(auth.ok()).toBe(true);await page.goto(app.origin+'/#/modules/planning/agenda');
  const main=page.locator('main'),sources=main.locator('.calendar-sources');await expect(sources.locator('[data-calendar-source]')).toHaveCount(20);
  await main.locator('[data-calendar-mode]').selectOption('agenda');await expect(main.locator('.calendar-event')).toContainText(last.data.name);
  await sources.getByRole('button',{name:'Next calendars',exact:true}).click();await expect(sources).toContainText('Calendar 020');await expect(main.locator('.calendar-event')).toContainText(last.data.name);
  await sources.getByRole('button',{name:'Previous calendars',exact:true}).click();await expect(sources).toContainText('Calendar 000');
  await sources.getByRole('searchbox',{name:'Find a calendar'}).fill(last.data.name);await expect(sources.locator('[data-calendar-source]')).toHaveCount(1);
  const checkbox=sources.getByRole('checkbox',{name:last.data.name,exact:true});await checkbox.uncheck();await expect(main.locator('.calendar-event')).toHaveCount(0);await checkbox.check();await expect(main.locator('.calendar-event')).toHaveCount(1);
  await sources.getByRole('searchbox',{name:'Find a calendar'}).fill('No matching calendar');await expect(sources.locator('[data-calendar-source]')).toHaveCount(0);await expect(main.locator('.calendar-event')).toContainText(last.data.name);
  // No visible source choice is not evidence that the workspace has no calendars.
  await main.getByRole('button',{name:'New event',exact:true}).click();await expect(main.getByLabel('Event title',{exact:true})).toBeVisible();await expect(main.getByRole('heading',{name:'Calendar',exact:true})).toHaveCount(0);
  expect(opened.every(id=>id===calendars[0].id)).toBe(true);
  const heap=(await cdp.send('Runtime.getHeapUsage')).usedSize;expect(heap).toBeLessThan(96*1024*1024);expect(errors).toEqual([]);console.log(JSON.stringify({sources:count,browserHeapMiB:Math.round(heap/1024**2)}));
 }finally{ModuleCatalogue.prototype.read=read;ModuleCatalogue.prototype.selected=selected;await page.close();await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

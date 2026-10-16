import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {startServer} from '../../src/server.js';
import {CalendarSources} from '../../src/calendar/service.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from '../../src/security/dashboard-storage.js';

const feed=(uid,title)=>[
 'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Observanda browser test//EN',
 'BEGIN:VEVENT','UID:'+uid,'DTSTART;VALUE=DATE:20261018','DTEND;VALUE=DATE:20261019',
 'SUMMARY:'+title,'DESCRIPTION:Selected subscription event notes.','END:VEVENT','END:VCALENDAR',''
].join('\r\n');

test('both subscription entry points persist feeds and calendar navigation supports refresh, failure and recovery',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-calendar-subscriptions-'));
 const book=sampleNotebook();book.title='workspace';
 const f=await encryptedFixture(directory,book),settings=defaultDashboard();
 settings.enabledModules=['planning'];settings.views[0].panels=[];
 await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
 const urls=['https://calendar.example.invalid/workshops.ics','https://calendar.example.invalid/fieldwork.ics'];
 const names=['Workshop feed','Fieldwork feed'],calls=[],errors=[];
 let workshopTitle='Morning workshop',failWorkshop=false;
 const originalData=CalendarSources.prototype.data;
 CalendarSources.prototype.data=function(...args){
  this.fetch=async url=>{
   expect(urls).toContain(url);calls.push(url);
   if(url===urls[0]){if(failWorkshop)throw Error('Synthetic source interruption');return feed('workshop',workshopTitle);}
   return feed('fieldwork','Afternoon fieldwork');
  };
  return originalData.apply(this,args);
 };
 let app;
 page.on('pageerror',error=>errors.push(error.message));
 try{
  app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences')});
  const auth=await page.request.post(app.origin+'/api/session',{data:{token:app.launchToken},headers:{Origin:app.origin}});
  expect(auth.ok()).toBe(true);
  const main=page.locator('main'),dialog=page.locator('#dialog');
  const api=async(route,data)=>{const response=await page.request.post(app.origin+route,{data:{workspaceId:book.id,...data},headers:{Origin:app.origin}});expect(response.ok()).toBe(true);return response.json();};
  const subscriptions=()=>api('/api/modules/items',{type:'subscription',moduleId:'planning',projectId:null,recursive:true,limit:25});
  const nav=name=>main.getByRole('navigation',{name:'Planning',exact:true}).getByRole('button',{name,exact:true});
  const overview=async()=>{
   await nav('Calendars').click();await expect(main.getByRole('heading',{name:'Calendar',exact:true})).toBeVisible();
   await expect(main.getByRole('button',{name:'Calendar overview',exact:true})).toHaveCount(0);
   await expect(dialog).not.toBeVisible();
  };
  const save=async()=>{await main.getByRole('button',{name:'Save subscription',exact:true}).click();await expect(main.locator('[data-module-status]')).toHaveText('Saved');};
  await page.goto(app.origin+'/#/modules/planning');
  await expect(main.getByRole('heading',{name:'Calendar',exact:true})).toBeVisible();
  for(const name of ['Events','Subscriptions','Connected workspaces','Tasks','Equipment agenda']){
   await nav(name).click();await expect(main.getByRole('heading',{name,exact:true})).toBeVisible();
   await expect(dialog).not.toBeVisible();
  }
  await overview();
  await main.getByRole('button',{name:'Subscribe',exact:true}).click();
  await expect(main.getByRole('heading',{name:'New subscription',exact:true})).toBeVisible();
  await overview();
  expect((await subscriptions()).items).toEqual([]);
  await main.getByRole('button',{name:'Subscribe',exact:true}).click();
  await main.getByLabel('Name',{exact:true}).fill(names[0]);
  await main.getByLabel('Calendar subscription URL',{exact:true}).fill(urls[0]);
  await save();await page.reload();
  await expect(main.getByLabel('Name',{exact:true})).toHaveValue(names[0]);
  await expect(main.getByLabel('Calendar subscription URL',{exact:true})).toHaveValue(urls[0]);
  await overview();await nav('Subscriptions').click();
  await main.getByRole('button',{name:'New subscription',exact:true}).click();
  await main.getByLabel('Name',{exact:true}).fill(names[1]);
  await main.getByLabel('Calendar subscription URL',{exact:true}).fill(urls[1]);
  await save();await page.reload();
  await expect(main.getByLabel('Name',{exact:true})).toHaveValue(names[1]);
  await expect(main.getByLabel('Calendar subscription URL',{exact:true})).toHaveValue(urls[1]);
  await overview();await main.getByLabel('Month',{exact:true}).fill('2026-10');
  await main.getByRole('combobox',{name:'View',exact:true}).selectOption('agenda');
  const events=main.locator('.calendar-content .calendar-event');
  await expect(events).toHaveCount(2);
  await expect(events.filter({hasText:'Morning workshop'})).toContainText('Read-only');
  await expect(main.getByRole('checkbox',{name:names[0],exact:true})).toBeChecked();
  await expect(main.getByRole('checkbox',{name:names[1],exact:true})).toBeChecked();
  await events.filter({hasText:'Morning workshop'}).click();
  await expect(dialog.locator('.calendar-notes')).toHaveText('Selected subscription event notes.');
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  workshopTitle='Updated workshop';
  await main.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(events.filter({hasText:workshopTitle})).toHaveCount(1);
  await expect(events.filter({hasText:'Morning workshop'})).toHaveCount(0);
  failWorkshop=true;
  await main.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(main.locator('.calendar-source-error')).toHaveCount(1);
  await expect(main.locator('.calendar-source-error')).toHaveText('Calendar could not refresh.');
  await expect(events).toHaveCount(1);await expect(events).toContainText('Afternoon fieldwork');
  await main.getByLabel('Find a calendar',{exact:true}).fill(names[1]);
  await expect(main.getByRole('checkbox',{name:names[0],exact:true})).toHaveCount(0);
  await expect(main.locator('.calendar-source-error')).toHaveCount(1);
  await expect(main.locator('.calendar-source-error')).toContainText(names[0]);
  await main.getByLabel('Find a calendar',{exact:true}).fill('');
  await expect(main.getByRole('checkbox',{name:names[0],exact:true})).toBeVisible();
  failWorkshop=false;workshopTitle='Recovered workshop';
  await main.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(main.locator('.calendar-source-error')).toHaveCount(0);
  await expect(events).toHaveCount(2);await expect(events.filter({hasText:workshopTitle})).toHaveCount(1);
  await nav('Subscriptions').click();
  await main.locator('.module-item').filter({hasText:names[0]}).getByRole('button',{name:'Open subscription',exact:true}).click();
  await main.getByLabel('Include this subscription',{exact:true}).uncheck();await save();
  await overview();await expect(events).toHaveCount(1);await expect(events).toContainText('Afternoon fieldwork');
  await nav('Subscriptions').click();
  await main.locator('.module-item').filter({hasText:names[0]}).getByRole('button',{name:'Open subscription',exact:true}).click();
  await main.getByLabel('Include this subscription',{exact:true}).check();await save();await page.reload();
  await expect(main.getByLabel('Include this subscription',{exact:true})).toBeChecked();
  await overview();await main.getByLabel('Month',{exact:true}).fill('2026-10');
  await main.getByRole('combobox',{name:'View',exact:true}).selectOption('agenda');await expect(events).toHaveCount(2);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const listed=(await subscriptions()).items;
  const saved=await Promise.all(listed.map(async item=>(await api('/api/modules/item',{id:item.id})).entity));
  expect(saved).toHaveLength(2);expect(saved.every(e=>e.type==='subscription'&&e.data.enabled)).toBe(true);
  expect(saved.map(e=>e.data.url).sort()).toEqual([...urls].sort());
  expect(calls.filter(url=>url===urls[0]).length).toBeGreaterThanOrEqual(4);
  expect(errors).toEqual([]);
 }finally{
  CalendarSources.prototype.data=originalData;
  await app?.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});
 }
});

import {ProjectModuleReader} from '../../src/project-module-reader.js';
import {test,expect} from '@playwright/test';
import path from 'node:path';
import {moduleDashboardFixture} from '../module-dashboard-fixture.js';
import {testServer} from '../device-fixture.js';
import {defaultDashboard,createPanel} from '../../src/web/dashboard-model.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from '../../src/security/dashboard-storage.js';

test('planning and stock cards open and save in their selected dedicated book',async({browser})=>{
 test.setTimeout(240000);const cleanup=[],page=await browser.newPage(),errors=[];let app;
 try{
  const f=await moduleDashboardFixture({after:fn=>cleanup.push(fn)});
  const selected=f.books[0],options={scopeMode:'selected',projectIds:[selected.projectId],includeDescendants:false,includeWorkspace:false,notebookMode:'selected',notebookIds:[selected.labBookId]};
  for(const owner of f.owners){const settings=defaultDashboard();settings.enabledModules.push('planning','resources');if(!owner.projectId)settings.views[0].panels=[{...createPanel('calendar-events','events'),moduleId:'planning',options},{...createPanel('resources','stock'),moduleId:'resources',options}];await writeWorkspaceDashboard(owner.storage,settings,(await readWorkspaceDashboard(owner.storage)).etag);}
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(f.directory,'preferences.json')});page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);
  const events=page.locator('[data-desk-card="events"]'),stock=page.locator('[data-desk-card="stock"]');
  await expect(events.getByRole('button',{name:'Retry',exact:true})).toBeVisible();await events.getByRole('button',{name:'Retry',exact:true}).click();
  const unlock=page.locator('#project-unlock-form');await unlock.getByLabel('Lab book password',{exact:true}).fill('Protected observations 456!');await unlock.getByRole('button',{name:'Unlock',exact:true}).click();await expect(unlock).not.toBeVisible();
  await expect(events.getByRole('button',{name:'Shared event identity',exact:true})).toBeVisible();
  if(await stock.getByRole('button',{name:'Retry',exact:true}).isVisible())await stock.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(stock.getByRole('button',{name:'Shared resource identity',exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('dedicated-module-cards.png'),fullPage:true});
  const home=page.url();await events.getByRole('button',{name:'Shared event identity',exact:true}).click();
  await expect(page).toHaveURL(new RegExp('/owners/'+selected.projectId+'/books/'+selected.labBookId+'/'));
  await expect(page.getByLabel('Event title',{exact:true})).toHaveValue('Shared event identity');
  for(const location of ['First edit','Second edit','Updated book location']){
   let release,finished;
   if(location==='Second edit'){
    const gate=new Promise(resolve=>release=resolve);let started,complete;const reading=new Promise(resolve=>started=resolve);finished=new Promise(resolve=>complete=resolve);
    await page.route('**/modules/item',async route=>{const response=await route.fetch();started();await gate;await route.fulfill({response}).catch(()=>{});complete();},{times:1});
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await reading;
   }
   const input=page.getByLabel('Place or meeting link',{exact:true});await input.fill(location);
   if(release){const node=await input.elementHandle();release();await finished;expect(await node.evaluate(el=>el.isConnected&&el===document.activeElement&&el.value==='Second edit')).toBe(true);await node.dispose();}

   const response=page.waitForResponse(reply=>reply.url().includes('/modules/command')&&reply.request().postDataJSON()?.action==='event.save');
   await page.getByRole('button',{name:'Save event',exact:true}).click();const saved=await response;
   expect(saved.request().postDataJSON().payload.data.location).toBe(location);expect(saved.ok()).toBe(true);await expect(page.locator('[data-module-status]')).toHaveText('Saved');
  }
  const read=owner=>new ProjectModuleReader(owner.storage,owner.workspaceId).selected({workspaceId:owner.workspaceId,id:f.eventId});
  expect((await read(f.owners[3])).entity.data.location).toBe('Updated book location');expect((await read(f.owners[0])).entity.data.location).toBe('Location 0');
  await page.reload();await expect(page.getByLabel('Place or meeting link',{exact:true})).toHaveValue('Updated book location');
  await page.goto(home);await expect(stock.getByRole('button',{name:'Shared resource identity',exact:true})).toBeVisible();await stock.getByRole('button',{name:'Shared resource identity',exact:true}).click();
  await expect(page).toHaveURL(new RegExp('/owners/'+selected.projectId+'/books/'+selected.labBookId+'/'));
  await expect(page.locator('main')).toContainText('Shared resource identity');await expect(page.locator('main')).toContainText('4');
  expect(errors).toEqual([]);
 }finally{await page.close();await app?.close();for(const close of cleanup.reverse())await close();}
});

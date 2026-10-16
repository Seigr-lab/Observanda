import {test,expect} from '@playwright/test';
import path from 'node:path';
import {liveCreationFixture,creationCommand} from '../fixtures/live-creation.js';
import {startLiveHost} from '../../src/collaboration/live-host.js';
import {LiveClient} from '../../src/collaboration/live-client.js';
import {startServer} from '../../src/server.js';
import {navigate,preferences} from './preferences-helper.js';

test('shared record details retain drafts, expose same-field conflicts and retry an acknowledged mutation after a lost response',async({browser})=>{
 test.setTimeout(180000);const cleanup=[],apps=[],contexts=[],errors=[],f=await liveCreationFixture({after:fn=>cleanup.push(fn)});
 const host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',advertise:'https://127.0.0.1',port:0});
 try{
  const signed=await host.card(f.grant.id),card=Buffer.from(JSON.stringify(signed)),pages=[],client=new LiveClient(f.member.deviceStore,signed);cleanup.push(()=>client.close());
  const created=await client.call('create',creationCommand(await client.call('creation',{notebookId:f.book.notebooks[0].id}))),recordId=created.record.id;
  for(let i=0;i<2;i++){
   const app=await startServer({root:f.member.workspace.root,port:0,headless:true,deviceStore:f.member.deviceStore,preferencesFile:path.join(f.directory,'details-'+i+'.prefs')});apps.push(app);
   const context=await browser.newContext();contexts.push(context);const page=await context.newPage();pages.push(page);page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url);
   await navigate(page,'Preferences');await preferences(page,'Modules');await page.getByRole('switch',{name:'Enable Organizations & teams',exact:true}).check();await navigate(page,'Organizations & teams');
   if(!await page.getByRole('button',{name:'Open shared books',exact:true}).count()){
    await page.getByRole('button',{name:'Connect to an installation',exact:true}).click();const d=page.locator('#dialog');await d.getByLabel('Connection card',{exact:true}).setInputFiles({name:'shared.observanda-online',mimeType:'application/json',buffer:card});await expect(d.locator('[data-online-fingerprint]')).toContainText('Owner’s identity');await d.getByRole('checkbox').check();await d.getByRole('button',{name:'Connect to an installation',exact:true}).click();await expect(d).not.toBeVisible();
   }
   await page.getByRole('button',{name:'Open shared books',exact:true}).click();await page.locator('[data-online-record]').selectOption(recordId);await expect(page.locator('[data-live-details]')).toBeVisible();
  }
  const [a,b]=pages,ad=a.locator('[data-live-details]'),bd=b.locator('[data-live-details]'),save=form=>form.getByRole('button',{name:'Save record details',exact:true}).click();
  expect(errors).toEqual([]);await expect(bd.locator('[name="template:conditions"]')).toHaveAccessibleName('Conditions');
  await expect(ad.getByLabel('Exact counter (ticks)',{exact:true})).toHaveValue('9007199254740993.123456789');await ad.getByLabel('Exact counter (ticks)',{exact:true}).fill('9007199254740993.123456790');
  await bd.getByLabel('Conditions',{exact:true}).fill('Controlled light');await bd.getByLabel('Control setting',{exact:true}).selectOption('Closed');await bd.getByLabel('Review date',{exact:true}).fill('2026-10-10');await save(bd);
  await expect(ad.getByLabel('Conditions',{exact:true})).toHaveValue('Controlled light');await expect(ad.getByLabel('Exact counter (ticks)',{exact:true})).toHaveValue('9007199254740993.123456790');
  await bd.getByLabel('Exact counter (ticks)',{exact:true}).fill('9007199254740993.123456800');await save(bd);await expect(ad.locator('[data-detail-conflicts]')).toContainText('9007199254740993.123456800');
  await ad.getByRole('button',{name:'Keep my edit',exact:true}).click();await save(ad);await expect(bd.getByLabel('Exact counter (ticks)',{exact:true})).toHaveValue('9007199254740993.123456790');
  await ad.getByLabel('Outcome',{exact:true}).fill('My observation');
  await bd.getByLabel('Progress',{exact:true}).selectOption('in progress');await save(bd);
  await expect(ad.getByLabel('Progress',{exact:true})).toHaveValue('in progress');await expect(ad.getByLabel('Outcome',{exact:true})).toHaveValue('My observation');
  await bd.getByLabel('Outcome',{exact:true}).fill('Another observation');await save(bd);
  await expect(ad.locator('[data-detail-conflicts]')).toContainText('Another observation');await expect(ad.getByRole('button',{name:'Save record details',exact:true})).toBeDisabled();
  await ad.getByRole('button',{name:'Keep my edit',exact:true}).click();await save(ad);await expect(bd.getByLabel('Outcome',{exact:true})).toHaveValue('My observation');
  await ad.getByLabel('Record title',{exact:true}).fill('Unsaved title');await a.getByRole('button',{name:'Close shared books',exact:true}).click();await expect(ad).toBeVisible();
  await bd.getByLabel('Record title',{exact:true}).fill('Reviewed shared title');await save(bd);await expect(ad.locator('[data-detail-conflicts]')).toContainText('Reviewed shared title');
  await ad.getByRole('button',{name:'Use shared value',exact:true}).click();await expect(ad.getByLabel('Record title',{exact:true})).toHaveValue('Reviewed shared title');
  await ad.getByLabel('Tags',{exact:true}).fill('counts, controls');await ad.getByLabel('Progress',{exact:true}).selectOption('completed');await ad.getByLabel('Accepted',{exact:true}).selectOption('true');
  let command,lost=false;
  await a.route('**/api/live/request',async route=>{const data=route.request().postDataJSON();if(data.operation==='fields'){if(!lost){lost=true;command=data.data;await route.fetch();await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic lost response'})});return;}expect(data.data).toEqual(command);}await route.continue();});
  await save(ad);await expect(ad.getByRole('button',{name:'Retry pending request',exact:true})).toBeVisible();await expect(ad.getByLabel('Progress',{exact:true})).toBeDisabled();await expect(ad.getByLabel('Tags',{exact:true})).toHaveAttribute('readonly','');
  await ad.getByRole('button',{name:'Retry pending request',exact:true}).click();await expect(ad.locator('[data-detail-status]')).toContainText('Record details saved');await a.unroute('**/api/live/request');
  await expect(bd.getByLabel('Tags',{exact:true})).toHaveValue('counts, controls');await expect(bd.getByLabel('Progress',{exact:true})).toHaveValue('completed');
  await expect(bd.getByLabel('Accepted',{exact:true})).toHaveValue('true');
  const retained=(await client.call('read',{recordId})).record;expect(retained.template.values.counter).toBe('9007199254740993.123456790');expect(retained.template.values.accepted).toBe(true);expect(retained.template.values.reviewDate).toBe('2026-10-10');expect(retained.template.values.control).toBe('Closed');
  await a.locator('[data-live-read]>summary').click();const reader=a.locator('[data-reader-record]');await expect(reader).toContainText('9007199254740993.123456790');await expect(reader).toContainText('Closed');
  await ad.getByLabel('Conditions',{exact:true}).fill('An unsaved condition');await bd.getByLabel('Conditions',{exact:true}).fill('Later saved condition');await save(bd);
  await expect(ad.locator('[data-detail-conflicts]')).toContainText('Later saved condition');
  await a.locator('[data-reader-refresh]').click();await expect(reader).toContainText('Later saved condition');await expect(ad.getByLabel('Conditions',{exact:true})).toHaveValue('An unsaved condition');await ad.getByRole('button',{name:'Use shared value',exact:true}).click();
  const manyTags=Array.from({length:33},(_,i)=>'tag'+i).join(', ');await ad.getByLabel('Tags',{exact:true}).fill(manyTags);await save(ad);await expect(bd.getByLabel('Tags',{exact:true})).toHaveValue(manyTags);
  await ad.getByLabel('Tags',{exact:true}).fill('x'.repeat(41));await save(ad);await expect(a.locator('#notice')).toContainText('Use at most 40 characters for each tag name.');
  await ad.getByRole('button',{name:'Discard detail changes',exact:true}).click();await expect(ad.getByLabel('Tags',{exact:true})).toHaveValue(manyTags);
  await a.setViewportSize({width:390,height:844});await ad.scrollIntoViewIfNeeded();expect(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await a.screenshot({path:test.info().outputPath('shared-record-details-phone.png')});
  await a.getByRole('button',{name:'Close shared books',exact:true}).click();await expect(ad).toHaveCount(0);await a.getByRole('button',{name:'Open shared books',exact:true}).click();await a.locator('[data-online-record]').selectOption(recordId);await expect(a.getByLabel('Outcome',{exact:true})).toHaveValue('My observation');await expect(ad.getByLabel('Exact counter (ticks)',{exact:true})).toHaveValue('9007199254740993.123456790');expect(errors).toEqual([]);
 }finally{for(const context of contexts)await context.close();for(const app of apps)await app.close();await host.close();for(const fn of cleanup.reverse())await fn();}
});

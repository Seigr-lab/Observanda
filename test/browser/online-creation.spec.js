import {test,expect} from '@playwright/test';
import path from 'node:path';
import {liveCreationFixture} from '../fixtures/live-creation.js';
import {startLiveHost} from '../../src/collaboration/live-host.js';
import {startServer} from '../../src/server.js';
import {navigate,preferences} from './preferences-helper.js';

test('create a shared record with host fields, write together, and resume a lost creation response after reloading',async({browser})=>{
 test.setTimeout(180000);const cleanup=[],errors=[],f=await liveCreationFixture({after:fn=>cleanup.push(fn)});
 const host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',advertise:'https://127.0.0.1',port:0}),app=await startServer({root:f.member.workspace.root,port:0,headless:true,deviceStore:f.member.deviceStore,preferencesFile:path.join(f.directory,'creation.prefs')}),context=await browser.newContext(),page=await context.newPage();
 try{
  page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url);
  await navigate(page,'Preferences');await preferences(page,'Modules');await page.getByRole('switch',{name:'Enable Organizations & teams',exact:true}).check();await navigate(page,'Organizations & teams');
  await page.getByRole('button',{name:'Connect to an installation',exact:true}).click();const dialog=page.locator('#dialog');
  await dialog.getByLabel('Connection card',{exact:true}).setInputFiles({name:'shared.observanda-online',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(await host.card(f.grant.id)))});
  await expect(dialog.locator('[data-online-fingerprint]')).toContainText('Owner’s identity');await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Connect to an installation',exact:true}).click();await expect(dialog).not.toBeVisible();
  await page.getByRole('button',{name:'Open shared books',exact:true}).click();await page.getByRole('button',{name:'New shared record',exact:true}).click();
  await expect(dialog.getByLabel('Record type',{exact:true})).toHaveValue('template:'+f.templateId);await expect(dialog.getByLabel('Lab book',{exact:true}).locator('option')).toHaveCount(1);
  await dialog.getByLabel('Record title',{exact:true}).fill('Next shared acquisition');await dialog.getByLabel('Exact counter (ticks)',{exact:true}).fill('9007199254740993.123456789');await dialog.getByLabel('Accepted',{exact:true}).selectOption('false');await dialog.getByLabel('Conditions',{exact:true}).fill('Dark chamber');
  await page.setViewportSize({width:390,height:844});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('shared-record-creation-phone.png')});
  await dialog.getByRole('button',{name:'Create record',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.locator('[data-live-details]').getByLabel('Record title',{exact:true})).toHaveValue('Next shared acquisition');
  const editor=page.locator('.online-research [contenteditable="true"]');await expect(editor).toBeVisible();await editor.fill('A new observation from the collaborator.');
  await expect.poll(async()=>{const {book}=await f.author.workspace.read();return JSON.stringify(book.entries.find(e=>e.title==='Next shared acquisition')?.body);}).toContain('A new observation from the collaborator.');
  let record=(await f.author.workspace.read()).book.entries.find(e=>e.title==='Next shared acquisition');expect(record.template.values.counter).toBe('9007199254740993.123456789');expect(record.template.values.accepted).toBe(false);expect(record.share).toBe(false);
  await page.getByRole('button',{name:'New shared record',exact:true}).click();await expect(dialog).toBeVisible();await dialog.getByLabel('Record type',{exact:true}).selectOption('type:experiment');await dialog.getByLabel('Record title',{exact:true}).fill('Retry-safe experiment');
  let lost=false;
  await page.route('**/api/live/create-record',async route=>{if(!lost){lost=true;await route.fetch();await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic lost creation response'})});return;}await route.continue();});
  await dialog.getByRole('button',{name:'Create record',exact:true}).click();await expect(dialog.getByRole('button',{name:'Retry pending request',exact:true})).toBeVisible();await expect(dialog).toContainText('Retry-safe experiment');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.reload();await navigate(page,'Organizations & teams');await page.getByRole('button',{name:'Open shared books',exact:true}).click();
  await page.getByRole('button',{name:'Resume record creation',exact:true}).click();await dialog.getByRole('button',{name:'Open created record',exact:true}).click();await expect(dialog).not.toBeVisible();
  await expect(page.locator('[data-live-details]').getByLabel('Record title',{exact:true})).toHaveValue('Retry-safe experiment');
  const records=(await f.author.workspace.read()).book.entries.filter(e=>e.title==='Retry-safe experiment');expect(records).toHaveLength(1);expect(records[0].sections.length).toBeGreaterThan(3);
  await page.getByRole('button',{name:'New shared record',exact:true}).click();await dialog.getByLabel('Record title',{exact:true}).fill('After template review');await dialog.getByLabel('Exact counter (ticks)',{exact:true}).fill('12345678901234567890');await dialog.getByLabel('Accepted',{exact:true}).selectOption('true');
  await f.author.workspace.update(book=>{book.notebooks.find(n=>n.id===f.book.notebooks[0].id).configuration.sections[0].description='Reviewed host procedure';return book;});
  await dialog.getByRole('button',{name:'Create record',exact:true}).click();await dialog.getByRole('button',{name:'Review creation details',exact:true}).click();
  await expect(dialog).toContainText('Reviewed host procedure');await expect(dialog.getByLabel('Record title',{exact:true})).toHaveValue('After template review');await expect(dialog.getByLabel('Exact counter (ticks)',{exact:true})).toHaveValue('12345678901234567890');
  await dialog.getByRole('button',{name:'Create record',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.locator('[data-live-details]').getByLabel('Record title',{exact:true})).toHaveValue('After template review');
  const {generation,...grant}=f.grant;void generation;await f.sa.access.saveLocal(await f.a.identity.public(),{...grant,workspaceId:f.book.id,expectedRevision:1,role:'reader'});
  await page.getByRole('button',{name:'Close shared books',exact:true}).click();await page.getByRole('button',{name:'Open shared books',exact:true}).click();await expect(page.getByRole('button',{name:'New shared record',exact:true})).toHaveCount(0);expect(errors).toEqual([]);
 }finally{await context.close();await app.close();await host.close();for(const fn of cleanup.reverse())await fn();}
});

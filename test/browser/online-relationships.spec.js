import {test,expect} from '@playwright/test';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {collaborationFixture} from '../fixtures/collaboration.js';
import {startLiveHost} from '../../src/collaboration/live-host.js';
import {LiveClient} from '../../src/collaboration/live-client.js';
import {startServer} from '../../src/server.js';
import {navigate,preferences} from './preferences-helper.js';

test('shared research links retain inspected methods, preserve local writing, expose conflicts and settle lost responses',async({browser})=>{
 test.setTimeout(180000);const cleanup=[],errors=[],f=await collaborationFixture({after:fn=>cleanup.push(fn)}),{book}=await f.author.workspace.read(),source=book.entries[0],method=book.entries[1];
 const host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',advertise:'https://127.0.0.1',port:0}),signed=await host.card(f.grant.id),client=new LiveClient(f.member.deviceStore,signed);
 const app=await startServer({root:f.member.workspace.root,port:0,headless:true,deviceStore:f.member.deviceStore,preferencesFile:path.join(f.directory,'links.prefs')}),context=await browser.newContext(),page=await context.newPage();
 try{
  page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url);
  await navigate(page,'Preferences');await preferences(page,'Modules');await page.getByRole('switch',{name:'Enable Organizations & teams',exact:true}).check();await navigate(page,'Organizations & teams');
  await page.getByRole('button',{name:'Connect to an installation',exact:true}).click();const dialog=page.locator('#dialog');
  await dialog.getByLabel('Connection card',{exact:true}).setInputFiles({name:'shared.observanda-online',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(signed))});await expect(dialog.locator('[data-online-fingerprint]')).toContainText('Owner’s identity');await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Connect to an installation',exact:true}).click();await expect(dialog).not.toBeVisible();
  await page.getByRole('button',{name:'Open shared books',exact:true}).click();await page.locator('[data-online-record]').selectOption(source.id);
  const links=page.locator('[data-live-links]'),form=links.locator('form'),details=page.locator('[data-live-details]');await links.locator('summary').click();
  await details.getByLabel('Outcome',{exact:true}).fill('Unsaved local assessment');
  await links.getByRole('button',{name:'Add research link',exact:true}).click();await form.getByLabel('Relationship purpose',{exact:true}).selectOption('uses-method');await form.getByLabel('Linked record',{exact:true}).selectOption(method.id);
  await expect(form.getByLabel('Retain this exact revision for a general relationship',{exact:true})).toBeChecked();await expect(form.getByLabel('Retain this exact revision for a general relationship',{exact:true})).toBeDisabled();
  await form.getByRole('button',{name:'Inspect selected record',exact:true}).click();await expect(links.locator('[data-link-view]')).toContainText(method.title);
  await expect(form.getByRole('button',{name:'Save research link',exact:true})).toBeEnabled();
  await form.getByRole('button',{name:'Save research link',exact:true}).click();await expect(form).toBeHidden();await expect(links.locator('[data-link-list]')).toContainText('Uses method');
  const link=(await client.call('links',{recordId:source.id})).relations.find(r=>r.role==='uses-method');expect(link).toBeTruthy();
  await f.author.workspace.update(book=>{book.entries.find(r=>r.id===method.id).body='New instructions that must not replace the retained method';return book;});
  await links.getByRole('button',{name:'Read linked record',exact:true}).click();await expect(links.locator('[data-link-view]')).toContainText(link.target.revision);await expect(links.locator('[data-link-view]')).not.toContainText('New instructions');await expect(details.getByLabel('Outcome',{exact:true})).toHaveValue('Unsaved local assessment');
  await links.getByRole('button',{name:'Edit link',exact:true}).click();await form.getByLabel('Relationship',{exact:true}).selectOption('Builds on');
  await client.call('link-write',{recordId:source.id,id:randomUUID(),linkId:link.id,before:link,value:{type:'Supports',role:'uses-method',target:{id:method.id,revision:link.target.revision}}});
  await expect(form.locator('[data-link-conflict]')).toBeVisible();await expect(form.getByRole('button',{name:'Save research link',exact:true})).toBeDisabled();await expect(form.getByLabel('Relationship',{exact:true})).toHaveValue('Builds on');
  await form.getByRole('button',{name:'Use latest shared link',exact:true}).click();await expect(form.getByLabel('Relationship',{exact:true})).toHaveValue('Supports');await form.getByLabel('Relationship',{exact:true}).selectOption('Builds on');
  let lost=false,command;
  await page.route('**/api/live/request',async route=>{const data=route.request().postDataJSON();if(data.operation==='link-write'){if(!lost){lost=true;command=data.data;await route.fetch();await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic lost response'})});return;}expect(data.data).toEqual(command);}await route.continue();});
  await form.getByRole('button',{name:'Save research link',exact:true}).click();await expect(form.getByRole('button',{name:'Retry pending request',exact:true})).toBeEnabled();await expect(form.getByLabel('Relationship',{exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Close shared books',exact:true}).click();await expect(form).toBeVisible();
  await form.getByRole('button',{name:'Retry pending request',exact:true}).click();await expect(form).toBeHidden();await page.unroute('**/api/live/request');
  const saved=(await client.call('links',{recordId:source.id})).relations.find(r=>r.id===link.id);expect(saved.type).toBe('Builds on');expect(saved.target.revision).toBe(link.target.revision);
  await details.getByRole('button',{name:'Discard detail changes',exact:true}).click();
  // A target changed after selection must be inspected again, not silently pinned.
  await links.getByRole('button',{name:'Add research link',exact:true}).click();await form.getByLabel('Relationship purpose',{exact:true}).selectOption('compares');await form.getByLabel('Linked record',{exact:true}).selectOption(method.id);
  await f.author.workspace.update(book=>{book.entries.find(r=>r.id===method.id).title='Current reviewed method';return book;});
  await form.getByRole('button',{name:'Save research link',exact:true}).click();await expect(page.locator('#notice')).toContainText('The link or selected record changed before saving');await expect(form).toBeVisible();
  await form.getByRole('button',{name:'Inspect selected record',exact:true}).click();await expect(links.locator('[data-link-view]')).toContainText('Current reviewed method');await form.getByRole('button',{name:'Save research link',exact:true}).click();await expect(form).toBeHidden();await expect(links.locator('[data-link-list] li')).toHaveCount(2);
  await page.setViewportSize({width:390,height:844});await links.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('shared-methods-phone.png')});
  await links.locator('[data-link-list] li').first().getByRole('button',{name:'Remove link',exact:true}).click();await expect(links.locator('[data-link-list] li')).toHaveCount(1);await expect(links.locator('..')).toHaveAttribute('aria-busy','false');
  await page.getByRole('button',{name:'Close shared books',exact:true}).click();await expect(links).toHaveCount(0);expect(errors).toEqual([]);
 }finally{await context.close();await app.close();client.close();await host.close();for(const fn of cleanup.reverse())await fn();}
});

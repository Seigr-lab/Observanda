import {test,expect} from '@playwright/test';
import path from 'node:path';
import {collaborationFixture} from '../fixtures/collaboration.js';
import {LiveConnections} from '../../src/collaboration/live-connections.js';
import {startLiveHost} from '../../src/collaboration/live-host.js';
import {startServer} from '../../src/server.js';
import {navigate,preferences} from './preferences-helper.js';

test('an interrupted structured save reopens after browser restart and confirms its original host result once',async({browser})=>{
 test.setTimeout(150000);const cleanup=[],errors=[],f=await collaborationFixture({after:fn=>cleanup.push(fn)}),recordId=f.book.entries[0].id;
 const host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',advertise:'https://127.0.0.1',port:0}),card=await host.card(f.grant.id),manager=new LiveConnections(f.member.workspace,f.member.deviceStore);
 await manager.command('connect',{card,verifiedFingerprint:card.identity.id});await manager.close();
 const app=await startServer({root:f.member.workspace.root,port:0,headless:true,deviceStore:f.member.deviceStore,preferencesFile:path.join(f.directory,'attempt-recovery.prefs')}),context=await browser.newContext(),page=await context.newPage();
 try{
  page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url);await navigate(page,'Preferences');await preferences(page,'Modules');await page.getByRole('switch',{name:'Enable Organizations & teams',exact:true}).check();await navigate(page,'Organizations & teams');await page.getByRole('button',{name:'Open shared books',exact:true}).click();await page.locator('[data-online-record]').selectOption(recordId);
  const view=page.locator('[data-live-attempt]'),form=view.locator('form');await view.locator('>summary').click();await view.getByRole('button',{name:'Record event',exact:true}).click();await form.getByLabel('Circumstances, including accidental attempts or reused media',{exact:true}).fill('Keep this exact failed-return observation');
  let command;await page.route('**/api/live/append-attempt',async route=>{command=route.request().postDataJSON().command;await route.fetch();await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic missing browser acknowledgement'})});});
  await form.getByRole('button',{name:'Save shared fact',exact:true}).click();await expect(form.getByRole('button',{name:'Retry pending request',exact:true})).toBeEnabled();
  await page.unroute('**/api/live/append-attempt');await page.reload();await navigate(page,'Organizations & teams');await page.getByRole('button',{name:'Open shared books',exact:true}).click();await page.locator('[data-online-record]').selectOption(recordId);
  await expect(view.locator('[data-attempt-recovered]')).toContainText('previous structured save');await expect(form.getByLabel('Circumstances, including accidental attempts or reused media',{exact:true})).toHaveValue('Keep this exact failed-return observation');await expect(form.getByLabel('Circumstances, including accidental attempts or reused media',{exact:true})).toBeDisabled();
  await page.route('**/api/live/append-attempt',async route=>{expect(route.request().postDataJSON().command).toEqual(command);await route.continue();});await form.getByRole('button',{name:'Retry pending request',exact:true}).click();await expect(form).toHaveCount(0);await expect(view.locator('[data-attempt-recovered]')).toBeEmpty();
  const saved=(await f.author.workspace.read()).book.entries.find(r=>r.id===recordId);expect(saved.attempt.events).toHaveLength(1);expect(saved.attempt.events[0].id).toBe(command.id);expect(saved.attempt.events[0].circumstances).toBe(command.item.circumstances);
  await expect(view.locator('..')).toHaveAttribute('aria-busy','false');await page.getByRole('button',{name:'Close shared books',exact:true}).click();expect(errors).toEqual([]);
 }finally{await context.close();await app.close();await host.close();for(const fn of cleanup.reverse())await fn();}
});

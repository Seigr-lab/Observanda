import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startServer} from '../../src/server.js';
import {sampleNotebook} from '../../src/sample.js';
import {Workspace} from '../../src/storage.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
test('a failed application module shows keyboard-accessible reload and preserves the launch link',async({page})=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-startup-'));await new Workspace(root).create(sampleNotebook());
 const app=await startServer({root,port:0,headless:true,preferencesFile:path.join(root,'preferences.json')});
 try{
  await page.route('**/record-history-ui.js',route=>route.abort('internetdisconnected'));
  await page.goto(app.url);const heading=page.getByRole('heading',{name:'Observanda could not load'});await expect(heading).toBeVisible();await expect(heading).toBeFocused();
  expect(page.url()).toBe(app.url);await expect(page.getByText('Opening Observanda',{exact:false})).toHaveCount(0);
  await page.unroute('**/record-history-ui.js');await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Reload Observanda'})).toBeFocused();await page.keyboard.press('Enter');
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible({timeout:15000});await expect(heading).toHaveCount(0);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});

for(const failure of ['session-request','session-response','preferences','workspace-status'])test('startup recovers from interrupted '+failure+' without replacing the workspace',async({page})=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-open-retry-')),f=await encryptedFixture(root,sampleNotebook()),before=await f.workspace.read(),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(root,'preferences.json')});
 const route=failure.startsWith('session')?'**/api/session':failure==='preferences'?'**/api/language':'**/api/access/status';let attempts=0;
 try{
  await page.route(route,async request=>{attempts++;if(failure==='session-response')await request.fetch();await request.abort('connectionreset');});
  await page.goto(app.url);await expect(page.getByRole('heading',{name:'Observanda could not finish opening',exact:true})).toBeVisible();
  if(failure.startsWith('session'))expect(page.url()).toBe(app.url);else expect(new URL(page.url()).hash).toBe('');
  expect(attempts).toBe(1);await page.getByRole('button',{name:'Reload Observanda',exact:true}).click();await expect(page.getByRole('heading',{name:'Observanda could not finish opening',exact:true})).toBeVisible();expect(attempts).toBe(2);
  await page.unroute(route);await page.getByRole('button',{name:'Reload Observanda',exact:true}).click();await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();expect(page.url()).not.toContain(app.launchToken);expect(await page.locator('body').innerText()).not.toContain(app.launchToken);
  expect(await f.workspace.read()).toEqual(before);
 }finally{await app.close();clearVault(f.vault);await rm(root,{recursive:true,force:true});}
});

test('dependency failure during an authenticated reload keeps the requested record route',async({page})=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-reload-route-')),f=await encryptedFixture(root,sampleNotebook()),before=await f.workspace.read(),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(root,'preferences.json')}),id=before.book.entries[0].id;
 try{
  await page.goto(app.url);await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();await page.evaluate(id=>location.hash='#/records/'+id+'/read',id);await expect(page.locator('.record-reader')).toContainText(before.book.entries[0].title);
  await page.route('**/record-history-ui.js',route=>route.abort('internetdisconnected'));await page.reload();await expect(page.getByRole('heading',{name:'Observanda could not load',exact:true})).toBeVisible();expect(new URL(page.url()).hash).toBe('#/records/'+id+'/read');
  await page.unroute('**/record-history-ui.js');await page.getByRole('button',{name:'Reload Observanda',exact:true}).click();await expect(page.locator('.record-reader')).toContainText(before.book.entries[0].title);expect(await f.workspace.read()).toEqual(before);
 }finally{await app.close();clearVault(f.vault);await rm(root,{recursive:true,force:true});}
});

test('a record route chosen while session establishment is pending survives the acknowledgement',async({page})=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-connect-route-')),f=await encryptedFixture(root,sampleNotebook()),before=await f.workspace.read(),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(root,'preferences.json')}),record=before.book.entries[0];let release,arrived;
 const pending=new Promise(resolve=>{arrived=resolve;}),hold=new Promise(resolve=>{release=resolve;});
 try{
  await page.route('**/api/session',async route=>{const response=await route.fetch();arrived();await hold;await route.fulfill({response});});await page.goto(app.url);await pending;
  await page.evaluate(id=>location.hash='#/records/'+id+'/read',record.id);release();await expect(page.locator('.record-reader')).toContainText(record.title);expect(new URL(page.url()).hash).toBe('#/records/'+record.id+'/read');
 }finally{release();await app.close();clearVault(f.vault);await rm(root,{recursive:true,force:true});}
});

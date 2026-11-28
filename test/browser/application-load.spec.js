import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startServer} from '../../src/server.js';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
// Seed the canonical folder title so startup's existing identity migration is
// already satisfied; these tests check interrupted loading, not that migration.
const startupBook=()=>({...sampleNotebook(),title:'workspace'});
test('a failed application module shows keyboard-accessible reload and preserves the launch link',async({page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-startup-')),f=await encryptedFixture(directory,sampleNotebook()),root=f.workspace.root;
 const app=await startServer({root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')}),launch=app.url;
 try{
  await page.context().route('**/record-history-ui.js',route=>route.abort('internetdisconnected'));
  await page.goto(launch);const heading=page.getByRole('heading',{name:'Observanda could not load'});await expect(heading).toBeVisible();await expect(heading).toBeFocused();
  expect(page.url()).toBe(launch);await expect(page.getByText('Opening Observanda',{exact:false})).toHaveCount(0);
  await page.context().unroute('**/record-history-ui.js');await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Reload Observanda'})).toBeFocused();await page.keyboard.press('Enter');
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible({timeout:15000});await expect(heading).toHaveCount(0);
 }finally{await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

for(const failure of ['session-request','session-response','preferences','workspace-status'])test('startup recovers from interrupted '+failure+' without replacing the workspace',async({page})=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-open-retry-')),f=await encryptedFixture(root,startupBook()),before=await f.workspace.read(),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(root,'preferences.json')});
 const route=failure.startsWith('session')?'**/api/session':failure==='preferences'?'**/api/language':'**/api/access/status',launch=app.url;let attempts=0;
 try{
  await page.context().route(route,async request=>{attempts++;if(failure==='session-response')await request.fetch();await request.abort('connectionreset');});
  await page.goto(launch);await expect(page.getByRole('heading',{name:'Observanda could not finish opening',exact:true})).toBeVisible();
  if(failure.startsWith('session'))expect(page.url()).toBe(launch);else expect(new URL(page.url()).hash).toBe('');
  expect(attempts).toBe(1);await page.getByRole('button',{name:'Reload Observanda',exact:true}).click();await expect(page.getByRole('heading',{name:'Observanda could not finish opening',exact:true})).toBeVisible();expect(attempts).toBe(2);
  await page.context().unroute(route);await page.getByRole('button',{name:'Reload Observanda',exact:true}).click();await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();expect(page.url()).not.toContain(app.launchToken);expect(await page.locator('body').innerText()).not.toContain(app.launchToken);
  expect(await f.workspace.read()).toEqual(before);
 }finally{await app.close();await clearVault(f.vault);await rm(root,{recursive:true,force:true});}
});

test('dependency failure during an authenticated reload keeps the requested record route',async({page})=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-reload-route-')),f=await encryptedFixture(root,startupBook()),before=await f.workspace.read(),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(root,'preferences.json')}),id=before.book.entries[0].id;
 try{
  await page.goto(app.url);await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();await page.evaluate(id=>location.hash='#/records/'+id+'/read',id);await expect(page.locator('.record-reader')).toContainText(before.book.entries[0].title);
  await page.context().route('**/record-history-ui.js',route=>route.abort('internetdisconnected'));await page.reload();await expect(page.getByRole('heading',{name:'Observanda could not load',exact:true})).toBeVisible();expect(new URL(page.url()).hash).toBe('#/records/'+id+'/read');
  await page.context().unroute('**/record-history-ui.js');await page.getByRole('button',{name:'Reload Observanda',exact:true}).click();await expect(page.locator('.record-reader')).toContainText(before.book.entries[0].title);expect(await f.workspace.read()).toEqual(before);
 }finally{await app.close();await clearVault(f.vault);await rm(root,{recursive:true,force:true});}
});

test('a record route chosen while session establishment is pending survives the acknowledgement',async({page})=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-connect-route-')),f=await encryptedFixture(root,startupBook()),before=await f.workspace.read(),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(root,'preferences.json')}),record=before.book.entries[0];let release,arrived;
 const pending=new Promise(resolve=>{arrived=resolve;}),hold=new Promise(resolve=>{release=resolve;});
 try{
  await page.context().route('**/api/session',async route=>{const response=await route.fetch();arrived();await hold;await route.fulfill({response});});await page.goto(app.url);await pending;
  await page.evaluate(id=>location.hash='#/records/'+id+'/read',record.id);release();await expect(page.locator('.record-reader')).toContainText(record.title);expect(new URL(page.url()).hash).toBe('#/records/'+record.id+'/read');
 }finally{release();await app.close();await clearVault(f.vault);await rm(root,{recursive:true,force:true});}
});
test('an open window renews its session, and a window whose session ended offers to reconnect once',async({page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-startup-')),f=await encryptedFixture(directory,startupBook()),root=f.workspace.root;
 const app=await startServer({root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')}),real=Date.now;
 try{
  await page.goto(app.url);await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible({timeout:15000});
  // Returning to the window renews its session.
  const renewed=page.waitForResponse(response=>response.url().endsWith('/api/session/renew'));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));expect((await renewed).status()).toBe(200);
  // After the session has ended (here: the clock moves past its lifetime), the window asks to be reconnected.
  // A browser has no desktop app to answer, so it shows the reconnect page once instead of reloading in a loop.
  Date.now=()=>real()+9*60*60*1000;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  const heading=page.getByRole('heading',{name:'This window is no longer connected',exact:true});await expect(heading).toBeVisible({timeout:15000});await expect(heading).toBeFocused();
  expect(new URL(page.url()).searchParams.get('observanda-reconnect')).toBe('1');
  await expect(page.getByText('Close Observanda and open it again',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Reconnect',exact:true})).toBeVisible();
 }finally{Date.now=real;await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

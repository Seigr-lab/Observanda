import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {testServer,TestDeviceStore} from '../device-fixture.js';
import {createWorkspaceAccess,takeCreatedVault,createAccess} from '../../src/access.js';
import {recoveryKey} from '../../src/security/keyring.js';
import {clearVault} from '../../src/encryption.js';
import {initializeLocation} from '../../src/locations.js';
import {createNotebook} from '../../src/model.js';

async function fixture(mode='setup'){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-help-access-')),root=path.join(directory,'Private workspace canary');
 const deviceStore=new TestDeviceStore({file:path.join(directory,'device.key')}),password='Synthetic access password',book=createNotebook('Private workspace canary');
 let vault,recovery;
 if(mode==='locked'||mode==='legacy'){
  let access=mode==='legacy'?await createAccess('',password):await createWorkspaceAccess('',password,deviceStore);vault=takeCreatedVault(access);
  if(mode==='locked'){const kit=recoveryKey(access,vault);access=kit.value;recovery=kit.recovery;}
  await initializeLocation(root,book,access,vault);
 }
 const app=await testServer({root,deviceStore,port:0,headless:true,expectedExisting:mode==='missing',preferencesFile:path.join(directory,'preferences.json')});
 return {app,root,password,recovery,close:async()=>{await app.close();if(vault)clearVault(vault);await rm(directory,{recursive:true,force:true});}};
}
function watch(page){
 const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))requests.push({path:new URL(r.url()).pathname,method:r.method(),body:r.postData()});});
 return {errors,requests};
}
const help=page=>page.locator('dialog.help-access');

test('setup Help keeps the current step, controls and credentials through search, languages and keyboard return',async({page},testInfo)=>{
 const f=await fixture(),observed=watch(page);
 try{
  await page.goto(f.app.url);await page.getByLabel('Workspace name',{exact:true}).fill('Unsubmitted setup');
  await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('checkbox',{name:/^Computer/}).check();await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByLabel('Use a password',{exact:false}).check();await page.getByLabel('Password',{exact:true}).fill(f.password);await page.getByLabel('Confirm password',{exact:true}).fill(f.password);
  await page.evaluate(()=>{window.setupForm=document.querySelector('#create-form');});observed.requests.length=0;
  const entry=page.locator('[data-action="access-help"]');await entry.focus();await page.keyboard.press('Enter');
  await expect(help(page).getByRole('heading',{name:'Create or open a workspace',exact:true})).toBeVisible();await expect(page.locator('#leave-dialog')).not.toBeVisible();
  await help(page).getByRole('searchbox').fill('recovery');await expect(help(page).locator('.help-results li')).not.toHaveCount(0);
  await help(page).getByRole('link',{name:'Storage, backup and access — Unlock and recover access',exact:true}).click();await expect(help(page).locator('#help-storage-unlock')).toBeFocused();
  await help(page).locator('[data-language-choice]').selectOption('ca');await expect(help(page).getByRole('button',{name:'Torna al formulari'})).toBeVisible();
  await expect(help(page).locator('#help-storage-unlock').locator('..')).toHaveAttribute('lang','ca');
  await help(page).locator('[data-language-choice]').selectOption('en');await expect(help(page).getByRole('button',{name:'Return to form'})).toBeVisible();
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='20px');
  expect(await help(page).evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);expect(await help(page).locator('.help-access-body').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('setup-help-narrow.png')});
  await page.keyboard.press('Escape');await expect(help(page)).toHaveCount(0);await expect(entry).toBeFocused();
  expect(await page.evaluate(()=>setupForm===document.querySelector('#create-form'))).toBe(true);
  await expect(page.getByRole('heading',{name:'Storage & protection',exact:true})).toBeVisible();await expect(page.getByLabel('Password',{exact:true})).toHaveValue(f.password);await expect(page.getByLabel('Confirm password',{exact:true})).toHaveValue(f.password);
  expect(observed.requests.every(r=>r.path==='/api/language'||r.path==='/api/activity'&&r.method==='GET'&&r.body===null),JSON.stringify(observed.requests)).toBe(true);expect(JSON.stringify(observed.requests)).not.toContain(f.password);
  await entry.click();await expect(help(page).locator('#help-getting-started-setup')).toBeVisible();await expect(help(page).getByRole('searchbox')).toHaveValue('');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Back',exact:true}).click();await expect(page.getByRole('checkbox',{name:/^Computer/})).toBeChecked();await page.getByRole('button',{name:'Back',exact:true}).click();await expect(page.getByLabel('Workspace name',{exact:true})).toHaveValue('Unsubmitted setup');
  expect(observed.errors).toEqual([]);
 }finally{await f.close();}
});

test('closing Help cancels a pending guide load and never remounts the setup form',async({page})=>{
 const f=await fixture(),observed=watch(page);
 let held,release;const intercepted=new Promise(resolve=>{release=resolve;});
 try{
  await page.goto(f.app.url);await page.getByLabel('Workspace name',{exact:true}).fill('Retain this draft');
  await page.route('**/locales/en/guide.json',route=>{held=route;release();});
  await page.getByRole('button',{name:'Help',exact:true}).click();await intercepted;await expect(help(page).getByRole('status').filter({hasText:'Loading documentation'})).toBeVisible();
  await page.keyboard.press('Escape');await expect(help(page)).toHaveCount(0);await held.abort().catch(()=>{});await page.unroute('**/locales/en/guide.json');
  await expect(page.getByLabel('Workspace name',{exact:true})).toHaveValue('Retain this draft');await page.getByRole('button',{name:'Help',exact:true}).click();await expect(help(page).locator('#help-getting-started-setup')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByLabel('Workspace name',{exact:true})).toHaveValue('Retain this draft');expect(observed.errors).toEqual([]);
 }finally{await f.close();}
});

test('locked Help retries failed documentation without opening research and returns to a working recovery form',async({page})=>{
 const f=await fixture('locked'),observed=watch(page);
 try{
  await page.goto(f.app.url);await expect(page.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible();
  await page.getByText('Use a recovery key',{exact:true}).click();await page.getByLabel('Recovery key',{exact:true}).fill(f.recovery);
  await page.route('**/locales/en/guide.json',route=>route.fulfill({status:503,body:'Unavailable'}));observed.requests.length=0;
  await page.getByRole('button',{name:'Help',exact:true}).click();await expect(help(page).getByRole('alert')).toContainText('could not be loaded');
  await page.unroute('**/locales/en/guide.json');await help(page).getByRole('button',{name:'Try again'}).click();await expect(help(page).locator('#help-storage-unlock')).toBeVisible();
  await expect(help(page)).not.toContainText('Private workspace canary');await page.keyboard.press('Control+s');
  await help(page).getByRole('button',{name:'Return to form'}).click();await expect(page.getByLabel('Recovery key',{exact:true})).toHaveValue(f.recovery);
  expect(observed.requests).toEqual([]);expect((await page.request.get(new URL('/api/notebook',f.app.url).href)).status()).toBe(401);
  await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText('Private workspace canary');
  expect(observed.errors).toEqual([]);
 }finally{await f.close();}
});

test('stable Help URLs work with legacy locked access and leave password entry available after closing',async({page})=>{
 const f=await fixture('legacy'),observed=watch(page);
 try{
  await page.goto(f.app.url);await expect(page.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible();observed.requests.length=0;
  await page.evaluate(()=>location.hash='#/preferences/help/storage/unlock');await expect(help(page).locator('#help-storage-unlock')).toBeVisible();
  expect(observed.requests).toEqual([]);await page.reload();await expect(help(page).locator('#help-storage-unlock')).toBeVisible();
  expect(observed.requests.every(r=>['/api/access/status','/api/language','/api/interface','/api/activity','/api/writer-recovery'].includes(r.path)&&r.method==='GET'&&r.body===null),JSON.stringify(observed.requests)).toBe(true);
  await help(page).getByRole('button',{name:'Return to form'}).click();await expect(page).not.toHaveURL(/preferences\/help/);
  await page.getByLabel('Password',{exact:true}).fill(f.password);await page.getByRole('button',{name:'Help',exact:true}).click();await page.keyboard.press('Escape');await expect(page.getByLabel('Password',{exact:true})).toHaveValue(f.password);
  expect(observed.errors).toEqual([]);
 }finally{await f.close();}
});

test('missing-workspace Help preserves the open-folder dialog and supports direct setup Help URLs',async({page})=>{
 const f=await fixture('missing'),observed=watch(page);
 try{
  await page.goto(f.app.url);await expect(page.getByRole('heading',{name:'Choose a workspace'})).toBeVisible();observed.requests.length=0;
  await page.getByRole('button',{name:'Help',exact:true}).click();await expect(help(page).locator('#help-storage-reconnect')).toBeVisible();await page.keyboard.press('Escape');expect(observed.requests).toEqual([]);
  await page.getByRole('button',{name:'Open workspace',exact:true}).click();const form=page.locator('#dialog');await expect(form).toBeVisible();await form.getByLabel('Workspace folder',{exact:true}).fill(f.root);await form.getByLabel('Workspace password (if protected)',{exact:true}).fill(f.password);
  await form.getByRole('button',{name:'Help',exact:true}).click();await expect(help(page)).toBeVisible();await page.keyboard.press('Escape');await expect(form).toBeVisible();await expect(form.getByLabel('Workspace folder',{exact:true})).toHaveValue(f.root);await expect(form.getByLabel('Workspace password (if protected)',{exact:true})).toHaveValue(f.password);
  await form.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('#leave-dialog').getByRole('button',{name:'Discard changes',exact:true}).click();
  await page.getByRole('button',{name:'New workspace',exact:true}).click();await page.evaluate(()=>location.hash='#/preferences/help/getting-started/setup');await expect(help(page).locator('#help-getting-started-setup')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('heading',{name:'Create a workspace',exact:true})).toBeVisible();
  expect(observed.errors).toEqual([]);
 }finally{await f.close();}
});

test('English access labels and Help instructions follow the same resource without modifying credentials',async({page},testInfo)=>{
 const f=await fixture('locked'),observed=watch(page);
 try{
  await page.route('**/locales/en/access.json',async route=>{
   const response=await route.fetch(),catalogue=await response.json();
   await route.fulfill({response,json:{...catalogue,unlock:'Open protected workspace',useRecovery:'Enter the recovery key'}});
  });
  await page.goto(f.app.url);await expect(page.getByRole('heading',{name:'Open protected workspace',exact:true})).toBeVisible();
  await page.getByLabel('Password',{exact:true}).fill(f.password);await page.getByRole('button',{name:'Help',exact:true}).click();
  await expect(help(page).locator('#help-reading')).toContainText('On Open protected workspace');await expect(help(page).locator('#help-reading')).toContainText('expand Enter the recovery key');
  await expect(help(page).locator('#help-reading')).not.toContainText('{ui:');await page.screenshot({path:testInfo.outputPath('english-access-help.png')});
  await help(page).getByRole('button',{name:'Return to form'}).click();await expect(page.getByLabel('Password',{exact:true})).toHaveValue(f.password);
  await page.getByRole('button',{name:'Open protected workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText('Private workspace canary');expect(observed.errors).toEqual([]);
 }finally{await f.close();}
});

test('English setup messages can change without changing form values or stable template identities',async({page})=>{
 const f=await fixture(),observed=watch(page);
 try{
  await page.route('**/locales/en/setup.json',async route=>{
   const response=await route.fetch(),catalogue=await response.json();
   await route.fulfill({response,json:{...catalogue,name:'Name this workspace',continue:'Next step',createTitle:'Start your workspace'}});
  });
  await page.goto(f.app.url);await page.getByLabel('Name this workspace',{exact:true}).fill('105₆ / 9007199254740993');await page.getByRole('button',{name:'Help',exact:true}).click();await expect(help(page).locator('#help-reading')).toContainText('Use Start your workspace');await page.keyboard.press('Escape');
  await expect(page.getByLabel('Name this workspace',{exact:true})).toHaveValue('105₆ / 9007199254740993');await page.getByRole('button',{name:'Next step',exact:true}).click();await page.getByRole('checkbox',{name:/^Computer/}).check();await expect(page.locator('input[value="laboratory-computer-it"]')).toBeChecked();
  await page.getByRole('button',{name:'Next step',exact:true}).click();await page.getByLabel('Use a password',{exact:false}).check();await page.getByLabel('Password',{exact:true}).fill(f.password);await page.getByLabel('Confirm password',{exact:true}).fill('Different synthetic password');await page.getByRole('button',{name:'Create workspace',exact:true}).click();await expect(page.getByRole('alert')).toHaveText('The passwords do not match.');
  expect(observed.errors).toEqual([]);
 }finally{await f.close();}
});

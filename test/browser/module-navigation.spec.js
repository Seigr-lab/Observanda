import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
import {navigate,preferences} from './preferences-helper.js';

async function fixture(){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-module-navigation-')),f=await encryptedFixture(directory,sampleNotebook());
 const settings=defaultDashboard();settings.enabledModules=['planning','scientific-calculator'];settings.views[0].panels=[];
 await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});
 return {directory,f,app};
}

test('untouched calendars and calculations navigate without draft writes or leave prompts during a workspace copy',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(12000);const {directory,f,app}=await fixture(),errors=[],writes=[];
 let release;const gate=new Promise(resolve=>release=resolve),verify=ResearchCatalogue.prototype.verifyRecordHistory;
 ResearchCatalogue.prototype.verifyRecordHistory=async function(...args){await gate;return verify.apply(this,args);};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/modules/drafts/write'))writes.push(r.postDataJSON());});
 try{
  await page.goto(app.url);await preferences(page,'General');
  await page.evaluate(async destination=>{const s=await(await fetch('/api/storage')).json();window.copying=fetch('/api/storage/copy',{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':s.contextId,Accept:'application/x-ndjson'},body:JSON.stringify({path:destination,confirmed:true})}).then(r=>r.text());},path.join(directory,'copy'));
  await expect(page.locator('.app-activity [data-toggle]')).toContainText('1 running');
  await navigate(page,'Scientific calculator');await page.getByRole('button',{name:'New calculation',exact:true}).click();
  await expect(page.getByLabel('Name',{exact:true})).toHaveValue('');
  await navigate(page,'Calendar & planning');await expect(page.locator('#leave-dialog')).not.toBeVisible();
  const main=page.locator('main');await main.getByRole('button',{name:'Subscribe',exact:true}).click();
  await expect(main.getByLabel('Calendar subscription URL',{exact:true})).toBeVisible();
  for(const name of ['Events','Connected workspaces','Tasks','Equipment agenda','Calendars','Subscriptions']){
   await main.locator('.module-tabs').getByRole('button',{name,exact:true}).click();await expect(main.locator('h1')).toHaveText(name==='Calendars'?'Calendar':name);
  }
  await main.getByRole('button',{name:'New subscription',exact:true}).click();await expect(main.getByLabel('Name',{exact:true})).toHaveValue('');
  await main.getByLabel('Name',{exact:true}).fill('Temporary');await main.getByLabel('Name',{exact:true}).fill('');
  await navigate(page,'Preferences');await expect(page.locator('#leave-dialog')).not.toBeVisible();
  await expect.poll(async()=>page.evaluate(async()=>(await(await fetch('/api/activity')).json()).operations.map(o=>o.kind))).toEqual(['/api/storage/copy']);
  expect(writes).toEqual([]);expect(errors).toEqual([]);
 }finally{release();ResearchCatalogue.prototype.verifyRecordHistory=verify;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('a real module draft stays editable while its checkpoint waits and a discarded draft cannot trap navigation',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(12000);const {directory,f,app}=await fixture(),errors=[];
 let release;const gate=new Promise(resolve=>release=resolve);let waiting;
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);await navigate(page,'Calendar & planning');
  await page.getByRole('button',{name:'Subscribe',exact:true}).click();
  const began=new Promise(resolve=>waiting=resolve);
  await page.route('**/api/modules/drafts/write',async route=>{waiting();await gate;await route.continue().catch(()=>{});});
  await page.getByLabel('Name',{exact:true}).fill('Retained subscription');await began;
  await page.locator('.module-tabs').getByRole('button',{name:'Events',exact:true}).click();await expect(page.locator('main h1')).toHaveText('Events');
  await page.locator('.module-drafts').getByRole('button',{name:'Retained subscription',exact:true}).click();
  await expect(page.getByLabel('Name',{exact:true})).toHaveValue('Retained subscription');await expect(page.getByLabel('Name',{exact:true})).toBeEditable();
  await navigate(page,'Preferences');const dialog=page.locator('#leave-dialog');await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Discard changes',exact:true}).click();await expect(dialog.getByRole('button',{name:'Stay here',exact:true})).toBeEnabled();
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
  await navigate(page,'Preferences');await expect(page.locator('.preferences-heading')).toBeVisible();
  release();await expect(page.locator('#leave-dialog')).not.toBeVisible();await expect.poll(()=>page.evaluate(()=>location.hash)).toContain('/preferences');
  expect(errors).toEqual([]);
 }finally{release();await page.unrouteAll({behavior:'ignoreErrors'});await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

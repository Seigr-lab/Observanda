import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {rememberLocation} from '../../src/preferences.js';
import {clearVault} from '../../src/encryption.js';
import {navigate,preferences} from './preferences-helper.js';

test('workspace management is a routed page with back, reload and setup access while research is busy',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-workspaces-page-')),f=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'}),prefs=path.join(directory,'preferences.json');
 await rememberLocation(prefs,f.workspace.root);
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:prefs}),errors=[],writes=[];
 let release,holding;
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.includes('/api/notebook'))writes.push(r.url());});
 try{
  await page.goto(app.url);await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  const before=await f.workspace.read();let started;const ready=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
  holding=f.workspace.withLock(async()=>{started();await gate;});await ready;
  await navigate(page,'Workspaces');const management=page.locator('.workspace-management');
  await expect(page).toHaveURL(/#\/workspaces$/);await expect(management.getByRole('heading',{name:'Workspaces',exact:true})).toBeVisible();
  await expect(management.getByText(f.workspace.root,{exact:true})).toBeVisible();await expect(page.locator('#dialog')).not.toBeVisible();
  await expect(page.locator('[data-action="storage-workspaces"]')).toHaveAttribute('aria-current','page');
  await navigate(page,'Dashboard');await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();await page.goBack();await expect(management.getByText(f.workspace.root,{exact:true})).toBeVisible();
  await page.reload();await expect(management.getByText(f.workspace.root,{exact:true})).toBeVisible();await expect(page.locator('#dialog')).not.toBeVisible();
  release();await holding;holding=null;
  await preferences(page,'General');await page.getByLabel('Workspace introduction',{exact:true}).fill('Unsubmitted workspace introduction');
  await navigate(page,'Workspaces');const guard=page.locator('#leave-dialog');await expect(guard).toBeVisible();await guard.getByRole('button',{name:'Stay here',exact:true}).click();await expect(page.getByLabel('Workspace introduction',{exact:true})).toHaveValue('Unsubmitted workspace introduction');
  await navigate(page,'Workspaces');await guard.getByRole('button',{name:'Discard changes',exact:true}).click();await expect(management.getByText(f.workspace.root,{exact:true})).toBeVisible();await expect(guard).not.toBeVisible();
  await page.route('**/api/workspaces',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'INTERNAL',message:'Synthetic directory failure'}})}),{times:1});
  await navigate(page,'Dashboard');await navigate(page,'Workspaces');await expect(management.getByRole('alert')).toContainText('Workspaces could not be loaded.');await management.getByRole('button',{name:'Retry',exact:true}).click();await expect(management.getByText(f.workspace.root,{exact:true})).toBeVisible();
  await management.getByRole('button',{name:'Open existing workspace',exact:true}).click();await expect(page.locator('#storage-open-form')).toBeVisible();await page.locator('#dialog').getByRole('button',{name:'Cancel',exact:true}).click();
  await management.getByRole('button',{name:'New workspace',exact:true}).click();await expect(page.locator('#create-form')).toBeVisible();await page.getByRole('button',{name:'Cancel new workspace',exact:true}).click();await expect(management).toBeVisible();
  await page.setViewportSize({width:390,height:844});await expect(management.getByRole('button',{name:'New workspace',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:test.info().outputPath('workspace-management-mobile.png'),fullPage:true});
  expect(await f.workspace.read()).toEqual(before);expect(writes).toEqual([]);expect(errors).toEqual([]);
 }finally{release?.();await holding;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

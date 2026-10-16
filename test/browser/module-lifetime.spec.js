import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
import {navigate,preferences} from './preferences-helper.js';

test('a slow calculator open leaves the current preferences page and its input intact',async({page})=>{
 test.setTimeout(120000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-module-lifetime-')),f=await encryptedFixture(directory,sampleNotebook()),errors=[];let app,release,held=false;
 const gate=new Promise(resolve=>release=resolve);
 try{
  const settings=defaultDashboard();settings.enabledModules=['scientific-calculator'];settings.views[0].panels=[];await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
  app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(app.url);await preferences(page,'General');const originalName=await page.getByLabel('Workspace name',{exact:true}).inputValue();await page.evaluate(()=>window.lifetimeDocument='unchanged');
  // Observe the real initializer settling; a network response can precede its
  // completion and is not a reliable witness for the navigation assertion.
  await page.evaluate(async()=>{const {FEATURE_MODULES}=await import('/feature-modules.js'),module=FEATURE_MODULES.find(m=>m.id==='scientific-calculator'),create=module.createUI;module.createUI=async services=>{try{return await create(services);}finally{module.createUI=create;window.lifetimeInitializerSettled=true;}};});
  await page.route('**/api/modules/items',async route=>{const result=await route.fetch();held=true;await gate;await route.fulfill({response:result});});
  await navigate(page,'Scientific calculator');await expect.poll(()=>held).toBe(true);
  await navigate(page,'Dashboard');await navigate(page,'Preferences');await page.getByLabel('Workspace name',{exact:true}).fill('Retained preference input');
  release();await page.unrouteAll({behavior:'wait'});await page.waitForFunction(()=>window.lifetimeInitializerSettled===true,{},{timeout:15000});
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  await expect(page.locator('.preferences-heading')).toBeVisible();await expect(page.getByLabel('Workspace name',{exact:true})).toHaveValue('Retained preference input');expect(await page.evaluate(()=>window.lifetimeDocument)).toBe('unchanged');
  await page.getByLabel('Workspace name',{exact:true}).fill(originalName);
  await navigate(page,'Scientific calculator');await expect(page.locator('[data-module-items-status]')).toContainText('No matching');await page.getByRole('button',{name:'New calculation',exact:true}).click();await expect(page.getByLabel('Name',{exact:true})).toBeEditable();expect(errors).toEqual([]);
 }finally{release();if(!page.isClosed())await page.unrouteAll({behavior:'ignoreErrors'});await page.close();await app?.close();clearVault(f.vault);if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-module-lifetime-'))throw Error('Unexpected fixture root');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

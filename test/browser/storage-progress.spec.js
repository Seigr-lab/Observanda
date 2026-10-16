import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {updateWorkspaceAccess,workspaceAccess} from '../../src/security/workspace-access.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {preferences} from './preferences-helper.js';

test('portable copy exposes measured verification progress inline and completes without changing the active workspace',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-progress-ui-')),f=await encryptedFixture(directory,sampleNotebook()),destination=path.join(directory,'portable');
 const access=await workspaceAccess(f.workspace.root,f.vault),kit=await updateWorkspaceAccess(f.workspace.root,f.vault,{action:'recovery',etag:access.etag,confirmed:true});
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});
 let release;const gate=new Promise(resolve=>{release=resolve;}),verify=ResearchCatalogue.prototype.verifyRecordHistory;
 ResearchCatalogue.prototype.verifyRecordHistory=async function(...args){await gate;return verify.apply(this,args);};
 try{
  await page.goto(app.url);await preferences(page,'Storage & access');await page.getByRole('button',{name:'Create portable workspace copy',exact:true}).click();const dialog=page.locator('#dialog');
  await dialog.getByLabel('Workspace folder',{exact:true}).fill(destination);await dialog.getByText('Use a recovery key',{exact:true}).click();await dialog.getByLabel('Recovery key',{exact:true}).fill(kit.recovery);
  await dialog.getByRole('button',{name:'Create verified portable copy',exact:true}).click();
  const progress=dialog.getByRole('region',{name:'Operation progress'});
  await expect(progress.getByRole('heading',{name:'Verifying record history'})).toBeVisible();
  expect(await page.evaluate(()=>fetch('/api/activity').then(response=>response.json()).then(activity=>activity.busy))).toBe(true);
  await expect(progress.locator('[data-detail]')).toContainText('0 of');
  await expect(progress.locator('[data-count]')).toContainText('Files copied and checked');await expect(progress.locator('[data-work]')).toContainText('Data copied');
  await expect(progress).not.toContainText('Stored objects');await expect(progress).not.toContainText(kit.recovery);
  await expect(dialog.locator('button[type="submit"]')).toBeDisabled();
  await page.setViewportSize({width:760,height:900});await page.evaluate(()=>document.documentElement.style.fontSize='24px');
  expect(await progress.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await progress.locator('[data-wait]').scrollIntoViewIfNeeded();await expect(progress.locator('[data-wait]')).toBeInViewport();await page.screenshot({path:'.local/storage-progress.png'});
  release();await expect(dialog.getByRole('heading',{name:'Portable copy ready'})).toBeVisible();await expect(progress).toHaveCount(0);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(page.locator('.storage-path').first()).toHaveText(f.workspace.root);
 }finally{release();ResearchCatalogue.prototype.verifyRecordHistory=verify;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

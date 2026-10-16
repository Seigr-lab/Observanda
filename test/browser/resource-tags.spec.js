import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
import {testServer} from '../device-fixture.js';

test('resource tag authoring, exact all/any filters, editing and narrow-screen focus work in the app',async({page})=>{
 test.setTimeout(60000);
 const dir=await mkdtemp(path.join(os.tmpdir(),'observanda-resource-tags-ui-')),f=await encryptedFixture(dir,sampleNotebook()),preferencesFile=path.join(dir,'preferences.json'),settings=defaultDashboard();settings.enabledModules=['resources'];await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,preferencesFile,port:0,headless:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));const main=page.locator('main');
 try{
  await page.goto(app.url);await page.evaluate(()=>location.hash='#/modules/resources/resource');
  for(const [name,tags]of [['Soldering iron','PCB, hot, '+'T'.repeat(80)],['Logic analyser','PCB, measurement'],['Field notebook','field work']]){
   await main.getByRole('button',{name:'New item',exact:true}).click();await main.getByLabel('Item name',{exact:true}).fill(name);await main.getByLabel('Resource tags',{exact:true}).fill(tags);await main.getByRole('button',{name:'Save item',exact:true}).click();await expect(main.getByRole('heading',{name:'Placement',exact:true})).toBeVisible();await main.getByRole('button',{name:'Details',exact:true}).click();await expect(main.locator('[data-module-status]')).toHaveText('Saved');await main.getByRole('button',{name:'Back to items',exact:true}).click();
  }
  const cards=main.locator('.module-item'),filter=main.getByLabel('Filter by resource tags',{exact:true});await expect(cards).toHaveCount(3);
  await filter.fill('pcb');await expect(cards).toHaveCount(2);await expect(filter).toBeFocused();await expect(cards.first().locator('.resource-tags')).toContainText('PCB');
  await filter.fill('pcb, measurement');await expect(cards).toHaveCount(1);await expect(cards).toContainText('Logic analyser');await main.getByLabel('Tag matching',{exact:true}).selectOption('any');await expect(cards).toHaveCount(2);
  await filter.fill('PC');await expect(cards).toHaveCount(0);await filter.fill('field work');await expect(cards).toHaveCount(1);await main.getByRole('button',{name:'Open item',exact:true}).click();await main.getByRole('button',{name:'Details',exact:true}).click();await expect(main.getByLabel('Resource tags',{exact:true})).toHaveValue('field work');await main.getByLabel('Resource tags',{exact:true}).fill('field work, observations');await main.getByRole('button',{name:'Save item',exact:true}).click();await expect(main.locator('[data-module-status]')).toHaveText('Saved');await page.reload();await main.getByRole('button',{name:'Details',exact:true}).click();await expect(main.getByLabel('Resource tags',{exact:true})).toHaveValue('field work, observations');await main.getByRole('button',{name:'Back to items',exact:true}).click();
  await page.setViewportSize({width:390,height:844});await filter.fill('hot');await expect(cards).toHaveCount(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(dir,{recursive:true,force:true});}
});

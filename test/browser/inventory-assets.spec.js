import {test,expect} from '@playwright/test';
import {workDirectory} from '../../scripts/work-directory.js';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './encrypted-fixture.js';
import {createNotebook} from '../../src/model.js';
import {ModuleReader} from '../../src/modules/reader.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
import {startServer} from '../../src/server.js';

// The workbench's back button names the list it returns to ("Back to Items").
test('individual equipment and software use dedicated inventory forms and placement history',async({page})=>{
 const directory=await mkdtemp(path.join(await workDirectory('test-work'),'inventory-assets-')),book=createNotebook('Creative collective'),studio=randomUUID();
 book.projects.push({id:studio,title:'Studio',parentId:null,kind:'Team',description:'',share:false,logoId:null,tools:['resources']});
 const {workspace,deviceStore}=await encryptedFixture(directory,book);
 const settings=defaultDashboard(),preferencesFile=path.join(directory,'preferences.json');settings.enabledModules.push('resources');
 await writeWorkspaceDashboard(workspace,settings,(await readWorkspaceDashboard(workspace)).etag);
 const app=await startServer({root:workspace.root,port:0,preferencesFile,deviceStore}),main=page.locator('#main'),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);await page.locator('#main-navigation [data-module-nav="resources"]').getByRole('button',{name:'Inventory',exact:true}).click();
  await main.getByRole('button',{name:'New item',exact:true}).click();
  await main.getByLabel('Item name',{exact:true}).fill('Guitar');
  await main.getByLabel('Item kind',{exact:true}).selectOption('equipment');
  await main.getByLabel('Storage place',{exact:true}).fill('Instrument rack');
  await main.getByRole('button',{name:'Save item',exact:true}).click();
  await expect(main.getByRole('heading',{name:'Placement',exact:true})).toBeVisible();
  await main.getByRole('button',{name:'Move item',exact:true}).click();
  await main.getByLabel('To',{exact:true}).selectOption(studio);
  await main.getByLabel('Reason / reference').fill('Studio recording');
  await main.getByRole('button',{name:'Move item',exact:true}).click();
  await expect(main.getByRole('heading',{name:'Placement history',exact:true})).toBeVisible();
  await expect(main.locator('.module-ledger')).toContainText('Studio recording');
  await main.getByRole('button',{name:'Back to Items',exact:true}).click();
  await main.getByRole('button',{name:'New item',exact:true}).click();
  await main.getByLabel('Item name',{exact:true}).fill('Audio software');
  await main.getByLabel('Item kind',{exact:true}).selectOption('software');
  await expect(main.getByLabel('Stock unit',{exact:true})).toHaveValue('licences');
  await main.getByLabel('Opening quantity',{exact:true}).fill('3');
  await main.getByLabel('Initially held at',{exact:true}).selectOption(studio);
  await page.evaluate(()=>window.scrollTo(0,0));
  if(await page.locator('#notice').isVisible())await page.locator('#notice').getByRole('button',{name:'Dismiss'}).click();
  await page.screenshot({path:path.join(directory,'software-entry.png'),fullPage:true});
  await main.getByRole('button',{name:'Save item',exact:true}).click();
  await expect(main.getByRole('table',{name:'Where this stock is held'}).getByRole('row').filter({hasText:'Studio'})).toContainText('3');
  await main.getByRole('button',{name:'Back to Items',exact:true}).click();
  await main.getByLabel('Inventory location').selectOption(studio);
  await expect(main.getByRole('heading',{name:'Guitar',exact:true})).toBeVisible();
  await expect(main.getByRole('heading',{name:'Audio software',exact:true})).toBeVisible();
  await page.evaluate(()=>window.scrollTo(0,0));
  if(await page.locator('#notice').isVisible())await page.locator('#notice').getByRole('button',{name:'Dismiss'}).click();
  await page.screenshot({path:path.join(directory,'studio-items.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.scrollTo(0,0));
  if(await page.locator('#notice').isVisible())await page.locator('#notice').getByRole('button',{name:'Dismiss'}).click();
  await page.screenshot({path:path.join(directory,'studio-items-mobile.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  // Current workspaces are read one item at a time, never as one module document.
  const reader=new ModuleReader(workspace),items=(await reader.list({workspaceId:book.id,type:'resource'})).items.filter(item=>item.title==='Guitar');
  expect(items).toHaveLength(1);const guitar=(await reader.selected({workspaceId:book.id,id:items[0].id})).entity;
  expect(guitar.data.projectId).toBe(null);expect(guitar.data.placementId).toBe(studio);
  expect((await workspace.read()).book.entries).toHaveLength(0);expect(errors).toEqual([]);
 }finally{await app.close();}
});

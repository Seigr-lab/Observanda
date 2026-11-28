import {test,expect} from '@playwright/test';
import {pagePanel} from './website-page-panel-helper.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {siteMenu} from './website-site-menu-helper.js';

test('a desktop author selects nested writing, saves it and navigates the saved site tools',async({page})=>{
 test.setTimeout(100000);page.setDefaultTimeout(12000);await page.setViewportSize({width:1440,height:900});
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-author-chrome-')),previous=process.env.OBSERVANDA_DATABASE_URL;
 let fixture,app;
 try{
  const book=sampleNotebook();book.entries=[];fixture=await encryptedFixture(directory,book);
  const store=new WebsiteFileStore(fixture.workspace),id=randomUUID();
  const html='<!doctype html><html lang="en"><head><title>Assay methods</title><link rel="stylesheet" href="style.css"></head><body><header>River ecology laboratory</header><main><h1>Assay methods</h1><section><h2>Fluorescence survey</h2><article><h3>Calibration protocol</h3><p>Log the instrument serial number.</p></article></section></main></body></html>';
  const css='body{margin:0;color:#163e39;background:#f7f8f2;font:17px/1.55 system-ui}header{padding:14px 28px;color:white;background:#195749;font-weight:650}main{padding:18px 28px}h1,h2,h3{margin:.3em 0}h1{font:600 2.2em Georgia,serif}article{background:white;border:1px solid #c4d4c8;border-radius:6px;padding:14px 22px;margin-top:12px}';
  await store.importFiles(id,{name:'River ecology atlas',files:new Map([['index.html',html],['style.css',css]])});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
  await page.goto(app.origin+'/?view=website#'+app.launchToken);
  const canvas=page.frameLocator('#website-files-canvas'),label='Log the instrument serial number.',paragraph=canvas.getByText(label,{exact:true}),tools=page.getByRole('complementary',{name:'Site tools',exact:true});
  await expect(paragraph).toBeVisible();
  const finder=page.getByRole('button',{name:'Find pages and tools'});await finder.click();
  const search=page.getByRole('combobox',{name:'Search by name or path'});await search.fill('Themes');await expect(page.getByRole('option',{name:'Themes',exact:true})).toBeVisible();await search.press('Escape');
  await expect(search).toHaveCount(0);await expect(finder).toBeFocused();
  await pagePanel(page,'Layers');const filter=page.getByRole('searchbox',{name:'Filter page layers'});await filter.fill(label);
  await page.locator('[data-website-files-structure]').getByRole('button',{name:label,exact:true}).click();await filter.fill('');
  const trail=page.getByRole('navigation',{name:'Selected element path'});await expect(trail.locator('[aria-current]')).toHaveText(label);
  await trail.getByRole('button',{name:'Select parent: Calibration protocol',exact:true}).click();
  await expect(trail.locator('[aria-current]')).toHaveText('Calibration protocol');
  await paragraph.click();await page.keyboard.press('End');await page.keyboard.type(' Check the reference slide.');
  await expect(canvas.locator('article p')).toHaveText(label+' Check the reference slide.');
  const save=page.getByRole('button',{name:'Save website',exact:true});await expect(save).toBeEnabled();await save.click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  expect((await store.open(id)).html).toContain('Check the reference slide.');
  await expect(tools.getByRole('button',{name:'Themes',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Publish',exact:true})).toBeVisible();
  // Less frequent tasks wait in one menu, which Escape closes.
  const menu=await siteMenu(page);await expect(menu.getByRole('button',{name:'Manage website',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(menu.getByRole('button',{name:'Manage website',exact:true})).toBeHidden();await expect(menu.locator('summary')).toBeFocused();
  for(const width of [1148,1440]){
   await page.setViewportSize({width,height:width===1148?759:900});
   await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
   const frame=await page.locator('#website-files-canvas').boundingBox();expect(frame.height).toBeGreaterThan(300);
   await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollHeight-document.documentElement.clientHeight)).toBeLessThanOrEqual(1);
  }
  if(process.env.OBSERVANDA_WORKSPACE_SCREENSHOT)await page.screenshot({path:process.env.OBSERVANDA_WORKSPACE_SCREENSHOT});
  // Either side collapses to a slim strip and the page takes the room; selecting a part leaves the properties collapsed.
  const edited=canvas.locator('article p');const frameWidth=async()=>(await page.locator('#website-files-canvas').boundingBox()).width,wide=await frameWidth();
  await tools.getByRole('button',{name:'Collapse site tools',exact:true}).click();await page.getByRole('button',{name:'Collapse appearance',exact:true}).click();
  await expect.poll(frameWidth).toBeGreaterThan(wide+300);
  await edited.click();await expect(page.locator('.website-files-inspection')).toHaveAttribute('data-collapsed','');
  // Both choices are remembered; a picture in the strip expands the sidebar with its section open, and Edit section opens the properties.
  await page.reload();await expect(edited).toBeVisible();await expect(tools.getByRole('button',{name:'Expand site tools',exact:true})).toBeVisible();
  await tools.getByRole('button',{name:'Layers',exact:true}).click();await expect(tools.getByRole('button',{name:'Layers',exact:true})).toHaveAttribute('aria-expanded','true');
  await edited.click();await canvas.getByRole('button',{name:'Edit section',exact:true}).click();await expect(page.getByRole('button',{name:'Collapse appearance',exact:true})).toBeVisible();
  await tools.getByRole('button',{name:'Website menu',exact:true}).click();
  await expect(page.locator('.website-workspace-identity')).toContainText('Website menu');await expect(save).toHaveCount(0);
  // A docked tool fits its panel: nothing scrolls sideways or runs past its edge.
  const fits=()=>page.evaluate(()=>{const dock=document.querySelector('.website-files-dock'),edge=dock.getBoundingClientRect().right+1;return dock.scrollWidth<=dock.clientWidth+1&&[...dock.querySelectorAll('*')].every(el=>el.getBoundingClientRect().right<=edge);});
  await expect.poll(fits).toBe(true);
  await page.locator('[data-action="website-files-menu-cancel"]').click();
  await page.getByRole('button',{name:'Preview saved website',exact:true}).click();
  await expect(page.frameLocator('#website-files-preview').getByText(/Check the reference slide\./)).toBeVisible();
 }finally{
  if(previous===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=previous;
  try{await page.close();await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
 }
});

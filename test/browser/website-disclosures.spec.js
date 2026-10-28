import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createNotebook} from '../../src/model.js';
import {WebsiteSites} from '../../src/website-sites.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {startServer} from '../../src/server.js';
import {navigate} from './preferences-helper.js';
import {task} from './composer-helper.js';
const canvas=page=>page.frameLocator('#website-draft-preview');

test('expandable sections support nested authoring, undo, duplication and no-script visitor interaction',async({page,browser},info)=>{
 test.setTimeout(90000);page.setDefaultTimeout(15000);
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-disclosures-')),fixture=await encryptedFixture(root,createNotebook('Research studio',''));
 const app=await startServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile:path.join(root,'preferences.json')}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);await navigate(page,'Website editor');await page.getByRole('button',{name:'Add page',exact:true}).click();await page.getByLabel('Page title',{exact:true}).fill('Development overview');const target=await page.getByLabel('Page',{exact:true}).inputValue();await task(page,'Page');
  await page.locator('[data-palette-kind=disclosure]').click();await canvas(page).locator('.section-disclosure>.canvas-section-edit').click();await page.getByLabel('Section heading',{exact:true}).fill('State of the work');await expect(page.getByLabel('Start expanded for visitors',{exact:true})).not.toBeChecked();await task(page,'Page');
  await page.locator('[data-palette-kind=heading]').click();await canvas(page).locator('.section-disclosure .section-heading>.canvas-section-edit').click();await page.getByLabel('Section heading',{exact:true}).fill('Observed behaviour');await task(page,'Page');
  await page.locator('[data-palette-kind=text]').click();await canvas(page).locator('.section-disclosure .section-text>.canvas-section-edit').click();await canvas(page).getByRole('textbox',{name:'Section text',exact:true}).fill('Measurements and limitations remain available inside the expandable section.');await task(page,'Page');
  await page.locator('#website-outline [data-element-drag]').last().focus();await page.keyboard.press('ArrowLeft');await expect(canvas(page).locator('main>[data-composition]>.section-text')).toHaveCount(1);await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(canvas(page).locator('.section-disclosure .section-text')).toHaveCount(1);
  await canvas(page).locator('.section-disclosure>.canvas-section-edit').click();await page.getByRole('button',{name:'Duplicate',exact:true}).click();await expect(canvas(page).locator('.section-disclosure')).toHaveCount(2);await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(canvas(page).locator('.section-disclosure')).toHaveCount(1);
  await page.getByLabel('Start expanded for visitors',{exact:true}).check();await page.getByLabel('Start expanded for visitors',{exact:true}).uncheck();await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();await expect(canvas(page).locator('.section-disclosure .section-text')).toBeVisible();
  await page.getByRole('button',{name:'Prepare edition',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible({timeout:30000});await page.getByLabel('Preview page',{exact:true}).selectOption(target);
  const href=await page.locator('#full-public-preview').getAttribute('href'),context=await browser.newContext({javaScriptEnabled:false});await context.addCookies(await page.context().cookies());const visitor=await context.newPage();
  try{await visitor.goto(new URL(href,app.origin).href);const group=visitor.locator('.section-disclosure-content');await expect(group.locator('.section-text')).toBeHidden();await group.locator('summary').focus();await visitor.keyboard.press('Enter');await expect(group.locator('.section-text')).toBeVisible();await visitor.keyboard.press('Space');await expect(group.locator('.section-text')).toBeHidden();
   await visitor.setViewportSize({width:390,height:844});await group.locator('summary').click();await expect(group.getByRole('heading',{name:'Observed behaviour',exact:true})).toBeVisible();expect(await visitor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await visitor.screenshot({path:info.outputPath('expandable-content-mobile.png'),fullPage:true});
  }finally{await context.close();}
  const saved=(await new WebsiteSites(fixture.workspace).read(null)).book.pages.find(p=>'pages/'+p.id+'.html'===target);expect(saved.sections.filter(s=>s.parentId===saved.sections[0].id)).toHaveLength(2);expect(saved.sections[0].open).toBe(false);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(fixture.vault);await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

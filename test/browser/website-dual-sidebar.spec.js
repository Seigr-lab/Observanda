import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {navigate} from './preferences-helper.js';
import {task} from './composer-helper.js';
const canvas=page=>page.frameLocator('#website-draft-preview');
const area=async(page,slot)=>{await task(page,'Page');await page.getByLabel('Editing area',{exact:true}).selectOption(slot);};
const details=async(page,name)=>{const panel=page.locator('[data-region-panel="'+name+'"]');if(!await panel.evaluate(el=>el.open))await panel.locator('summary').click();};

test('author independent chapter and page indexes, reuse them and navigate the static edition on desktop and mobile',async({page,browser},info)=>{
 test.setTimeout(120000);
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-dual-sidebar-')),f=await encryptedFixture(root,sampleNotebook()),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(root,'preferences.json')}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);await navigate(page,'Website editor');await page.getByRole('button',{name:'Add page',exact:true}).click();await page.getByLabel('Page title',{exact:true}).fill('Concepts and relations');const target=await page.getByLabel('Page',{exact:true}).inputValue();
  await area(page,'body');await page.locator('[data-palette-kind=heading]').click();await canvas(page).locator('main .canvas-section-edit').click();await page.getByLabel('Section heading',{exact:true}).fill('How the pieces connect');
  await area(page,'sidebar');await page.getByRole('button',{name:'Create sidebar',exact:true}).click();await page.getByLabel('Design name',{exact:true}).fill('Private chapter design');
  await details(page,'reuse');await page.getByLabel('Use as site default',{exact:true}).check();await details(page,'appearance');await page.getByLabel('Background',{exact:true}).fill('#e8ece0');await page.getByLabel('Sidebar on narrow screens',{exact:true}).selectOption('collapsed');await page.getByLabel('Sidebar navigation label',{exact:true}).fill('Notebook navigation');
  await page.locator('[data-palette-kind=link]').click();await canvas(page).locator('[data-composition=sidebar] .canvas-section-edit').click();await page.getByLabel('Link label',{exact:true}).fill('Concepts');await page.getByLabel('Link destination',{exact:true}).fill('page:'+target.split('/')[1].slice(0,-5));
  await area(page,'secondary-sidebar');await page.getByRole('button',{name:'Create sidebar',exact:true}).click();await page.getByLabel('Design name',{exact:true}).fill('Private contents design');await details(page,'reuse');await page.getByLabel('Use as site default',{exact:true}).check();await details(page,'appearance');await expect(page.getByLabel('Sidebar position',{exact:true})).toHaveValue('right');await page.getByLabel('Sidebar width (px)',{exact:true}).fill('220');await page.getByLabel('Sidebar on narrow screens',{exact:true}).selectOption('collapsed');await page.getByLabel('Sidebar navigation label',{exact:true}).fill('On this page');
  await page.locator('[data-palette-kind=contents]').click();await expect(canvas(page).locator('[data-composition="secondary-sidebar"] a')).toHaveText(['How the pieces connect']);
  await expect(canvas(page).locator('[data-region-kind=sidebar]')).toHaveCSS('background-color','rgb(232, 236, 224)');await expect(canvas(page).locator('[data-region-kind="secondary-sidebar"]')).not.toHaveCSS('background-color','rgb(232, 236, 224)');
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();await expect(page.getByLabel('Editing area',{exact:true})).toHaveValue('secondary-sidebar');await expect(canvas(page).locator('.site-sidebar')).toHaveCount(2);
  await page.getByRole('button',{name:'Preview & export',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible();await page.getByLabel('Preview page',{exact:true}).selectOption(target);
  const href=await page.locator('#full-public-preview').getAttribute('href'),visitorContext=await browser.newContext({javaScriptEnabled:false,viewport:{width:1440,height:1000}});await visitorContext.addCookies(await page.context().cookies());const visitor=await visitorContext.newPage();
  try{
   await visitor.goto(new URL(href,app.origin).href);const left=visitor.locator('[data-region-kind=sidebar]'),right=visitor.locator('[data-region-kind="secondary-sidebar"]'),main=visitor.locator('main');
   await expect(left.getByRole('link',{name:'Concepts',exact:false})).toBeVisible();await expect(right.getByRole('link',{name:'How the pieces connect',exact:true})).toBeVisible();
   const l=await left.boundingBox(),r=await right.boundingBox(),m=await main.boundingBox();expect(l.x+l.width).toBeLessThanOrEqual(m.x);expect(m.x+m.width).toBeLessThanOrEqual(r.x);await expect(visitor.locator('body')).not.toContainText('Private contents design');await visitor.screenshot({path:info.outputPath('chapter-and-contents-desktop.png'),fullPage:true});
   await visitor.setViewportSize({width:390,height:844});await expect(left.locator('a')).toBeHidden();await expect(right.locator('a')).toBeHidden();await right.locator('summary').focus();await visitor.keyboard.press('Enter');await expect(right.locator('a')).toBeVisible();await right.locator('a').click();expect(new URL(visitor.url()).hash).toMatch(/^#section-/);await expect(main.getByRole('heading',{name:'How the pieces connect',exact:true})).toBeInViewport();
   await left.locator('summary').click();await expect(left.locator('a')).toBeVisible();await visitor.evaluate(()=>document.documentElement.style.fontSize='24px');expect(await visitor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await visitor.screenshot({path:info.outputPath('chapter-and-contents-mobile.png'),fullPage:true});
  }finally{await visitorContext.close();}
  expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

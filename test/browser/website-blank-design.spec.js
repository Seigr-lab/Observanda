import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {navigate} from './preferences-helper.js';
import {task,editorTab,openPageSettings,chooseWebsitePage} from './composer-helper.js';
const canvas=page=>page.frameLocator('#website-draft-preview');

test('blank identity, optional headers and authored navigation remain blank through preview, save and publication',async({page,browser},testInfo)=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-blank-site-')),book=sampleNotebook();book.website.home.enabled=false;book.projects[0].share=false;
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await navigate(page,'Website editor');await chooseWebsitePage(page,'projects/'+book.projects[0].id+'.html');
  await task(page,'Site');await page.getByLabel('Website title',{exact:true}).fill('');
  await openPageSettings(page);await page.getByText('Page header',{exact:true}).click();await page.getByLabel('Show page header',{exact:true}).uncheck();
  await expect(canvas(page).locator('.site-header')).toHaveCount(0);await expect(canvas(page).locator('.site-name')).toHaveCount(0);
  await page.getByLabel('Section placement',{exact:true}).selectOption('replace');await expect(canvas(page).locator('#page-notebooks,#page-records')).toHaveCount(0);
  await editorTab(page,'Navigation');await expect(page.getByLabel('Show '+book.projects[0].title+' in menu',{exact:true})).toBeEnabled();await page.getByRole('button',{name:'Hide all menu links',exact:true}).click();await expect(canvas(page).locator('.site-top')).toHaveCount(0);
  await page.getByRole('button',{name:'Add page',exact:true}).click();await page.getByLabel('Page title',{exact:true}).fill('Insect Reserve');const target=await page.getByLabel('Page',{exact:true}).inputValue();
  await page.getByText('Page header',{exact:true}).click();await page.getByLabel('Show page header',{exact:true}).uncheck();await expect(canvas(page).locator('.site-header')).toHaveCount(0);
  await task(page,'Page');await page.getByLabel('Editing area',{exact:true}).selectOption('sidebar');await page.getByRole('button',{name:'Create sidebar',exact:true}).click();await expect(canvas(page).locator('.site-sidebar')).toBeVisible();await expect(canvas(page).locator('.site-sidebar a')).toHaveCount(0);
  await page.locator('[data-palette-kind=link]').click();await canvas(page).locator('.site-sidebar .canvas-section-edit').click();await page.getByLabel('Link label',{exact:true}).fill('Explore the reserve');await page.getByLabel('Link destination',{exact:true}).fill('page:'+target.split('/')[1].slice(0,-5));
  await expect(canvas(page).locator('.site-sidebar a')).toHaveText('Explore the reserve');
  await task(page,'Page');await page.getByLabel('Editing area',{exact:true}).selectOption('body');await page.locator('[data-palette-kind=heading]').click();await canvas(page).locator('main .canvas-section-edit').click();await page.getByLabel('Section heading',{exact:true}).fill('A place for life');
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();await expect(canvas(page).locator('.site-header,.site-name')).toHaveCount(0);await expect(canvas(page).locator('main')).toContainText('A place for life');
  await page.screenshot({path:testInfo.outputPath('blank-authored-editor.png')});
  await editorTab(page,'Navigation');await page.setViewportSize({width:1000,height:900});const label=page.getByLabel('Menu label 1',{exact:true});expect((await label.boundingBox()).width).toBeGreaterThan(100);
  await page.getByRole('button',{name:'Prepare edition',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible({timeout:30000});
  await page.getByLabel('Preview page',{exact:true}).selectOption(target);const href=await page.locator('#full-public-preview').getAttribute('href'),context=await browser.newContext({javaScriptEnabled:false});await context.addCookies(await page.context().cookies());const visitor=await context.newPage();
  try{await visitor.goto(new URL(href,app.origin).href);await expect(visitor.locator('.site-header,.site-name')).toHaveCount(0);await expect(visitor.locator('.site-menu a')).toHaveText(['Insect Reserve']);await expect(visitor.locator('.site-sidebar a')).toHaveText('Explore the reserve');await expect(visitor.locator('body')).not.toContainText(book.entries[0].title);await expect(visitor).toHaveTitle('Insect Reserve');await visitor.setViewportSize({width:390,height:844});expect(await visitor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}finally{await context.close();}
  expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {navigate} from './preferences-helper.js';
import {task} from './composer-helper.js';
const canvas=page=>page.frameLocator('#website-draft-preview');
const area=async page=>{await task(page,'Page');await page.getByLabel('Editing area',{exact:true}).selectOption('header');};

test('author a shared site header, customize one page and follow its static navigation without duplicate branding',async({page,browser},info)=>{
 test.setTimeout(90000);page.setDefaultTimeout(15000);const root=await mkdtemp(path.join(os.tmpdir(),'observanda-site-header-')),book=sampleNotebook(),id=randomUUID();book.website.design.navigation='side';book.pages.push({id,title:'Manifesto',body:'A continuous practice of code, sound and nature.',share:true,sections:[]});
 const f=await encryptedFixture(root,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(root,'preferences.json')}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);await navigate(page,'Website editor');await area(page);await page.getByRole('button',{name:'Create site header',exact:true}).click();await page.getByLabel('Design name',{exact:true}).fill('PRIVATE shared masthead');await page.locator('[data-region-panel=reuse] summary').click();await page.getByLabel('Use as site default',{exact:true}).check();
  await page.locator('[data-palette-kind=heading]').click();await canvas(page).locator('[data-composition=header] .canvas-section-edit').click();await page.getByLabel('Section heading',{exact:true}).fill('Seigr');
  await area(page);await page.locator('[data-palette-kind=link]').click();await expect(canvas(page).locator('[data-composition=header] .canvas-section-edit')).toHaveCount(2);await canvas(page).locator('[data-composition=header] .canvas-section-edit').last().click();await page.getByLabel('Link label',{exact:true}).fill('Manifesto');await page.getByRole('button',{name:'Choose page link',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Manifesto',exact:true}).click();
  await expect(canvas(page).locator('.site-top')).toHaveCount(0);await expect(canvas(page).locator('.site-sidebar')).toHaveCount(0);await expect(canvas(page).locator('body')).toHaveCSS('padding-left','0px');
  await page.getByLabel('Page',{exact:true}).selectOption('pages/'+id+'.html');await area(page);await expect(canvas(page).locator('[data-composition=header]')).toContainText('Seigr');await page.getByRole('button',{name:'Make a separate copy for this page',exact:true}).click();await page.getByLabel('Design name',{exact:true}).fill('PRIVATE manifesto masthead');await canvas(page).locator('[data-composition=header] .canvas-section-edit').first().click();await page.getByLabel('Section heading',{exact:true}).fill('Seigr · Manifesto');
  await area(page);await page.getByLabel('Design for this page',{exact:true}).selectOption('none');await expect(canvas(page).locator('.site-top')).toBeVisible();await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(canvas(page).locator('.site-masthead')).toContainText('Seigr · Manifesto');
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();await expect(canvas(page).locator('.site-masthead')).toContainText('Seigr · Manifesto');await page.getByLabel('Page',{exact:true}).selectOption('index.html');await expect(canvas(page).locator('.site-masthead h2')).toHaveText('Seigr');
  await page.getByRole('button',{name:'Prepare edition',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible();await page.getByLabel('Preview page',{exact:true}).selectOption('index.html');
  const href=await page.locator('#full-public-preview').getAttribute('href'),context=await browser.newContext({javaScriptEnabled:false});await context.addCookies(await page.context().cookies());const visitor=await context.newPage();visitor.setDefaultTimeout(15000);
  try{await visitor.goto(new URL(href,app.origin).href);await expect(visitor.locator('.site-top')).toHaveCount(0);await expect(visitor.locator('.site-masthead h2')).toHaveText('Seigr');await visitor.locator('.site-masthead').getByRole('link',{name:'Manifesto',exact:false}).click();await expect(visitor.locator('.site-masthead h2')).toHaveText('Seigr · Manifesto');await expect(visitor.locator('body')).not.toContainText('PRIVATE');await visitor.setViewportSize({width:390,height:844});await visitor.evaluate(()=>document.documentElement.style.fontSize='24px');expect(await visitor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await visitor.screenshot({path:info.outputPath('custom-header-mobile.png')});}finally{await context.close();}
  expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

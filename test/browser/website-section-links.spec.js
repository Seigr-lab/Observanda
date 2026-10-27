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

test('choose authored and paged record sections without typing anchors and follow their exported links',async({page,browser})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);const root=await mkdtemp(path.join(os.tmpdir(),'observanda-section-links-')),book=sampleNotebook(),record=book.entries[0];record.title='Timing observations';record.share=true;record.sections=Array.from({length:57},(_,i)=>({id:randomUUID(),title:'Observation '+i,body:'Retained measurement '+i}));
 const f=await encryptedFixture(root,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(root,'preferences.json')}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);await navigate(page,'Website editor');await page.getByRole('button',{name:'Add page',exact:true}).click();await page.getByLabel('Page title',{exact:true}).fill('Concepts');const destination=await page.getByLabel('Page',{exact:true}).inputValue();await task(page,'Page');await page.locator('[data-palette-kind=heading]').click();await canvas(page).locator('main .canvas-section-edit').click();await page.getByLabel('Section heading',{exact:true}).fill('How the pieces connect');
  await page.getByRole('button',{name:'Add page',exact:true}).click();await page.getByLabel('Page title',{exact:true}).fill('Overview');const source=await page.getByLabel('Page',{exact:true}).inputValue();await task(page,'Page');await page.locator('[data-palette-kind=link]').click();await canvas(page).locator('main .canvas-section-edit').click();await page.getByLabel('Link label',{exact:true}).fill('Read concepts');await page.getByRole('button',{name:'Choose section link',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Concepts',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'How the pieces connect',exact:true}).click();await expect(page.getByLabel('Link destination',{exact:true})).toHaveValue(/^page:.*#section-/);const conceptHref=await page.getByLabel('Link destination',{exact:true}).inputValue();
  await task(page,'Page');await page.locator('[data-palette-kind=link]').click();await expect(canvas(page).locator('main .canvas-section-edit')).toHaveCount(2);await canvas(page).locator('main .canvas-section-edit').last().click();await page.getByLabel('Link label',{exact:true}).fill('Inspect observation 56');await page.getByRole('button',{name:'Choose section link',exact:true}).click();await page.getByRole('dialog').getByLabel('Page type',{exact:true}).selectOption('entry');await page.getByRole('dialog').getByLabel('Find a page',{exact:true}).fill('Timing observations');await page.getByRole('dialog').getByRole('button',{name:/Timing observations/}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Next',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Observation 25');await page.getByRole('dialog').getByRole('button',{name:'Next',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Observation 56',exact:true}).click();await expect(page.getByLabel('Link destination',{exact:true})).toHaveValue('entry:'+record.id+'#record-section-'+record.sections[56].id);
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();await expect(canvas(page).locator('main a.site-action')).toHaveCount(2);
  await page.getByRole('button',{name:'Prepare edition',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible();await page.getByLabel('Preview page',{exact:true}).selectOption(source);const href=await page.locator('#full-public-preview').getAttribute('href'),context=await browser.newContext({javaScriptEnabled:false});await context.addCookies(await page.context().cookies());const visitor=await context.newPage();visitor.setDefaultTimeout(15000);
  try{const url=new URL(href,app.origin).href;await visitor.goto(url);await visitor.getByRole('link',{name:/Read concepts/}).click();expect(new URL(visitor.url()).pathname.endsWith(destination)).toBe(true);expect(new URL(visitor.url()).hash).toBe('#'+conceptHref.split('#')[1]);await expect(visitor.getByRole('heading',{name:'How the pieces connect',exact:true})).toBeInViewport();await visitor.goto(url);await visitor.getByRole('link',{name:/Inspect observation 56/}).click();await expect(visitor.getByRole('heading',{name:'Observation 56',exact:true})).toBeInViewport();}finally{await context.close();}
  expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

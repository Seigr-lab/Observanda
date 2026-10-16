import {test,expect} from '@playwright/test';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {Workspace} from '../../src/storage.js';
import {testServer} from '../device-fixture.js';
import {buildPublication} from '../../src/publication.js';
import {contentBuffer} from '../../src/file-content.js';

test('record dates can be unknown or estimated through editing, history, browsing and a static edition',async({page,browser})=>{
 test.setTimeout(90000);
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-date-ui-')),book=sampleNotebook(),ws=new Workspace(root);
 const [art,field]=book.entries;art.type='note';art.title='Material study with no reliable date';art.figures=[];field.title='Field visit remembered from February';
 await ws.create(book);const app=await testServer({root,port:0,headless:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const dialog=page.locator('#dialog'),precision=page.getByLabel('Date precision',{exact:true});
 const save=async()=>{await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');};
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,art.id);
  await expect(page.getByLabel('Record date',{exact:true})).toHaveValue(art.occurredOn);
  // Use the keyboard for the choice; no API shortcut creates the saved date.
  await precision.focus();await page.keyboard.press('End');await page.keyboard.press('Tab');await expect(precision).toHaveValue('unknown');
  await expect(page.getByLabel('Record date',{exact:true})).toHaveCount(0);
  expect((await ws.read()).book.entries[0].occurredOn).toBe(art.occurredOn);
  await save();expect((await ws.read()).book.entries[0].occurredOn).toEqual({kind:'unknown'});
  await page.reload();await expect(precision).toHaveValue('unknown');
  await page.getByRole('button',{name:'Read record',exact:true}).click();await expect(page.locator('.record-reader')).toContainText('Date unknown');
  await page.getByRole('button',{name:'History',exact:true}).click();await dialog.getByRole('button',{name:'Review version',exact:true}).first().click();
  await expect(dialog.locator('.record-revision')).toContainText(art.occurredOn);
  await dialog.getByText('Compare with current saved version',{exact:true}).click();
  await expect(dialog.locator('.record-revision-change')).toContainText('Date unknown');
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(id=>location.hash='#/notebooks/'+id,book.notebooks[0].id);
  await page.getByText('Filters',{exact:true}).click();await page.getByLabel('Date certainty',{exact:true}).selectOption('unknown');
  await expect(page.locator('.records-table tbody tr')).toHaveCount(1);await expect(page.locator('.records-table')).toContainText(art.title);
  await page.getByLabel('From date',{exact:true}).fill('2024-02-01');await expect(page.locator('.record-filter-error')).toContainText('Clear the date range');
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await page.getByRole('button',{name:field.title,exact:true}).click();
  await precision.selectOption('month');await page.getByLabel('Month',{exact:true}).fill('2024-02');await page.getByLabel('Estimated date',{exact:true}).check();await save();
  expect((await ws.read()).book.entries[1].occurredOn).toEqual({kind:'month',value:'2024-02',estimated:true});
  await page.reload();await expect(precision).toHaveValue('month');await expect(page.getByLabel('Estimated date',{exact:true})).toBeChecked();
  // Adding precision must not invent a day from a month.
  await precision.selectOption('day');await expect(page.getByLabel('Record date',{exact:true})).toHaveValue('');
  await expect(page.locator('[data-record-date-error]')).toContainText('valid date');
  await page.getByRole('button',{name:'Discard changes',exact:true}).click();await expect(precision).toHaveValue('month');
  // An incomplete range is checkpointable, but saving must leave the prior revision intact.
  await precision.selectOption('range');await page.getByLabel('Start date',{exact:true}).fill('2024-03-10');await page.getByLabel('End date',{exact:true}).fill('2024-02-01');
  await expect(page.locator('[data-record-date-error]')).toContainText('start date');
  const before=await ws.read();await page.getByRole('button',{name:'Save record',exact:true}).click();
  await expect(dialog).toContainText('The start date must be on or before the end date');expect((await ws.read()).etag).toBe(before.etag);
  await dialog.getByRole('button',{name:'Back to workspace',exact:true}).click();
  await page.getByLabel('End date',{exact:true}).fill('2024-03-14');await save();
  await page.getByRole('button',{name:'History',exact:true}).click();await dialog.getByRole('button',{name:'Review version',exact:true}).first().click();
  await expect(dialog.locator('.record-revision')).toContainText('Estimated: February 2024');
  await dialog.getByRole('button',{name:'Restore this version',exact:true}).click();await dialog.getByRole('button',{name:'Restore record',exact:true}).click();
  await expect(precision).toHaveValue('month');await expect(page.getByLabel('Estimated date',{exact:true})).toBeChecked();
  await expect(page.getByLabel('Include in website',{exact:false})).not.toBeChecked();
  await page.getByLabel('Include in website',{exact:false}).check();await save();
  await mkdir('.local/ux-review',{recursive:true});await page.locator('.record-date-fields').scrollIntoViewIfNeeded();
  await page.screenshot({path:'.local/ux-review/record-date-desktop.png'});
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.setProperty('--app-font-size','24px'));
  await page.locator('.record-date-fields').scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:'.local/ux-review/record-date-mobile.png'});
  await precision.focus();await expect(precision).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.getByLabel('Month',{exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Read record',exact:true}).click();await expect(page.locator('.record-reader')).toContainText('Estimated: February 2024');
  await page.evaluate(id=>location.hash='#/notebooks/'+id,book.notebooks[0].id);
  await page.getByText('Filters',{exact:true}).click();await page.getByLabel('From date',{exact:true}).fill('2024-02-29');await page.getByLabel('Through date',{exact:true}).fill('2024-02-29');
  await expect(page.locator('.records-table tbody tr')).toHaveCount(1);await expect(page.locator('.records-table')).toContainText('Estimated: February 2024');
  const output=buildPublication((await ws.read()).book),context=await browser.newContext({javaScriptEnabled:false}),publicPage=await context.newPage();
  try{
   await publicPage.route('https://edition.invalid/**',async route=>{
    const pathname=new URL(route.request().url()).pathname,key=pathname.slice(pathname.startsWith('/section/')?9:1);
    const value=output.files.get(key);return route.fulfill(value===undefined?{status:404,body:'Missing'}:{status:200,contentType:key.endsWith('.html')?'text/html':key.endsWith('.css')?'text/css':'application/octet-stream',body:typeof value==='string'?value:await contentBuffer(value)});
   });
   for(const base of ['', 'section/']){
    await publicPage.goto('https://edition.invalid/'+base+'entries/'+field.id+'.html');await expect(publicPage.locator('.record-page')).toContainText('Estimated: February 2024');
    await publicPage.goto('https://edition.invalid/'+base+'entries/'+art.id+'.html');await expect(publicPage.locator('.record-page')).toContainText('Date unknown');
   }
  }finally{await context.close();}
  expect(errors).toEqual([]);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});

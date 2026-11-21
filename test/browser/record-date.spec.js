import {test,expect} from '@playwright/test';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {RecordValues} from '../../src/record-values.js';
import {revealInEditor} from './record-editor-helper.js';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {testServer} from '../device-fixture.js';
import {convertPublicationRecord} from '../../src/publication-conversion-render.js';
import {routeRecordCopy} from './record-copy-page.js';

test('record dates can be unknown or estimated through editing, history, browsing and a website copy',async({page,browser},info)=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-date-ui-')),book=sampleNotebook();
 const [art,field]=book.entries;art.type='note';art.title='Material study with no reliable date';art.figures=[];field.title='Field visit remembered from February';
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const service=new RecordValues(f.workspace),saved=async record=>(await service.read({workspaceId:book.id,recordId:record.id,field:'occurredOn'})).value.value;
 const dateDialog=page.getByRole('dialog',{name:'Edit record date',exact:true}),precision=dateDialog.getByLabel('Date precision',{exact:true});
 const openDate=async record=>{await page.goto(app.origin+'/#/records/'+record.id);await (await revealInEditor(page,page.locator('main [data-action=record-value-edit][data-value-field="occurredOn"]').first(),'Record details')).click();await expect(dateDialog).toBeVisible();};
 const saveDate=async()=>{await dateDialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dateDialog).not.toBeVisible();};
 try{
  await page.goto(app.url);await openDate(art);
  await expect(dateDialog.getByLabel('Record date',{exact:true})).toHaveValue(art.occurredOn);
  // Use the keyboard for the choice; no API shortcut creates the saved date.
  await precision.focus();await page.keyboard.press('End');await page.keyboard.press('Tab');await expect(precision).toHaveValue('unknown');
  await expect(dateDialog.getByLabel('Record date',{exact:true})).toHaveCount(0);
  expect(await saved(art)).toBe(art.occurredOn);
  await saveDate();expect(await saved(art)).toEqual({kind:'unknown'});
  await page.getByRole('button',{name:'Read record',exact:true}).click();await expect(page.locator('.record-reader')).toContainText('Date unknown');
  // Browsing finds the record by its date certainty; an unknown date has no range to match.
  await page.evaluate(id=>location.hash='#/notebooks/'+id,book.notebooks[0].id);
  await page.getByText('Filters',{exact:true}).click();await page.getByLabel('Date certainty',{exact:true}).selectOption('unknown');
  await expect(page.locator('.records-table tbody tr')).toHaveCount(1);await expect(page.locator('.records-table')).toContainText(art.title);
  await page.getByRole('button',{name:/^Clear filters/}).click();
  await openDate(field);
  await precision.selectOption('month');await dateDialog.getByLabel('Month',{exact:true}).fill('2024-02');await dateDialog.getByLabel('Estimated date',{exact:true}).check();
  // Adding precision must not invent a day from a month.
  await precision.selectOption('day');await expect(dateDialog.getByLabel('Record date',{exact:true})).toHaveValue('');
  await precision.selectOption('month');await dateDialog.getByLabel('Month',{exact:true}).fill('2024-02');await dateDialog.getByLabel('Estimated date',{exact:true}).check();
  await page.setViewportSize({width:390,height:844});expect(await dateDialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('record-date-mobile.png')});
  await page.setViewportSize({width:1280,height:900});
  await saveDate();expect(await saved(field)).toEqual({kind:'month',value:'2024-02',estimated:true});
  await page.getByRole('button',{name:'Read record',exact:true}).click();await expect(page.locator('.record-reader')).toContainText('Estimated: February 2024');
  await page.evaluate(id=>location.hash='#/notebooks/'+id,book.notebooks[0].id);
  await page.getByText('Filters',{exact:true}).click();await page.getByLabel('From date',{exact:true}).fill('2024-02-29');await page.getByLabel('Through date',{exact:true}).fill('2024-02-29');
  await expect(page.locator('.records-table tbody tr')).toHaveCount(1);await expect(page.locator('.records-table')).toContainText('Estimated: February 2024');
  // The website copies state each authored uncertainty.
  const current=(await f.workspace.read()).book;
  for(const [record,text] of [[field,'Estimated: February 2024'],[art,'Date unknown']]){
   const copy=await convertPublicationRecord(f.workspace,current,{...current.entries.find(e=>e.id===record.id),share:true}),context=await browser.newContext({javaScriptEnabled:false}),publicPage=await context.newPage();
   try{await publicPage.goto(await routeRecordCopy(context,'https://edition.invalid',copy));await expect(publicPage.locator('.record-page')).toContainText(text);}finally{await context.close();}
  }
  expect(errors).toEqual([]);
 }finally{await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

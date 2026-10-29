import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {builtAssets} from './built-assets-helper.js';

async function fixture(run){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-task-ui-')),book=sampleNotebook(),f=await encryptedFixture(directory,book);
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json'),browserAssets:await builtAssets(directory)});
 try{await run(app,book);}finally{await app.close();clearVault(f.vault);if(path.dirname(path.resolve(directory))!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-task-ui-'))throw Error('Unexpected cleanup directory');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
test('discover and pin a disabled tool, then return to the filtered record list',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await fixture(async app=>{
  await page.goto(app.url);await page.goto(app.origin+'/#/records');await page.getByRole('searchbox',{name:'Search records',exact:true}).fill('observation');
  await page.locator('.task-guidance [data-action=tools]').click();await page.getByRole('searchbox',{name:'Search tools',exact:true}).fill('calculator');
  const card=page.locator('[data-tool-card=scientific-calculator]');await expect(card).toContainText('Available to enable');await card.getByRole('button',{name:'Enable tool',exact:true}).click();
  await expect(page).toHaveURL(/#\/tools$/);await expect(page.getByRole('searchbox',{name:'Search tools',exact:true})).toHaveValue('calculator');await card.getByRole('button',{name:'Pin tool',exact:true}).click();
  await expect(page.locator('.pinned-tools')).toContainText('Scientific calculator');await card.getByRole('button',{name:'Open',exact:true}).click();
  await expect(page).toHaveURL(/#\/modules\/scientific-calculator$/);await page.getByRole('button',{name:'Return to All records',exact:true}).click();
  await expect(page.getByRole('searchbox',{name:'Search records',exact:true})).toHaveValue('observation');await page.reload();await expect(page.locator('.pinned-tools')).toContainText('Scientific calculator');
  expect(errors).toEqual([]);
 });
});
test('contextual help keeps an unfinished record mounted and restores focus',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 await fixture(async(app,book)=>{
  await page.goto(app.url);await page.goto(app.origin+'/#/notebooks/'+book.notebooks[0].id);await page.getByRole('button',{name:'New record',exact:true}).click();await page.getByRole('button',{name:'Create free-form note',exact:true}).click();
  const title=page.getByLabel('Record title',{exact:true});await title.fill('An unfinished observation');const help=page.getByRole('button',{name:'Help with this task',exact:true});await help.click();
  const dialog=page.getByRole('dialog',{name:'Help with this task',exact:true});await expect(dialog.locator('article')).toBeVisible();await expect(title).toHaveValue('An unfinished observation');await expect(page.locator('#leave-dialog')).not.toBeVisible();
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(help).toBeFocused();await expect(title).toHaveValue('An unfinished observation');
  await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('.record-editing h1')).toHaveText('An unfinished observation');
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await page.screenshot({path:test.info().outputPath('record-'+width+'.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 });
});
test('spreadsheet keyboard movement preserves cell text and saved values',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 await fixture(async app=>{
  await page.goto(app.url);await page.goto(app.origin+'/#/tools');const card=page.locator('[data-tool-card=spreadsheet]');await card.getByRole('button',{name:'Enable tool',exact:true}).click();await card.getByRole('button',{name:'Open',exact:true}).click();await page.getByRole('button',{name:'New spreadsheet',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill('Keyboard observations');await page.getByLabel('Cell A1',{exact:true}).fill('9007199254740993');await page.keyboard.press('Enter');await expect(page.getByLabel('Cell A2',{exact:true})).toBeFocused();await page.keyboard.press('Alt+ArrowRight');await expect(page.getByLabel('Cell B2',{exact:true})).toBeFocused();await page.keyboard.press('Shift+Enter');await expect(page.getByLabel('Cell B1',{exact:true})).toBeFocused();await page.getByLabel('Cell B1',{exact:true}).fill('=A1+1');await page.keyboard.press('Tab');await expect(page.getByLabel('Cell C1',{exact:true})).toBeFocused();
  await expect(page.getByLabel('Cell A1',{exact:true})).toHaveValue('9007199254740993');await expect(page.locator('[data-cell-result="0:1"]')).toHaveText('9.007199254740994e+15');await page.getByRole('button',{name:'Save spreadsheet',exact:true}).click();await expect(page.locator('[data-module-status]')).toHaveText('Saved');await page.reload();await expect(page.getByLabel('Cell B1',{exact:true})).toHaveValue('=A1+1');
 });
});

import {test,expect} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {selectionBook} from '../publication-selection-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {startServer} from '../../src/server.js';
import {navigate} from './preferences-helper.js';

test('choose edition content in the app, retain choices across pages and export without withheld writing or automatic CSV',async({page},testInfo)=>{
 test.setTimeout(90000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-select-edition-ui-')),data=selectionBook(23),f=await encryptedFixture(directory,{...data.book,title:'workspace'}),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')}),requests=[],errors=[];
 const selections=[],preparations=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push(r.url());if(r.url().endsWith('/api/publication-selection'))selections.push(r.postDataJSON());if(r.url().endsWith('/api/publication-jobs/start'))preparations.push(r.postDataJSON());});
 try{
  const before=await f.workspace.read();await page.goto(app.url);await navigate(page,'Publishing');await page.getByRole('button',{name:'Review website',exact:true}).click();
  const dialog=page.getByRole('dialog'),record=dialog.locator('[data-edition-record="'+data.record.id+'"]');await expect(dialog.getByRole('heading',{name:'Choose edition content'})).toBeVisible();await expect(dialog).toContainText('A public chart reveals plotted values');
  await record.locator('summary').click();await record.getByLabel('Main writing',{exact:true}).uncheck();await record.getByLabel('WITHHELD_SECTION_TITLE',{exact:true}).uncheck();await record.getByLabel('WITHHELD_FIELD',{exact:true}).uncheck();await expect(record.getByLabel('Include exact data table and CSV',{exact:false})).not.toBeChecked();
  const restored=dialog.locator('[data-edition-record="'+data.other.id+'"]');await restored.locator('summary').click();await restored.getByLabel('Main writing',{exact:true}).uncheck();
  await dialog.getByRole('button',{name:'Next records'}).click();await expect(dialog).toContainText('Page 2');await dialog.getByRole('button',{name:'Previous records'}).click();await record.locator('summary').click();await expect(record.getByLabel('Main writing',{exact:true})).not.toBeChecked();await expect(record.getByLabel('WITHHELD_SECTION_TITLE',{exact:true})).not.toBeChecked();
  await restored.locator('summary').click();await expect(restored.getByLabel('Main writing',{exact:true})).not.toBeChecked();await restored.getByLabel('Main writing',{exact:true}).check();
  expect(selections.map(value=>value.offset)).toEqual([0,20,0]);expect(selections[0].cursor).toBeNull();expect(selections[1].cursor).toEqual(expect.any(String));expect(selections[1].cursor.length).toBeGreaterThan(32);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.zoom='2');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.evaluate(()=>document.documentElement.style.zoom='');await page.screenshot({path:testInfo.outputPath('edition-selection-phone.png')});
  await dialog.getByRole('button',{name:'Prepare selected edition'}).click();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible({timeout:20000});await expect(page.getByText('1 research reference is unavailable',{exact:false})).toBeVisible();
  expect(preparations).toHaveLength(1);expect(preparations[0].edition.records).toHaveLength(1);expect(preparations[0].edition.records[0].id).toBe(data.record.id);
  await page.getByLabel('I have reviewed this website and its media for sharing.').check();const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download website ZIP'}).click();const download=await downloading,bytes=await readFile(await download.path());for(const value of ['WITHHELD_',data.record.sections[1].id,'.csv','C:/Users/private'])expect(bytes.includes(Buffer.from(value))).toBe(false);
  expect(bytes.includes(Buffer.from('Public steps'))).toBe(true);expect(bytes.includes(Buffer.from('.svg'))).toBe(true);expect(requests.filter(url=>url.endsWith('/api/book'))).toEqual([]);expect(errors).toEqual([]);expect(await f.workspace.read()).toEqual(before);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

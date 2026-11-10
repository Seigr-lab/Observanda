import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

test('website editor labels and accessibility names follow the selected language while the saved website stays unchanged',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(12000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-website-files-localization-'));
 let fixture,app;
 try{
  const book=sampleNotebook();book.entries=[];fixture=await encryptedFixture(directory,book);
  const store=new WebsiteFileStore(fixture.workspace),id=randomUUID(),label='Røros field station, 4 °C';
  const html='<!doctype html><html lang="en"><head><title>Field station</title><link rel="stylesheet" href="style.css"></head><body><main><h1>Field station</h1><p>'+label+'</p></main></body></html>';
  await store.importFiles(id,{name:'Field station',files:new Map([['index.html',html],['style.css','body{font:17px/1.5 system-ui}']])});
  const saved=await store.open(id);
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(app.url);
  const canvas=page.frameLocator('#website-files-canvas'),paragraph=canvas.getByText(label,{exact:true}),commands=page.locator('.website-page-controls');
  for(const locale of ['nb','nn','ca','es','en']){
   const messages=JSON.parse(await readFile(new URL('../../src/web/locales/'+locale+'/websiteFiles.json',import.meta.url),'utf8'));
   const text=key=>{expect(messages[key],locale+' '+key).toEqual(expect.any(String));return messages[key];};
   await page.evaluate(()=>location.hash='#/preferences/help');await page.locator('[data-language-choice]').selectOption(locale);
   await expect(page.locator('.preferences-heading')).toHaveAttribute('lang',locale);
   await page.evaluate(hash=>location.hash=hash,'#/websites/'+id+'/editor');await expect(paragraph).toBeVisible();
   await expect(page.locator('html')).toHaveAttribute('lang',locale);
   await expect(page.getByRole('button',{name:text('save'),exact:true})).toBeDisabled();
   await expect(page.getByRole('button',{name:text('preview'),exact:true})).toBeVisible();
   for(const key of ['site','page','siteDesignTools','siteReleaseTools'])await expect(commands.getByRole('group',{name:text(key),exact:true})).toBeVisible();
   await expect(commands.getByRole('button',{name:text('designThemes'),exact:true})).toBeVisible();
   await expect(commands.getByRole('button',{name:text('folderPublish'),exact:true})).toBeVisible();
   // Formatting controls appear, with translated names, once the cursor is in the page.
   await paragraph.click();
   await expect(page.locator('[data-visual-command="subscript"]')).toHaveAccessibleName(text('richSubscript'));
   await expect(page.locator('[data-visual-command="superscript"]')).toHaveAccessibleName(text('richSuperscript'));
   await expect(paragraph).toHaveText(label);
  }
  expect(errors).toEqual([]);
  const after=await store.open(id);expect(after.site.revision).toBe(saved.site.revision);expect(after.html).toBe(saved.html);expect(after.css).toBe(saved.css);
 }finally{
  try{await page.close();await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
 }
});

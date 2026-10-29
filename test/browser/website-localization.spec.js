import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';

test('website editor labels and accessibility text follow the selected language while saved content stays unchanged',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-website-localization-'));
 const f=await encryptedFixture(directory,upgradeNotebook({...sampleNotebook(),title:'workspace'}));
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const original=(await f.workspace.read()).book,errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);let homepageTitle;
  for(const locale of ['nb','nn','ca','es','en']){
   const messages=JSON.parse(await readFile(new URL('../../src/web/locales/'+locale+'/websiteAuthoring.json',import.meta.url),'utf8'));
   const composition=JSON.parse(await readFile(new URL('../../src/web/locales/'+locale+'/compositionControls.json',import.meta.url),'utf8'));
   await page.evaluate(()=>location.hash='#/preferences/help');await page.locator('[data-language-choice]').selectOption(locale);
   await expect(page.locator('.preferences-heading')).toHaveAttribute('lang',locale);
   await page.evaluate(()=>location.hash='#/website');
   await expect(page.locator('.website-toolbar h1')).toHaveText(messages.editorWebsite);
   await expect(page.locator('#website-device')).toHaveAttribute('aria-label',messages.editorViewport);
   await expect(page.locator('[data-action="website-undo"]')).toHaveAttribute('aria-label',messages.editorUndo);
   await page.locator('.inspector-tasks [data-tool="page"]').click();
   await expect(page.locator('[data-palette-kind="hero"]')).toHaveAttribute('aria-label',composition.element_hero);
   await expect(page.locator('[data-palette-kind="text"]')).toHaveAttribute('title',messages.editorInsertHint);
   await page.locator('.inspector-tasks [data-tool="site"]').click();
   await expect(page.locator('.site-tools h2')).toHaveText(messages.editorSiteSettings);
   await page.locator('.site-tools [data-tool="typography"]').click();
   await expect(page.locator('.inspector-content h2')).toHaveText(messages.editorWebsiteTypography);
   await page.locator('[data-action="website-type-tab"][data-tab="spacing"]').click();
   await expect(page.getByLabel(messages.editorParagraphSpacingEm,{exact:true})).toBeVisible();
   await page.locator('.inspector-tasks [data-tool="page"]').click();
   await page.locator('[data-tool="page-settings"]').click();
   const heading=page.getByLabel(messages.editorHomepageHeading,{exact:true});homepageTitle??=await heading.inputValue();
   await expect(heading).toHaveValue(homepageTitle);
  }
  expect(errors).toEqual([]);expect((await f.workspace.read()).book).toEqual(original);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

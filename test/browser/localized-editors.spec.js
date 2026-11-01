import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from '../../src/security/dashboard-storage.js';

test('evidence controls and retained record labels follow each language through the current editing layout',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-localized-editors-'));
 const f=await encryptedFixture(directory,upgradeNotebook({...sampleNotebook(),title:'workspace'}));
 const settings=defaultDashboard();settings.enabledModules=['publishing','resources','planning'];
 await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const original=(await f.workspace.read()).book,record=original.entries[0],errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);
  for(const locale of ['nb','nn','ca','es','en']){
   const messages=JSON.parse(await readFile(new URL('../../src/web/locales/'+locale+'/materialEditors.json',import.meta.url),'utf8'));
   await page.evaluate(()=>location.hash='#/preferences/help');
   await page.locator('[data-language-choice]').selectOption(locale);
   try{await expect(page.locator('.preferences-heading')).toHaveAttribute('lang',locale);}catch(error){throw new Error(errors.join('\n')+'\n'+error.message);}
   const resource=async namespace=>JSON.parse(await readFile(new URL('../../src/web/locales/'+locale+'/'+namespace+'.json',import.meta.url),'utf8'));
   await expect(page.locator('html')).toHaveAttribute('lang',locale);
   await expect(page.locator('.skip-link')).toHaveText((await resource('startup')).skip);
   await expect(page.locator('[data-module-nav="resources"] > .nav-group-label')).toHaveText((await resource('moduleEditors')).inventory);
   await expect(page.locator('[data-module-nav="resources"] [data-module-id="resources"]')).toHaveText((await resource('moduleEditors')).inventory);
   await expect(page.locator('[data-module-nav="planning"] [data-module-id="planning"]')).toHaveText((await resource('dashboardEditors')).calendarPlanning);
   await expect(page.locator('[data-module-nav="publishing"] [data-action="website"]')).toHaveText((await resource('websiteSites')).editor);
   await page.evaluate(id=>location.hash='#/records/'+id,record.id);
   await expect(page.getByRole('heading',{name:record.title,exact:true})).toBeVisible();
   const group=page.locator('[data-disclosure="record-evidence"]');
   if(await group.count()&&!await group.evaluate(element=>element.open))await group.locator(':scope > summary').click();
   const launch=page.locator('[data-action="material-open"]');
   await expect(launch).toHaveText(messages.openEvidenceAnalysis);await launch.click();
   const dialog=page.locator('#dialog');
   await expect(dialog.getByRole('heading',{name:messages.evidenceAnalysis,exact:true})).toBeVisible();
   const collection=dialog.locator('[data-action="material-collection-form"]');
   const advanced=dialog.locator('.material-more');
   if(await advanced.count()&&!await advanced.evaluate(element=>element.open))await advanced.locator(':scope > summary').click();
   await expect(collection).toHaveText(messages.createCollection);await collection.click();
   await expect(dialog.locator('#material-form')).toBeVisible();
   await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
  }
  expect(errors).toEqual([]);expect((await f.workspace.read()).book).toEqual(original);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

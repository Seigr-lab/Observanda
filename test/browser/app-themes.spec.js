import {test,expect} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {preferences} from './preferences-helper.js';
import {answerConfirmation} from './confirm-helper.js';

const rgb=hex=>'rgb('+hex.slice(1).match(/../g).map(pair=>parseInt(pair,16)).join(', ')+')';

test('an author creates their own app theme and it recolours every part of the app, persists and can be deleted',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-app-themes-')),preferencesFile=path.join(directory,'preferences.json');
 const f=await encryptedFixture(directory,sampleNotebook()),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const night={background:'#14161c',surface:'#1d212a',text:'#e9e6df',muted:'#a7a39a',border:'#383d49',accent:'#e0a63c'};
 const set=async(key,value)=>page.locator('[data-app-theme="'+key+'"]').evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},value);
 try{
  await page.goto(app.url);await preferences(page,'App appearance');
  const chooser=page.getByRole('region',{name:'App theme',exact:true});
  await chooser.getByRole('button',{name:'Create my own theme',exact:true}).click();
  await expect(chooser.getByRole('button',{name:/Your theme$/})).toHaveAttribute('aria-pressed','true');
  await page.getByLabel('Theme name',{exact:true}).fill('Night lab');
  for(const [key,value] of Object.entries(night))await set(key,value);
  // The whole app follows the theme while it is edited.
  await expect(page.locator('.sidebar')).toHaveCSS('background-color',rgb(night.surface));
  await expect(page.locator('body')).toHaveCSS('background-color',rgb(night.background));
  await expect(page.locator('main h1').first()).toHaveCSS('color',rgb(night.text));
  await expect(chooser.locator('.app-theme-contrast li[data-contrast-ok=false]')).toHaveCount(0);
  await page.getByRole('button',{name:'Save app settings',exact:true}).click();await expect(page.locator('main [data-interface-status]')).toContainText('Saved on this computer');
  const saved=JSON.parse(await readFile(preferencesFile,'utf8')).interface;
  expect(saved.appThemes).toHaveLength(1);expect(saved.appThemes[0].name).toBe('Night lab');expect(saved.appTheme).toBe(saved.appThemes[0].id);
  // After a reload the theme still applies, including dialogs and the website editor.
  await page.reload();await expect(page.locator('.sidebar')).toHaveCSS('background-color',rgb(night.surface));
  await page.getByRole('button',{name:'Website editor',exact:true}).first().click();
  await expect(page.locator('#main[data-website-files-app]')).toBeVisible();
  await expect(page.locator('.website-files-app')).toHaveCSS('color',rgb(night.text));
  await page.locator('[data-action="website-files-back"]').click();
  await preferences(page,'App appearance');
  await page.getByRole('button',{name:'Delete this theme',exact:true}).click();await answerConfirmation(page,'Delete');
  await expect(page.getByRole('button',{name:/Night lab/})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/^Research$/})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.sidebar')).not.toHaveCSS('background-color',rgb(night.surface));
  expect(errors).toEqual([]);
 }finally{await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

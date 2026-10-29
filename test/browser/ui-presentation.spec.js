import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {builtAssets} from './built-assets-helper.js';

test('translated discovery and shared controls reflow across presets and enlarged text',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-presentation-')),fixture=await encryptedFixture(directory,sampleNotebook()),errors=[];
 const app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json'),browserAssets:await builtAssets(directory)});
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);
  for(const locale of ['ca','es','nb','nn','en']){
   await page.goto(app.origin+'/#/preferences/general');await page.locator('[data-language-choice]').selectOption(locale);await expect(page.locator('[data-language-choice]')).toHaveValue(locale);await expect(page.locator('[data-language-choice]')).toBeFocused();
   await page.goto(app.origin+'/#/tools');const messages=JSON.parse(await readFile(new URL('../../src/web/locales/'+locale+'/experience.json',import.meta.url),'utf8'));
   await expect(page.locator('.tool-directory')).toHaveAttribute('lang',locale);await expect(page.locator('.tool-directory h1')).toHaveText(messages.tools);await expect(page.locator('[data-tool-search]')).toHaveAccessibleName(messages.searchTools);
   await page.setViewportSize({width:320,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:test.info().outputPath('tools-'+locale+'.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});
  }
  const gallery=await readFile(new URL('./fixtures/control-gallery.html',import.meta.url),'utf8');
  for(const theme of ['research','studio']){
   await page.goto(app.origin+'/#/preferences/interface');await page.locator('[data-interface=appTheme]').selectOption(theme);await page.locator('[data-action=interface-save]').click();await expect(page.locator('[data-interface-status]')).toHaveText('Saved on this computer. Applies across workspaces.');
   await page.evaluate(html=>{document.querySelector('main').innerHTML=html;},gallery);
   for(const font of [17,34])for(const width of [1440,320]){
    await page.setViewportSize({width,height:1000});await page.evaluate(size=>document.documentElement.style.setProperty('--app-font-size',size+'px'),font);await page.locator('[data-gallery-focus]').focus();await expect(page.locator('[data-gallery-focus]')).toBeFocused();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await page.locator('.control-gallery .button').evaluateAll(nodes=>nodes.every(node=>node.getBoundingClientRect().height>=44))).toBe(true);
    await page.screenshot({path:test.info().outputPath('controls-'+theme+'-'+font+'-'+width+'.png'),fullPage:true});
   }
  }
  expect(errors).toEqual([]);
 }finally{await app.close();clearVault(fixture.vault);if(path.dirname(path.resolve(directory))!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-presentation-'))throw Error('Unexpected cleanup directory');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

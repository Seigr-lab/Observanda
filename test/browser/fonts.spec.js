import {test,expect} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startServer} from '../../src/server.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {preferences} from './preferences-helper.js';
import {woffFixture} from '../font-fixture.js';
let app,directory,fixture,errors;
// The workspace font library lives in Preferences > Fonts; PDFs and the app choose from it.
test.beforeEach(async({page})=>{directory=await mkdtemp(path.join(os.tmpdir(),'observanda-font-ui-'));errors=[];page.on('pageerror',e=>errors.push(e.message));fixture=await encryptedFixture(directory,upgradeNotebook(sampleNotebook()));app=await startServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});await page.goto(app.url);await preferences(page,'Fonts');});
test.afterEach(async()=>{await app.close();await clearVault(fixture.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
const loads=(page,id)=>page.evaluate(async id=>{const fonts=await document.fonts.load('16px "Observanda '+id+'"');return fonts.length===1&&fonts[0].status==='loaded';},id);
test('uploaded OTF and compressed variable fonts render in the browser',async({page})=>{
 const sources=[{name:'source-serif.otf',mimeType:'font/otf',buffer:await readFile('test/fixtures/fonts/source-serif.otf')},{name:'dm-sans.woff2',mimeType:'font/woff2',buffer:await readFile('test/fixtures/fonts/dm-sans.woff2')},{name:'dm-sans.woff',mimeType:'font/woff',buffer:woffFixture(await readFile('src/fonts/dm-sans.ttf'))}];
 for(const [i,file] of sources.entries()){await page.locator('[data-font-upload]').setInputFiles(file);await expect(page.locator('.custom-font-row')).toHaveCount(i+1);const id=await page.locator('[data-font-sample]').last().getAttribute('data-font-sample');expect(await loads(page,id)).toBe(true);}
 expect(errors).toEqual([]);
});
test('a font allowed in exports is kept in the library after reopening',async({page})=>{
 await page.locator('[data-font-upload-embed]').check();await page.locator('[data-font-upload]').setInputFiles('src/fonts/dm-sans.ttf');await expect(page.locator('.custom-font-row')).toHaveCount(1);
 const id=await page.locator('[data-font-sample]').getAttribute('data-font-sample');
 await page.reload();await expect(page.locator('.custom-font-row')).toHaveCount(1);await expect(page.locator('[data-font-embed="'+id+'"]')).toBeChecked();
 expect(await loads(page,id)).toBe(true);expect(errors).toEqual([]);
});
test('an invalid upload shows a useful error and the library fits a zoomed phone screen',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='24px');
 await page.locator('[data-font-upload]').setInputFiles({name:'invalid.ttf',mimeType:'font/ttf',buffer:Buffer.from('Not font data')});await expect(page.locator('#notice')).toContainText('This font could not be read safely');await expect(page.locator('.custom-font-row')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
});

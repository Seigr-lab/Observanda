import {test,expect} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startServer} from '../../src/server.js';
import {Workspace} from '../../src/storage.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {navigate,preferences} from './preferences-helper.js';
import {editorTab,typeTools} from './composer-helper.js';
import {woffFixture} from '../font-fixture.js';
let app,root,errors;
test.beforeEach(async({page})=>{root=await mkdtemp(path.join(os.tmpdir(),'observanda-font-ui-'));errors=[];page.on('pageerror',e=>errors.push(e.message));await new Workspace(root).create(upgradeNotebook(sampleNotebook()));app=await startServer({root,preferencesFile:path.join(root,'preferences.json'),port:0});await page.goto(app.url);await preferences(page,'Appearance');});
test.afterEach(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
async function choose(page,label,name){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name,exact:true}).click();}
test('uploaded OTF and compressed variable fonts render in the browser',async({page})=>{
 const sources=[{name:'source-serif.otf',mimeType:'font/otf',buffer:await readFile('test/fixtures/fonts/source-serif.otf')},{name:'dm-sans.woff2',mimeType:'font/woff2',buffer:await readFile('test/fixtures/fonts/dm-sans.woff2')},{name:'dm-sans.woff',mimeType:'font/woff',buffer:woffFixture(await readFile('src/fonts/dm-sans.ttf'))}];
 for(const [i,file] of sources.entries()){await page.locator('[data-font-upload]').setInputFiles(file);await expect(page.locator('.custom-font-row')).toHaveCount(i+1);const id=await page.locator('[data-font-sample]').last().getAttribute('data-font-sample');expect(await page.evaluate(async id=>{const fonts=await document.fonts.load('16px "Observanda '+id+'"');return fonts.length===1&&fonts[0].status==='loaded';},id)).toBe(true);const label=await page.locator('.custom-font-row strong').last().textContent();await choose(page,'Body font',label+' Custom · '+(file.name.endsWith('.otf')?'Static':'Variable'));const frame=page.frameLocator('#design-preview');await expect(frame.locator('body')).toHaveCSS('font-family','"Observanda '+id+'", serif');expect(await frame.locator('body').evaluate(async(el,id)=>{const loaded=await el.ownerDocument.fonts.load('16px "Observanda '+id+'"');return loaded.length>0&&loaded.every(f=>f.status==='loaded');},id)).toBe(true);}
 expect(errors).toEqual([]);
});
test('font names render in their typefaces; keyboard selection and variable axes survive saving',async({page},testInfo)=>{
 await page.getByRole('combobox',{name:'Body font',exact:true}).click();for(const name of ['Poiret One','Amatic SC','Averia Serif Libre','Reenie Beanie','Rubik Dirt','Crimson Text','Aref Ruqaa Ink','DM Sans','Sue Ellen Francisco','Patua One']){const item=page.getByRole('option',{name:new RegExp('^'+name+' ')});await expect(item).toHaveCount(1);expect(await item.locator('span').evaluate(el=>getComputedStyle(el).fontFamily)).toContain(name);}
 for(const name of ['Poiret One','Amatic SC','Averia Serif Libre','Reenie Beanie','Rubik Dirt','Crimson Text','Aref Ruqaa Ink','DM Sans','Sue Ellen Francisco','Patua One'])expect(await page.evaluate(async name=>(await document.fonts.load('16px '+JSON.stringify(name))).length,name)).toBeGreaterThan(0);await page.screenshot({path:testInfo.outputPath('font-picker-desktop.png')});await page.getByRole('option',{name:'DM Sans Variable',exact:true}).click();const body=page.getByRole('combobox',{name:'Body font',exact:true});await expect(body).toHaveCSS('font-family','"DM Sans", sans-serif');
 await page.locator('[data-appearance-axes="font"] summary').click();await page.locator('[data-appearance-axis="font"][data-font-axis="wght"]').fill('475');await page.locator('[data-appearance-axis="font"][data-font-axis="opsz"]').fill('18');await expect(page.locator('body')).toHaveCSS('font-weight','475');
 await page.getByRole('button',{name:'Save appearance',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();await expect(body).toContainText('DM Sans');expect((await new Workspace(root).read()).book.appearance.fontAxes).toEqual({wght:475,opsz:18});
 await body.focus();await page.keyboard.press('ArrowDown');await page.keyboard.type('Poiret');await page.keyboard.press('Enter');await expect(body).toContainText('Poiret One');await expect(page.locator('[data-appearance-axes="font"] summary')).toHaveCount(0);await body.click();await page.keyboard.press('Escape');await expect(body).toBeFocused();await expect(body).toHaveAttribute('aria-expanded','false');
 await page.evaluate(()=>document.fonts.ready);expect(await page.evaluate(()=>document.fonts.check('16px "Poiret One"'))).toBe(true);expect(errors).toEqual([]);
});
test('a custom variable font is uploaded through Appearance, selected, reopened and exported',async({page})=>{
 await page.locator('[data-font-upload-embed]').check();await page.locator('[data-font-upload]').setInputFiles('src/fonts/dm-sans.ttf');await expect(page.locator('.custom-font-row')).toHaveCount(1);const row=page.locator('.custom-font-row'),id=await row.locator('[data-font-sample]').getAttribute('data-font-sample'),label=await row.locator('strong').textContent();
 await choose(page,'Body font',label+' Custom · Variable');await page.getByRole('button',{name:'Save appearance',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();await expect(page.getByRole('combobox',{name:'Body font',exact:true})).toContainText(label);expect((await new Workspace(root).read()).book.appearance.font).toBe(id);
 expect(await page.evaluate(async id=>{await document.fonts.load('16px "Observanda '+id+'"');return document.fonts.check('16px "Observanda '+id+'"');},id)).toBe(true);
 await navigate(page,'Website editor');await page.getByRole('button',{name:'Preview & export',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await expect(page.getByRole('heading',{name:'Review website'})).toBeVisible();await expect(page.frameLocator('iframe[title="Publication preview"]').locator('body')).toHaveCSS('font-family','"Observanda '+id+'", serif');
 await page.locator('#review-confirm').check();const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Download website ZIP'}).click();const zip=await readFile(await(await downloaded).path());expect(zip.includes(Buffer.from('fonts/'+id+'.ttf'))).toBe(true);expect(errors).toEqual([]);
});
test('phone and zoomed picker stays on screen, invalid uploads show a useful error',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='24px');await page.getByRole('combobox',{name:'Heading font',exact:true}).click();const list=page.getByRole('listbox',{name:'Heading font',exact:true}),box=await list.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(391);expect(box.y+box.height).toBeLessThanOrEqual(845);await page.keyboard.press('Escape');
 await page.locator('[data-font-upload]').setInputFiles({name:'invalid.ttf',mimeType:'font/ttf',buffer:Buffer.from('Not font data')});await expect(page.locator('#notice')).toContainText('This font could not be read safely');await expect(page.locator('.custom-font-row')).toHaveCount(0);expect(errors).toEqual([]);
});

test('website variable settings remain independent from the app and survive export',async({page})=>{
 const original=(await new Workspace(root).read()).book.appearance;
 await navigate(page,'Website editor');await editorTab(page,'Typography');await typeTools(page,'Fonts');
 await choose(page,'Body font','DM Sans Variable');await page.locator('[data-website-axes="font"] summary').click();
 await page.locator('[data-website-axis="font"][data-font-axis="wght"]').fill('450');await page.locator('[data-website-axis="font"][data-font-axis="opsz"]').fill('20');
 const preview=page.frameLocator('#website-draft-preview');await expect(preview.locator('body')).toHaveCSS('font-weight','450');await expect(preview.locator('body')).toHaveCSS('font-variation-settings','"opsz" 20');
 await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();await editorTab(page,'Typography');await typeTools(page,'Fonts');await expect(page.getByRole('combobox',{name:'Body font',exact:true})).toContainText('DM Sans');
 const saved=(await new Workspace(root).read()).book;expect(saved.appearance).toEqual(original);expect(saved.website.typography.fontAxes).toEqual({wght:450,opsz:20});
 await page.getByRole('button',{name:'Preview & export',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();const published=page.frameLocator('iframe[title="Publication preview"]');await expect(published.locator('body')).toHaveCSS('font-weight','450');await expect(published.locator('body')).toHaveCSS('font-variation-settings','"opsz" 20');expect(errors).toEqual([]);
});

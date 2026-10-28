import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {WebsiteSites} from '../../src/website-sites.js';
import {createNotebook} from '../../src/model.js';
import {startServer} from '../../src/server.js';
import {navigate} from './preferences-helper.js';
import {task} from './composer-helper.js';
let app,root,errors,fixture;
const savedBook=async()=>({...((await new WebsiteSites(fixture.workspace).read(null)).book),entries:(await fixture.workspace.read()).book.entries});
const canvas=page=>page.frameLocator('#website-draft-preview');
const area=async(page,value)=>{await task(page,'Page');await page.getByRole('combobox',{name:'Editing area',exact:true}).selectOption(value);};
const save=async page=>{await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');};
const detail=async(page,name)=>{const section=page.locator('.website-region-controls details').filter({has:page.locator('summary').filter({hasText:name})});if(!await section.evaluate(el=>el.open))await section.locator('summary').first().click();};
async function newPage(page,title){await page.getByRole('button',{name:'Add page',exact:true}).click();await page.getByLabel('Page title',{exact:true}).fill(title);const url=await page.getByLabel('Page',{exact:true}).inputValue();await task(page,'Page');await page.locator('[data-palette-kind="heading"]').click();await canvas(page).locator('main .section-heading>.canvas-section-edit').click();await page.getByLabel('Section heading',{exact:true}).fill(title+' introduction');await page.getByRole('button',{name:'Back',exact:true}).click();return url;}
test.beforeEach(async({page})=>{errors=[];page.on('pageerror',e=>errors.push(e.message));root=await mkdtemp(path.join(os.tmpdir(),'observanda-regions-'));const book=createNotebook('Synthetic studio','');book.website.footer='Our studio footer';fixture=await encryptedFixture(root,book);app=await startServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(root,'preferences.json'),port:0});await page.goto(app.url);await navigate(page,'Website editor');});
test.afterEach(async()=>{await app?.close();if(fixture)clearVault(fixture.vault);await rm(root,{recursive:true,force:true});});

test('design and reuse sidebars, make a local copy, author the footer and follow exported section links without scripts',async({page,browser},testInfo)=>{
 test.setTimeout(90000);
 const first=await newPage(page,'Field notes');await area(page,'sidebar');await page.getByRole('button',{name:'Create sidebar',exact:true}).click();
 await expect(canvas(page).locator('.site-sidebar a')).toHaveCount(0);await page.locator('[data-palette-kind="contents"]').click();
 await expect(canvas(page).locator('.site-sidebar .section-index a')).toHaveText(['Field notes introduction']);
 await page.getByLabel('Design name',{exact:true}).fill('Studio navigation');await detail(page,'Reuse this design');await page.getByLabel('Use as site default',{exact:true}).check();
 await detail(page,'Design appearance');await page.getByLabel('Sidebar position',{exact:true}).selectOption('right');await page.getByLabel('Sidebar width (px)',{exact:true}).fill('280');
 await expect(canvas(page).locator('.page-frame')).toHaveClass(/sidebar-right/);
 const second=await newPage(page,'Sound experiments');await area(page,'sidebar');await expect(page.getByLabel('Design for this page',{exact:true})).toHaveValue('inherit');await expect(page.getByLabel('Design name',{exact:true})).toHaveValue('Studio navigation');
 await expect(canvas(page).locator('.site-sidebar .section-index a')).toHaveText(['Sound experiments introduction']);
 await page.getByRole('button',{name:'Make a separate copy for this page',exact:true}).click();await page.getByLabel('Design name',{exact:true}).fill('Sound navigation');
 await page.locator('#website-outline [data-action="website-edit-section"]').first().click();await page.getByLabel('Section heading',{exact:true}).fill('Explore sounds');await page.getByRole('button',{name:'Back',exact:true}).click();
 await expect(page.getByLabel('Editing area',{exact:true})).toHaveValue('sidebar');
 await page.getByLabel('Page',{exact:true}).selectOption(first);await expect(page.getByLabel('Design name',{exact:true})).toHaveValue('Studio navigation');await expect(canvas(page).locator('.site-sidebar h2')).toHaveText('Page contents');
 await area(page,'footer');await page.getByRole('button',{name:'Create footer',exact:true}).click();await detail(page,'Reuse this design');await page.getByLabel('Use as site default',{exact:true}).check();
 await detail(page,'Design appearance');await page.getByLabel('Background',{exact:true}).fill('#142536');await page.getByLabel('Text color',{exact:true}).fill('#ffffff');
 await expect(canvas(page).locator('.site-footer')).toHaveCSS('background-color','rgb(20, 37, 54)');await expect(canvas(page).locator('.site-footer .powered-by a')).toHaveCSS('color','rgb(255, 255, 255)');
 await expect(canvas(page).locator('.site-footer')).toContainText('Our studio footer');await page.locator('[data-palette-kind="text"]').click();await expect(canvas(page).locator('.site-footer .section-text')).toHaveCount(2);await canvas(page).locator('.site-footer .section-text>.canvas-section-edit').last().click();await canvas(page).getByRole('textbox',{name:'Section text',exact:true}).fill('Made with care.');await page.getByRole('navigation',{name:'Section tools',exact:true}).getByRole('button',{name:'Layout',exact:true}).click();
  for(const alignment of ['end','center','start']){await page.getByLabel('Body alignment',{exact:true}).selectOption(alignment);await expect(canvas(page).locator('.site-footer .section-text>.prose').last()).toHaveCSS('text-align',alignment);await expect(canvas(page).locator('.site-footer>.powered-by')).toHaveCSS('text-align',alignment);}
 await page.getByRole('button',{name:'Back',exact:true}).click();await expect(page.getByLabel('Editing area',{exact:true})).toHaveValue('footer');
 await save(page);await page.reload();await expect(page.getByLabel('Editing area',{exact:true})).toHaveValue('footer');await expect(canvas(page).locator('.site-footer')).toContainText('Made with care.');
 await page.getByLabel('Page',{exact:true}).selectOption(second);await expect(page.getByLabel('Editing area',{exact:true})).toHaveValue('sidebar');await expect(canvas(page).locator('.site-sidebar h2')).toHaveText('Explore sounds');
 await page.getByRole('button',{name:'Prepare edition',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible({timeout:30000});await page.getByLabel('Preview page',{exact:true}).selectOption(second);
 const href=await page.locator('#full-public-preview').getAttribute('href'),context=await browser.newContext({javaScriptEnabled:false});await context.addCookies(await page.context().cookies());const visitor=await context.newPage();
 try{await visitor.goto(new URL(href,app.origin).href);const link=visitor.locator('.site-sidebar .section-index a');await link.click();expect(new URL(visitor.url()).hash).toMatch(/^#section-/);await expect(visitor.getByRole('heading',{name:'Sound experiments introduction',exact:true})).toBeInViewport();await expect(visitor.locator('.powered-by')).toHaveCount(1);await expect(visitor.locator('.powered-by')).toHaveCSS('text-align','start');await expect(visitor.locator('.site-footer')).toContainText('Our studio footer');await expect(visitor.locator('.site-footer')).toContainText('Made with care.');
  await visitor.screenshot({path:testInfo.outputPath('regions-desktop.png'),fullPage:true});await visitor.setViewportSize({width:390,height:844});await visitor.evaluate(()=>document.documentElement.style.fontSize='24px');expect(await visitor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await visitor.screenshot({path:testInfo.outputPath('regions-mobile.png'),fullPage:true});
 }finally{await context.close();}
 expect(errors).toEqual([]);
});

test('selected page reuse, uploads and undo keep the editing region separate from page content',async({page})=>{
 test.setTimeout(60000);
 const first=await newPage(page,'One'),second=await newPage(page,'Two');await page.getByLabel('Page',{exact:true}).selectOption(first);await area(page,'sidebar');await page.getByRole('button',{name:'Create sidebar',exact:true}).click();
 await page.locator('[data-palette-kind="contents"]').click();await detail(page,'Reuse this design');await page.getByRole('button',{name:'Choose pages',exact:true}).click();await page.getByRole('dialog').getByRole('checkbox',{name:'Two',exact:true}).check();await page.getByRole('dialog').getByRole('button',{name:'Done',exact:true}).click();
 await page.getByLabel('Upload image, audio or video',{exact:true}).setInputFiles('src/preview-assets/image.png');await expect(canvas(page).locator('.site-sidebar img')).toHaveCount(1);await expect(canvas(page).locator('main img')).toHaveCount(0);
  await canvas(page).locator('.site-sidebar .section-asset>.canvas-section-edit').click();await canvas(page).locator('.site-sidebar img').click();await page.getByLabel('Image proportions',{exact:true}).selectOption('square');await expect(canvas(page).locator('.site-sidebar img')).toHaveCSS('aspect-ratio','1 / 1');
 await page.getByLabel('Page',{exact:true}).selectOption(second);await area(page,'sidebar');await expect(canvas(page).locator('.site-sidebar img')).toHaveCount(1);await expect(canvas(page).locator('.section-index a')).toHaveText(['Two introduction']);await expect(canvas(page).locator('.site-sidebar img')).toHaveCSS('aspect-ratio','1 / 1');
 await page.getByRole('button',{name:'Make a separate copy for this page',exact:true}).click();await expect(page.getByLabel('Design name',{exact:true})).toHaveValue('Sidebar design (copy)');await expect(canvas(page).locator('.site-sidebar img')).toHaveCSS('aspect-ratio','1 / 1');await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.getByLabel('Design name',{exact:true})).toHaveValue('Sidebar design');await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.getByLabel('Design name',{exact:true})).toHaveValue('Sidebar design (copy)');
 await detail(page,'Reuse this design');page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete design',exact:true}).click();await expect(canvas(page).locator('.site-sidebar')).toHaveCount(0);await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.getByLabel('Design name',{exact:true})).toHaveValue('Sidebar design (copy)');await page.getByLabel('Design for this page',{exact:true}).selectOption('none');await expect(canvas(page).locator('.site-sidebar')).toHaveCount(0);await page.getByLabel('Page',{exact:true}).selectOption(first);await expect(canvas(page).locator('.site-sidebar img')).toHaveCount(1);
 await task(page,'Page');await expect(page.locator('#website-outline [data-element-drag]').last()).toBeVisible();await page.locator('#website-outline [data-element-drag]').last().focus();await page.keyboard.press('ArrowUp');await expect(page.locator('#website-outline .section-select').first()).toHaveText('Media');
 await page.screenshot({path:test.info().outputPath('editor-sidebar.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='24px');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await save(page);const saved=(await savedBook());expect(saved.pages.every(p=>p.sections.length===1&&p.sections[0].kind==='heading')).toBe(true);expect(errors).toEqual([]);
});

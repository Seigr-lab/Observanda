import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {navigate} from './preferences-helper.js';
import {task,openPageSettings,chooseWebsitePage} from './composer-helper.js';

let root,app,book,fixture;
test.beforeEach(async({page})=>{
 root=await mkdtemp(path.join(os.tmpdir(),'observanda-page-picker-'));book=upgradeNotebook(sampleNotebook());book.website.home.sections=[];
 const seed=book.entries[0];book.entries=Array.from({length:80},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Page '+String(i).padStart(2,'0'),body:'Original '+i,relations:[],attachments:[],figures:[]}));
 book.pages=Array.from({length:35},(_,i)=>({id:randomUUID(),title:'Site page '+i,body:'',share:false,sections:[]}));
 fixture=await encryptedFixture(root,book);app=await startServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(root,'preferences.json'),port:0});
 await page.goto(app.url);await navigate(page,'Website editor');await expect(page.frameLocator('#website-draft-preview').locator('body')).toHaveAttribute('data-page','home');
});
test.afterEach(async()=>{await app?.close();if(fixture)clearVault(fixture.vault);await rm(root,{recursive:true,force:true});});
const canvas=page=>page.frameLocator('#website-draft-preview');
const selector=page=>page.getByLabel('Page',{exact:true});
const results=page=>page.getByRole('dialog').locator('[data-page-path]');
const pathFor=record=>'entries/'+record.id+'.html';

test('page discovery stays bounded, loads no originals, and preserves selected-page drafts through save and reload',async({page},testInfo)=>{
 test.setTimeout(90000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await task(page,'Site');await page.getByLabel('Website title',{exact:true}).fill('Private draft title');await expect(canvas(page).locator('.site-name')).toHaveText('Private draft title');
 expect(await selector(page).locator('option').count()).toBe(26);
 const record=ResearchCatalogue.prototype.record,loaded=[];
 ResearchCatalogue.prototype.record=async function(id,...args){loaded.push(id);return record.call(this,id,...args);};
 try{
  await selector(page).selectOption('find');const dialog=page.getByRole('dialog');
  await expect(results(page)).toHaveCount(25);await dialog.getByLabel('Page type',{exact:true}).selectOption('entry');
  await expect(dialog.getByRole('status')).toHaveText('1–25 of 80');await expect(results(page)).toHaveCount(25);
  await dialog.getByRole('button',{name:'Next',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('26–50 of 80');
  await dialog.getByRole('button',{name:'Previous',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('1–25 of 80');
  await dialog.getByLabel('Find a page',{exact:true}).fill('Page 64');await expect(results(page)).toHaveCount(1);expect(loaded).toEqual([]);
  await expect(canvas(page).locator('body')).toHaveAttribute('data-page','home');await expect(selector(page)).toHaveValue('index.html');
  await page.screenshot({path:testInfo.outputPath('page-search.png')});
  await results(page).first().click();await expect(dialog).not.toBeVisible();await expect(canvas(page).getByText('Original 64',{exact:true})).toBeVisible();
  expect(loaded).toEqual([book.entries[64].id]);
 }finally{ResearchCatalogue.prototype.record=record;}
 await expect(selector(page)).toHaveValue(pathFor(book.entries[64]));expect(await selector(page).locator('option').count()).toBe(27);
 await openPageSettings(page);await page.getByText('Page header',{exact:true}).click();await page.getByLabel('Display heading',{exact:true}).fill('Retained inspection design');
 await expect(canvas(page).getByRole('heading',{name:'Retained inspection design',exact:true})).toBeVisible();
 await selector(page).selectOption('find');await page.getByRole('dialog').getByLabel('Find a page',{exact:true}).fill('absent');await expect(results(page)).toHaveCount(0);await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();
 await expect(page.getByLabel('Display heading',{exact:true})).toHaveValue('Retained inspection design');await expect(selector(page)).toHaveValue(pathFor(book.entries[64]));
 await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();
 await expect(selector(page)).toHaveValue(pathFor(book.entries[64]));await expect(canvas(page).getByRole('heading',{name:'Retained inspection design',exact:true})).toBeVisible();
 const saved=(await fixture.workspace.read()).book;expect(saved.website.title).toBe('Private draft title');expect(saved.entries).toEqual(book.entries);expect(errors).toEqual([]);
});

test('unsaved pages appear immediately and cancelled or failed searches keep their draft',async({page})=>{
 test.setTimeout(90000);
 await page.getByRole('button',{name:'Add page',exact:true}).click();await page.getByLabel('Page title',{exact:true}).fill('Unsaved apiary page');const path=await selector(page).inputValue();
 await selector(page).selectOption('index.html');await selector(page).selectOption('find');const dialog=page.getByRole('dialog');
 await dialog.getByLabel('Find a page',{exact:true}).fill('Unsaved apiary');await expect(results(page)).toHaveCount(1);await results(page).click();await expect(selector(page)).toHaveValue(path);
 await expect(canvas(page).getByRole('heading',{name:'Unsaved apiary page',exact:true})).toBeVisible();
 let reject=true;await page.route('**/api/research/records/query',route=>reject?(reject=false,route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic search interruption'})})):route.continue());
 await selector(page).selectOption('find');await dialog.getByLabel('Page type',{exact:true}).selectOption('entry');await expect(dialog.getByRole('alert')).toHaveText('Synthetic search interruption');
 await dialog.getByRole('button',{name:'Retry',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('1–25 of 80');await page.unroute('**/api/research/records/query');
 let entered,release;const waiting=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 await page.route('**/api/research/records/query',async route=>{if(route.request().postDataJSON().query.search==='delayed'){entered();await gate;await route.abort().catch(()=>{});}else await route.continue();});
 await dialog.getByLabel('Find a page',{exact:true}).fill('delayed');await waiting;await page.keyboard.press('Escape');
 await expect(dialog).not.toBeVisible();await expect(selector(page)).toHaveValue(path);release();await page.unroute('**/api/research/records/query');
 await expect(canvas(page).getByRole('heading',{name:'Unsaved apiary page',exact:true})).toBeVisible();
 await chooseWebsitePage(page,pathFor(book.entries[64]));await chooseWebsitePage(page,path);
 await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
 expect((await fixture.workspace.read()).book.pages.at(-1).title).toBe('Unsaved apiary page');
});

test('website text links search pinned page summaries without building a full destination list or loading originals',async({page})=>{
 test.setTimeout(60000);
 await page.locator('[data-palette-kind="text"]').click();await canvas(page).locator('.section-text>.canvas-section-edit').click();
 const editor=canvas(page).getByRole('textbox',{name:'Section text',exact:true}),surface=await editor.elementHandle();await editor.fill('Explore these notes');await editor.press('ControlOrMeta+A');
 const record=ResearchCatalogue.prototype.record,loaded=[];
 ResearchCatalogue.prototype.record=async function(id,...args){loaded.push(id);return record.call(this,id,...args);};
 try{
  expect(await page.locator('[data-rich-destination]').count()).toBe(0);
  await page.getByRole('button',{name:'Link',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Link settings',exact:true});
  await expect(dialog.locator('[data-rich-destination]')).toHaveCount(25);
  await dialog.getByRole('button',{name:'Next destinations',exact:true}).click();
  await expect(dialog.locator('[data-rich-destination]')).toHaveCount(38);
  await dialog.getByRole('button',{name:'Previous destinations',exact:true}).click();await expect(dialog.locator('[data-rich-destination]')).toHaveCount(25);
  await dialog.getByLabel('Find link destination',{exact:true}).fill('Page 64');
  await expect(dialog.locator('[data-rich-destination]')).toHaveCount(1);
  await dialog.locator('[data-rich-destination]').click();await expect(dialog.getByLabel('Link address',{exact:true})).toHaveValue('entry:'+book.entries[64].id);
  expect(await surface.evaluate(node=>node.isConnected)).toBe(true);
  await dialog.getByRole('button',{name:'Apply link',exact:true}).click();
  await expect(editor.locator('a')).toHaveAttribute('href','entry:'+book.entries[64].id);
  expect(loaded).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=record;}
 await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();
 await expect(editor.locator('a')).toHaveAttribute('href','entry:'+book.entries[64].id);
 const saved=(await fixture.workspace.read()).book;expect(saved.entries).toEqual(book.entries);expect(JSON.stringify(saved.website.home.sections)).toContain('entry:'+book.entries[64].id);
 await page.getByRole('button',{name:'Prepare edition',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();
 const href=await page.getByRole('link',{name:'Open full preview',exact:true}).getAttribute('href'),published=await page.context().newPage();
 try{await published.goto(new URL(href,app.origin).href);await expect(published.getByRole('link',{name:'Explore these notes',exact:true})).toHaveAttribute('href','entries/'+book.entries[64].id+'.html');}finally{await published.close();}
});

test('region assignments search only one page of labels and preserve exclusions, undo and saved originals',async({page})=>{
 test.setTimeout(90000);
 await task(page,'Page');await page.getByLabel('Editing area',{exact:true}).selectOption('sidebar');await page.getByRole('button',{name:'Create sidebar',exact:true}).click();
 await page.getByText('Reuse this design',{exact:true}).click();
 const choose=page.getByRole('button',{name:'Choose pages',exact:true}),dialog=page.getByRole('dialog'),record=ResearchCatalogue.prototype.record,loaded=[];
 ResearchCatalogue.prototype.record=async function(id,...args){loaded.push(id);return record.call(this,id,...args);};
 try{
  expect(await page.locator('[data-region-page]').count()).toBe(0);await choose.click();
  await expect(dialog.locator('[data-page-selection]')).toHaveCount(25);await expect(dialog.getByRole('checkbox',{name:'Home',exact:true})).toBeChecked();
  await dialog.getByLabel('Page type',{exact:true}).selectOption('entry');await expect(dialog.locator('[data-page-selection]')).toHaveCount(25);
  await dialog.getByLabel('Find a page',{exact:true}).fill('Page 64');await dialog.getByRole('checkbox',{name:/^Page 64/}).check();
  await dialog.getByLabel('Find a page',{exact:true}).fill('Page 75');await dialog.getByRole('checkbox',{name:/^Page 75/}).check();
  await expect(selector(page)).toHaveValue('index.html');await dialog.getByRole('button',{name:'Done',exact:true}).click();await expect(choose).toBeFocused();
  await page.getByRole('button',{name:'Undo',exact:true}).click();await choose.click();await dialog.getByLabel('Page type',{exact:true}).selectOption('entry');
  await dialog.getByLabel('Find a page',{exact:true}).fill('Page 75');await expect(dialog.getByRole('checkbox',{name:/^Page 75/})).not.toBeChecked();
  await dialog.getByLabel('Find a page',{exact:true}).fill('Page 64');await expect(dialog.getByRole('checkbox',{name:/^Page 64/})).toBeChecked();await dialog.getByRole('button',{name:'Done',exact:true}).click();
  await page.getByRole('button',{name:'Redo',exact:true}).click();await page.getByLabel('Use as site default',{exact:true}).check();
  await choose.click();await dialog.getByLabel('Page type',{exact:true}).selectOption('entry');
  await dialog.getByLabel('Find a page',{exact:true}).fill('Page 75');await expect(dialog.getByRole('checkbox',{name:/^Page 75/})).toBeChecked();
  await dialog.getByLabel('Find a page',{exact:true}).fill('Page 64');await dialog.getByRole('checkbox',{name:/^Page 64/}).uncheck();await dialog.getByRole('button',{name:'Done',exact:true}).click();
  expect(loaded).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=record;}
 await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();
 await expect(page.getByLabel('Editing area',{exact:true})).toHaveValue('sidebar');await page.getByText('Reuse this design',{exact:true}).click();await choose.click();await dialog.getByLabel('Page type',{exact:true}).selectOption('entry');
 await dialog.getByLabel('Find a page',{exact:true}).fill('Page 64');await expect(dialog.getByRole('checkbox',{name:/^Page 64/})).not.toBeChecked();await page.keyboard.press('Escape');await expect(choose).toBeFocused();
 const saved=(await fixture.workspace.read()).book,regions=saved.website.design.regions,id=regions.definitions[0].id;
 expect(regions.assignments).toEqual(expect.arrayContaining([{target:'*',kind:'sidebar',regionId:id},{target:'entry:'+book.entries[64].id,kind:'sidebar',regionId:null},{target:'entry:'+book.entries[75].id,kind:'sidebar',regionId:id}]));
 expect(saved.entries).toEqual(book.entries);
 await chooseWebsitePage(page,pathFor(book.entries[64]));await expect(canvas(page).locator('.site-sidebar')).toHaveCount(0);
 await chooseWebsitePage(page,pathFor(book.entries[75]));await expect(canvas(page).locator('.site-sidebar')).toHaveCount(1);
});

test('image and button links choose indexed pages in place and retain manual addresses and undo',async({page})=>{
 test.setTimeout(90000);
 await page.getByLabel('Upload image, audio or video',{exact:true}).setInputFiles('src/preview-assets/image.png');
 await expect(canvas(page).locator('.section-asset img')).toHaveCount(1);await canvas(page).locator('.section-asset>.canvas-section-edit').click();await canvas(page).locator('.section-asset img').click();
 await page.getByRole('navigation',{name:'Media tools',exact:true}).getByRole('button',{name:'Link',exact:true}).click();
 const address=page.getByLabel('Image link',{exact:true}),dialog=page.getByRole('dialog'),record=ResearchCatalogue.prototype.record,loaded=[];
 await address.fill('https://example.org/original');
 ResearchCatalogue.prototype.record=async function(id,...args){loaded.push(id);return record.call(this,id,...args);};
 try{
  expect(await page.locator('#media-link-targets').count()).toBe(0);await page.getByRole('button',{name:'Choose page link',exact:true}).click();
  await expect(results(page)).toHaveCount(25);await page.keyboard.press('Escape');await expect(address).toBeFocused();await expect(address).toHaveValue('https://example.org/original');
  await page.getByRole('button',{name:'Choose page link',exact:true}).click();await dialog.getByLabel('Page type',{exact:true}).selectOption('entry');await dialog.getByLabel('Find a page',{exact:true}).fill('Page 64');await results(page).click();
  await expect(address).toHaveValue('entry:'+book.entries[64].id);await expect(address).toBeFocused();await expect(selector(page)).toHaveValue('index.html');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(address).toHaveValue('https://example.org/original');await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(address).toHaveValue('entry:'+book.entries[64].id);
  await task(page,'Page');await page.locator('[data-palette-kind="link"]').click();await canvas(page).locator('.section-link>.canvas-section-edit').click();
  await page.getByLabel('Link label',{exact:true}).fill('Read the notes');await page.getByRole('button',{name:'Choose page link',exact:true}).click();await dialog.getByLabel('Page type',{exact:true}).selectOption('entry');await dialog.getByLabel('Find a page',{exact:true}).fill('Page 75');await results(page).click();
  await expect(page.getByLabel('Link destination',{exact:true})).toHaveValue('entry:'+book.entries[75].id);await expect(page.getByLabel('Link destination',{exact:true})).toBeFocused();expect(loaded).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=record;}
 await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();
 const saved=(await fixture.workspace.read()).book;expect(saved.website.presentation.media.some(m=>m.link==='entry:'+book.entries[64].id)).toBe(true);expect(saved.website.home.sections.some(s=>s.kind==='link'&&s.href==='entry:'+book.entries[75].id)).toBe(true);expect(saved.entries).toEqual(book.entries);
 await page.getByRole('button',{name:'Prepare edition',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();
 const href=await page.getByRole('link',{name:'Open full preview',exact:true}).getAttribute('href'),published=await page.context().newPage();
 try{await published.goto(new URL(href,app.origin).href);await expect(published.locator('.section-asset a')).toHaveAttribute('href','entries/'+book.entries[64].id+'.html');await expect(published.getByRole('link',{name:'Read the notes',exact:true})).toHaveAttribute('href','entries/'+book.entries[75].id+'.html');}finally{await published.close();}
});

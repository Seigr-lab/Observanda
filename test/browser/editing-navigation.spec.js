import {task,editorTab,openPageSettings} from './composer-helper.js';
import {navigate,preferences,editWorkspace} from './preferences-helper.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startServer} from '../../src/server.js';
import {Workspace} from '../../src/storage.js';
import {sampleNotebook} from '../../src/sample.js';
import {proseText} from '../../src/web/prose-model.js';
let app,root,parent,book;
test.beforeEach(async({page})=>{parent=await mkdtemp(path.join(os.tmpdir(),'observanda-editing-'));root=path.join(parent,'book');book={...sampleNotebook(),title:'book'};await new Workspace(root).create(book);app=await startServer({root,port:0,preferencesFile:path.join(parent,'preferences.json')});await page.goto(app.url);});
test.afterEach(async()=>{await app.close();if(path.dirname(parent)===path.resolve(os.tmpdir()))await rm(parent,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const guard=page=>page.getByRole('dialog',{name:'Unsaved changes',exact:true});
const choose=(page,name)=>guard(page).getByRole('button',{name,exact:true}).click();
async function editRecord(page){await navigate(page,'All records');await page.getByRole('button',{name:'Watching a seed unfold',exact:true}).click();await page.getByRole('button',{name:'Edit record',exact:true}).click();await expect(page).toHaveURL(/#\/records\/[a-f0-9-]+$/);}
async function range(control,value){await control.evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);}

test('leaving an editor offers Stay, Discard and Save without carrying mistakes into other sections',async({page})=>{
  const raw=await readFile(path.join(root,'observanda.json'),'utf8');await editRecord(page);
  const original=book.entries.find(e=>e.title==='Watching a seed unfold').body;
  await page.getByLabel('Summary / context').fill('An unwanted change');await navigate(page,'Website editor');
  await expect(guard(page)).toBeVisible();await choose(page,'Stay here');await expect(page.getByLabel('Summary / context')).toHaveText('An unwanted change');expect(await readFile(path.join(root,'observanda.json'),'utf8')).toBe(raw);
  await navigate(page,'Website editor');await choose(page,'Discard changes');await expect(page.getByRole('heading',{name:'Website',exact:true})).toBeVisible();
  await task(page,'Page');await page.getByLabel('Editing area',{exact:true}).selectOption('footer');await page.getByLabel('Footer text').fill('Intended footer');await navigate(page,'Preferences');await choose(page,'Save and continue');await preferences(page,'Appearance');
  await expect(page.getByRole('heading',{name:'Appearance',exact:true})).toBeVisible();
  const saved=(await new Workspace(root).read()).book;expect(saved.website.footer).toBe('Intended footer');expect(saved.entries.find(e=>e.title==='Watching a seed unfold').body).toBe(original);
  await page.getByRole('button',{name:/Studio/}).click();await navigate(page,'Projects');await choose(page,'Discard changes');
  await expect(page.locator('html')).toHaveAttribute('data-theme','research');
});

test('failed saves keep the decision open and preserve the draft for correction or retry',async({page})=>{
  await editRecord(page);await page.getByLabel('Record title').fill('Keep this draft');
  await page.route('**/api/research/records/save',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic write failure'})}));
  await navigate(page,'Projects');await choose(page,'Save and continue');
  await expect(guard(page).getByRole('alert')).toHaveText('Synthetic write failure');await expect(page.getByLabel('Record title')).toHaveValue('Keep this draft');
  await page.unroute('**/api/research/records/save');await choose(page,'Save and continue');await expect(page.getByRole('heading',{name:'Projects',exact:true})).toBeVisible();
  expect((await new Workspace(root).read()).book.entries.some(e=>e.title==='Keep this draft')).toBe(true);
});

test('Back, Forward and direct hash navigation preserve routes when staying and resolve drafts before leaving',async({page})=>{
  await editRecord(page);const recordURL=page.url();await page.getByLabel('Summary / context').fill('Back draft');
  await page.evaluate(()=>history.back());await expect(guard(page)).toBeVisible();await choose(page,'Stay here');await expect(page).toHaveURL(recordURL);await expect(page.getByLabel('Summary / context')).toHaveText('Back draft');
  await page.evaluate(()=>history.back());await choose(page,'Discard changes');await expect(page).toHaveURL(/#\/records\/[a-f0-9-]+\/read$/);
  await page.evaluate(()=>history.forward());await expect(page).toHaveURL(recordURL);await expect(page.getByLabel('Summary / context')).not.toHaveText('Back draft');
  await page.getByLabel('Summary / context').fill('Hash draft');await page.evaluate(()=>{location.hash='#/appearance';});await choose(page,'Stay here');await expect(page).toHaveURL(recordURL);
  await page.evaluate(()=>{location.hash='#/appearance';});await choose(page,'Save and continue');await expect(page).toHaveURL(/#\/appearance$/);expect(proseText((await new Workspace(root).read()).book.entries.find(e=>e.title==='Watching a seed unfold').body)).toBe('Hash draft');
});

test('publishing and local access forms cannot silently lose or carry unsaved fields',async({page})=>{
  await preferences(page,'Integrations');await page.getByLabel('GitHub owner / organization').fill('discard-me');
  await navigate(page,'Projects');await choose(page,'Stay here');await expect(page.getByLabel('GitHub owner / organization')).toHaveValue('discard-me');
  await navigate(page,'Projects');await choose(page,'Discard changes');await preferences(page,'Integrations');await expect(page.getByLabel('GitHub owner / organization')).toHaveValue('');
  await preferences(page,'Storage & access');await page.getByRole('button',{name:'Create encrypted copy',exact:true}).click();await page.getByLabel('Workspace folder').fill('Unsubmitted location');
  await page.keyboard.press('Escape');await choose(page,'Stay here');await expect(page.getByLabel('Workspace folder')).toHaveValue('Unsubmitted location');
  await page.keyboard.press('Escape');await choose(page,'Discard changes');await page.getByRole('button',{name:'Create encrypted copy',exact:true}).click();await expect(page.getByLabel('Workspace folder')).toHaveValue('');
});

test('inline workspace details protect edits and invalid forms cannot be saved by navigating away',async({page})=>{
  await editWorkspace(page);const form=page.locator('#workspace-name-form');
  await form.getByLabel('Workspace name',{exact:true}).fill('Changed workspace');await preferences(page,'Appearance');await choose(page,'Stay here');await expect(form.getByLabel('Workspace name',{exact:true})).toHaveValue('Changed workspace');
  await preferences(page,'Appearance');await choose(page,'Discard changes');await expect(page.locator('.workspace-name')).toHaveText(book.title);
  await editWorkspace(page);await page.getByLabel('Workspace name',{exact:true}).fill('');await preferences(page,'Appearance');await choose(page,'Save and continue');await expect(guard(page).getByRole('alert')).toContainText('required fields');
  await choose(page,'Stay here');await page.getByLabel('Workspace name',{exact:true}).fill('Saved through prompt');await preferences(page,'Appearance');await choose(page,'Save and continue');await expect(page.locator('.workspace-name')).toHaveText('Saved through prompt');
});

test('workspace switching asks before saving and does not implicitly persist the active draft',async({page})=>{
  const before=await readFile(path.join(root,'observanda.json'),'utf8');await editRecord(page);await page.getByLabel('Summary / context').fill('Do not persist on switching');
  await page.getByRole('button',{name:'Workspaces',exact:true}).click();await choose(page,'Stay here');await expect(page.getByLabel('Summary / context')).toHaveText('Do not persist on switching');
  await page.getByRole('button',{name:'Workspaces',exact:true}).click();await choose(page,'Discard changes');await expect(page.getByRole('heading',{name:'Workspaces',exact:true})).toBeVisible();expect(await readFile(path.join(root,'observanda.json'),'utf8')).toBe(before);
});

test('menu placement, size, visibility and ordering are previewable, discardable and persist only when saved',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await expect(page.getByText('Publish selected website content.',{exact:true})).toHaveCount(0);
  await preferences(page,'Appearance');await page.getByRole('button',{name:'App layout',exact:true}).click();const layout=page.getByRole('dialog',{name:'App layout',exact:true});
  await layout.getByLabel('Menu position').selectOption('right');await range(layout.getByRole('slider',{name:/Side menu width/}),330);
  await layout.getByRole('button',{name:'Move Website earlier',exact:true}).click();await layout.getByRole('button',{name:'Move Website earlier',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-navigation','right');expect(await page.locator('html').evaluate(el=>el.style.getPropertyValue('--app-navigation-width'))).toBe('330px');
  expect(await page.locator('#workspace-navigation > [data-nav-section]').evaluateAll(els=>els.map(el=>el.dataset.navSection))).toEqual(['website','projects','workspace']);
  await layout.getByRole('button',{name:'Done',exact:true}).click();await choose(page,'Discard changes');await expect(page.locator('html')).toHaveAttribute('data-navigation','left');
  await preferences(page,'Appearance');await page.getByRole('button',{name:'App layout',exact:true}).click();await layout.getByLabel('Menu position').selectOption('top');await layout.getByRole('button',{name:'Move Website earlier',exact:true}).click();await layout.getByRole('button',{name:'Save app settings',exact:true}).click();await layout.getByRole('button',{name:'Done',exact:true}).click();
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-navigation','top');await expect(page.locator('#workspace-navigation > [data-nav-section]')).toHaveCount(3);expect(await page.locator('#workspace-navigation > [data-nav-section]').evaluateAll(els=>els.map(el=>el.dataset.navSection))).toEqual(['website','projects','workspace']);
  await page.screenshot({path:test.info().outputPath('menu-top.png'),fullPage:true});
  await page.getByRole('button',{name:'App layout',exact:true}).click();await layout.getByLabel('Hide the menu until I need it').check();await layout.getByRole('button',{name:'Save app settings',exact:true}).click();await layout.getByRole('button',{name:'Done',exact:true}).click();await expect(page.locator('.sidebar')).toBeHidden();await page.getByRole('button',{name:'Menu',exact:true}).click();await expect(page.locator('.sidebar')).toBeVisible();
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.getByRole('button',{name:'Menu',exact:true}).click();await expect(page.getByRole('button',{name:'Projects',exact:true})).toBeVisible();expect(errors).toEqual([]);
});


test('failed website saves retain page drafts; repeated saves never duplicate a page and discard removes failed edits',async({page})=>{
  await navigate(page,'Website editor');await page.getByRole('button',{name:'Add page',exact:true}).click();
  await page.getByLabel('Page title',{exact:true}).fill('One saved page');await page.getByLabel('Page introduction',{exact:true}).fill('Original content');
  let release;const waiting=new Promise(resolve=>{release=resolve;});await page.route('**/api/notebook/save',async route=>{await waiting;await route.continue();});
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.getByRole('button',{name:'Save website',exact:true})).toBeDisabled();release();
  await expect(page.locator('#save-status')).toHaveText('Saved');await page.unroute('**/api/notebook/save');
  let saved=(await new Workspace(root).read()).book;expect(saved.pages).toHaveLength(1);
  await page.getByLabel('Page title',{exact:true}).fill('Unwanted failed edit');
  await page.route('**/api/notebook/save',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic form write failure'})}));
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#notice')).toContainText('Synthetic form write failure');await expect(page.getByLabel('Page title',{exact:true})).toHaveValue('Unwanted failed edit');
  await page.getByRole('button',{name:'Discard changes',exact:true}).click();await page.unroute('**/api/notebook/save');
  await task(page,'Page');await page.getByLabel('Editing area',{exact:true}).selectOption('footer');await page.getByLabel('Footer text').fill('A separate intended change');await page.locator('.section-save [data-action=save]').click();await expect(page.locator('#save-status')).toHaveText('Saved');saved=(await new Workspace(root).read()).book;expect(saved.pages).toHaveLength(1);expect(saved.pages[0].title).toBe('One saved page');
});

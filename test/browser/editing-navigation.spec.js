import {task} from './composer-helper.js';
import {navigate,preferences,editWorkspace,openDefaultWebsite} from './preferences-helper.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {WebsiteSites} from '../../src/website-sites.js';
import {sampleNotebook} from '../../src/sample.js';
let app,parent,book,fixture;
test.beforeEach(async({page})=>{test.setTimeout(90000);page.setDefaultTimeout(10000);parent=await mkdtemp(path.join(os.tmpdir(),'observanda-editing-'));const seed=sampleNotebook();seed.title='workspace';fixture=await encryptedFixture(parent,seed);book=(await fixture.workspace.read()).book;app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile:path.join(parent,'preferences.json')});await page.goto(app.url);});
test.afterEach(async()=>{await app?.close();clearVault(fixture?.vault);if(parent&&path.dirname(parent)===path.resolve(os.tmpdir()))await rm(parent,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const guard=page=>page.getByRole('dialog',{name:'Unsaved changes',exact:true});
const choose=(page,name)=>guard(page).getByRole('button',{name,exact:true}).click();
async function editWebsite(page){await navigate(page,'Website editor');await page.getByRole('button',{name:'Add page',exact:true}).click();await page.getByLabel('Page title',{exact:true}).fill('Navigation page');await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');}
async function range(control,value){await control.evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);}

test('leaving an editor offers Stay, Discard and Save without carrying mistakes into other sections',async({page})=>{
  const raw=(await fixture.workspace.outline()).etag;await editWebsite(page);
  await page.getByLabel('Page title',{exact:true}).fill('An unwanted change');await navigate(page,'Preferences');
  await expect(guard(page)).toBeVisible();await choose(page,'Stay here');await expect(page.getByLabel('Page title',{exact:true})).toHaveValue('An unwanted change');expect((await fixture.workspace.outline()).etag).toBe(raw);
  await navigate(page,'Preferences');await choose(page,'Discard changes');await navigate(page,'Website editor');
  await expect(page.getByLabel('Page title',{exact:true})).toHaveValue('Navigation page');
  await task(page,'Page');await page.getByLabel('Editing area',{exact:true}).selectOption('footer');await page.getByLabel('Footer text').fill('Intended footer');await navigate(page,'Preferences');await choose(page,'Save and continue');await preferences(page,'Appearance');
  await expect(page.getByRole('heading',{name:'Appearance',exact:true})).toBeVisible();
  expect((await new WebsiteSites(fixture.workspace).read(null)).book.website.footer).toBe('Intended footer');expect((await fixture.workspace.outline()).etag).toBe(raw);
  await page.getByRole('button',{name:/Studio/}).click();await navigate(page,'Projects');await choose(page,'Discard changes');
  await expect(page.locator('html')).toHaveAttribute('data-theme','research');
});

test('failed saves keep the decision open and preserve the draft for correction or retry',async({page})=>{
  await editWebsite(page);await page.getByLabel('Page title',{exact:true}).fill('Keep this draft');
  await page.route('**/api/websites/editor/save',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic write failure'})}));
  await navigate(page,'Projects');await choose(page,'Save and continue');
  await expect(guard(page).getByRole('alert')).toHaveText('Synthetic write failure');await expect(page.getByLabel('Page title',{exact:true})).toHaveValue('Keep this draft');
  await page.unroute('**/api/websites/editor/save');await choose(page,'Save and continue');await expect(page.getByRole('heading',{name:'Projects',exact:true})).toBeVisible();
  expect((await new WebsiteSites(fixture.workspace).read(null)).book.pages[0].title).toBe('Keep this draft');
});

test('Back, Forward and direct hash navigation preserve routes when staying and resolve drafts before leaving',async({page})=>{
  await editWebsite(page);await page.getByRole('button',{name:'Websites',exact:true}).click();await openDefaultWebsite(page);const editorURL=page.url();await page.getByLabel('Page title',{exact:true}).fill('Back draft');
  await page.evaluate(()=>history.back());await expect(guard(page)).toBeVisible();await choose(page,'Stay here');await expect(page).toHaveURL(editorURL);await expect(page.getByLabel('Page title',{exact:true})).toHaveValue('Back draft');
  await page.evaluate(()=>history.back());await choose(page,'Discard changes');await expect(page.getByRole('heading',{name:'Websites',exact:true})).toBeVisible();
  await page.evaluate(()=>history.forward());await expect(page).toHaveURL(editorURL);await expect(page.getByLabel('Page title',{exact:true})).toHaveValue('Navigation page');
  await page.getByLabel('Page title',{exact:true}).fill('Hash draft');await page.evaluate(()=>{location.hash='#/projects';});await choose(page,'Stay here');await expect(page).toHaveURL(editorURL);
  await page.evaluate(()=>{location.hash='#/projects';});await choose(page,'Save and continue');await expect(page).toHaveURL(/#\/projects$/);expect((await new WebsiteSites(fixture.workspace).read(null)).book.pages[0].title).toBe('Hash draft');
});

test('publishing and local access forms cannot silently lose or carry unsaved fields',async({page})=>{
  await preferences(page,'Integrations');await page.getByLabel('GitHub owner / organization').fill('discard-me');
  await navigate(page,'Projects');await choose(page,'Stay here');await expect(page.getByLabel('GitHub owner / organization')).toHaveValue('discard-me');
  await navigate(page,'Projects');await choose(page,'Discard changes');await preferences(page,'Integrations');await expect(page.getByLabel('GitHub owner / organization')).toHaveValue('');
  await preferences(page,'Storage & access');await page.getByLabel('Username (optional)').fill('Unsubmitted account');
  await navigate(page,'Projects');await choose(page,'Stay here');await expect(page.getByLabel('Username (optional)')).toHaveValue('Unsubmitted account');
  await navigate(page,'Projects');await choose(page,'Discard changes');await preferences(page,'Storage & access');await expect(page.getByLabel('Username (optional)')).toHaveValue('');
});

test('inline workspace details protect edits and invalid forms cannot be saved by navigating away',async({page})=>{
  await editWorkspace(page);const form=page.locator('#workspace-name-form');
  await form.getByLabel('Workspace name',{exact:true}).fill('Changed workspace');await preferences(page,'Appearance');await choose(page,'Stay here');await expect(form.getByLabel('Workspace name',{exact:true})).toHaveValue('Changed workspace');
  await preferences(page,'Appearance');await choose(page,'Discard changes');await expect(page.locator('.workspace-name')).toHaveText(book.title);
  await editWorkspace(page);await page.getByLabel('Workspace name',{exact:true}).fill('');await preferences(page,'Appearance');await choose(page,'Save and continue');await expect(guard(page).getByRole('alert')).toContainText('required fields');
  await choose(page,'Stay here');await page.getByLabel('Workspace name',{exact:true}).fill('Saved through prompt');await preferences(page,'Appearance');await choose(page,'Save and continue');await expect(page.locator('.workspace-name')).toHaveText('Saved through prompt');
});

test('workspace switching asks before saving and does not implicitly persist the active draft',async({page})=>{
  const before=(await fixture.workspace.outline()).etag;await editWebsite(page);await page.getByLabel('Page title',{exact:true}).fill('Do not persist on switching');
  await page.getByRole('button',{name:'Workspaces',exact:true}).click();await choose(page,'Stay here');await expect(page.getByLabel('Page title',{exact:true})).toHaveValue('Do not persist on switching');
  await page.getByRole('button',{name:'Workspaces',exact:true}).click();await choose(page,'Discard changes');await expect(page.getByRole('heading',{name:'Workspaces',exact:true})).toBeVisible();expect((await fixture.workspace.outline()).etag).toBe(before);expect((await new WebsiteSites(fixture.workspace).read(null)).book.pages[0].title).toBe('Navigation page');
});

test('menu placement, size, visibility and ordering are previewable, discardable and persist only when saved',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await expect(page.getByText('Publish selected website content.',{exact:true})).toHaveCount(0);
  await preferences(page,'Appearance');await page.getByRole('button',{name:'App layout',exact:true}).click();const layout=page.getByRole('dialog',{name:'App layout',exact:true});
  await layout.getByLabel('Menu position').selectOption('right');await range(layout.getByRole('slider',{name:/Side menu width/}),330);
  await layout.getByRole('button',{name:'Move Website earlier',exact:true}).click();await layout.getByRole('button',{name:'Move Website earlier',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-navigation','right');expect(await page.locator('html').evaluate(el=>el.style.getPropertyValue('--app-navigation-width'))).toBe('330px');
  expect(await page.locator('#workspace-navigation > [data-nav-section]').evaluateAll(els=>els.map(el=>el.dataset.navSection))).toEqual(['website','projects','workspace']);
  await layout.getByRole('button',{name:'Done',exact:true}).click();await choose(page,'Discard changes');await expect(page.locator('html')).toHaveAttribute('data-navigation','left');
  await preferences(page,'Appearance');await page.getByRole('button',{name:'App layout',exact:true}).click();await layout.getByLabel('Menu position').selectOption('top');await layout.getByRole('button',{name:'Move Website earlier',exact:true}).click();await layout.getByRole('button',{name:'Save app settings',exact:true}).click();await expect(layout.locator('[data-interface-status]')).not.toContainText(/Saving|Unsaved/);await layout.getByRole('button',{name:'Done',exact:true}).click();
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-navigation','top');await expect(page.locator('#workspace-navigation > [data-nav-section]')).toHaveCount(3);expect(await page.locator('#workspace-navigation > [data-nav-section]').evaluateAll(els=>els.map(el=>el.dataset.navSection))).toEqual(['website','projects','workspace']);
  await page.screenshot({path:test.info().outputPath('menu-top.png'),fullPage:true});
  await page.getByRole('button',{name:'App layout',exact:true}).click();await layout.getByLabel('Hide the menu until I need it').check();await layout.getByRole('button',{name:'Save app settings',exact:true}).click();await expect(layout.locator('[data-interface-status]')).not.toContainText(/Saving|Unsaved/);await layout.getByRole('button',{name:'Done',exact:true}).click();await expect(page.locator('.sidebar')).toBeHidden();await page.getByRole('button',{name:'Menu',exact:true}).click();await expect(page.locator('.sidebar')).toBeVisible();
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.getByRole('button',{name:'Menu',exact:true}).click();await expect(page.getByRole('button',{name:'Projects',exact:true})).toBeVisible();expect(errors).toEqual([]);
});


test('failed website saves retain page drafts; repeated saves never duplicate a page and discard removes failed edits',async({page})=>{
  await navigate(page,'Website editor');await page.getByRole('button',{name:'Add page',exact:true}).click();
  await page.getByLabel('Page title',{exact:true}).fill('One saved page');await page.getByLabel('Page introduction',{exact:true}).fill('Original content');
  let release;const waiting=new Promise(resolve=>{release=resolve;});await page.route('**/api/websites/editor/save',async route=>{await waiting;await route.continue();});
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.getByRole('button',{name:'Save website',exact:true})).toBeDisabled();release();
  await expect(page.locator('#save-status')).toHaveText('Saved');await page.unroute('**/api/websites/editor/save');
  let saved=(await new WebsiteSites(fixture.workspace).read(null)).book;expect(saved.pages).toHaveLength(1);
  await page.getByLabel('Page title',{exact:true}).fill('Unwanted failed edit');
  await page.route('**/api/websites/editor/save',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic form write failure'})}));
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#notice')).toContainText('Synthetic form write failure');await expect(page.getByLabel('Page title',{exact:true})).toHaveValue('Unwanted failed edit');
  await page.getByRole('button',{name:'Discard changes',exact:true}).click();await expect(page.getByLabel('Page title',{exact:true})).toHaveValue('One saved page');await page.unroute('**/api/websites/editor/save');
  await task(page,'Page');await page.getByLabel('Editing area',{exact:true}).selectOption('footer');await page.getByLabel('Footer text').fill('A separate intended change');await page.locator('.section-save [data-action=save]').click();await expect(page.locator('#save-status')).toHaveText('Saved');saved=(await new WebsiteSites(fixture.workspace).read(null)).book;expect(saved.pages).toHaveLength(1);expect(saved.pages[0].title).toBe('One saved page');
});


test('automatic website previews and appearance choices do not add browser history entries',async({page})=>{
  await editWebsite(page);
  const editorURL=page.url();await page.locator('.website-site-context').getByRole('button',{name:'Appearance',exact:true}).click();
  const frame=page.locator('#design-preview'),selector=page.getByLabel('Preview content',{exact:true});
  await expect(frame.contentFrame().locator('main')).toBeVisible();await expect(selector).toBeEnabled();
  const historyLength=await page.evaluate(()=>history.length);
  for(const mode of ['examples','website']){
    const pending=page.waitForResponse(response=>response.url().includes('/api/appearance-preview')&&response.request().method()==='POST');
    await selector.selectOption(mode);const result=await (await pending).json();
    await expect.poll(()=>frame.evaluate(el=>el.contentWindow.location.pathname)).toContain(result.baseUrl);
    await expect(frame.contentFrame().locator('main')).toBeVisible();
    expect(await page.evaluate(()=>history.length)).toBe(historyLength);
    if(mode==='examples'){
      const pages=page.getByLabel('Preview page',{exact:true}),current=await pages.inputValue(),choices=await pages.locator('option').evaluateAll(options=>options.map(option=>option.value));
      expect(choices.length).toBeGreaterThan(1);const next=choices.find(value=>value!==current);await pages.selectOption(next);
      await expect.poll(()=>frame.evaluate(el=>el.contentWindow.location.pathname)).toBe(result.baseUrl+next);
      expect(await page.evaluate(()=>history.length)).toBe(historyLength);
    }
  }
  await page.evaluate(()=>history.back());await expect(page).toHaveURL(editorURL);await expect(page.getByRole('heading',{name:'Website',exact:true})).toBeVisible();
});

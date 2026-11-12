import {navigate,preferences,editWorkspace,openDefaultWebsite} from './preferences-helper.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {sampleNotebook} from '../../src/sample.js';
let app,parent,book,fixture;
test.beforeEach(async({page})=>{test.setTimeout(90000);page.setDefaultTimeout(10000);parent=await mkdtemp(path.join(os.tmpdir(),'observanda-editing-'));const seed=sampleNotebook();seed.title='workspace';fixture=await encryptedFixture(parent,seed);book=(await fixture.workspace.read()).book;app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile:path.join(parent,'preferences.json')});await page.goto(app.url);});
test.afterEach(async()=>{await app?.close();await clearVault(fixture?.vault);if(parent&&path.dirname(parent)===path.resolve(os.tmpdir()))await rm(parent,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
const guard=page=>page.getByRole('dialog',{name:'Unsaved changes',exact:true});
const choose=(page,name)=>guard(page).getByRole('button',{name,exact:true}).click();
async function range(control,value){await control.evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);}
// App layout is an App appearance setting, inside its App layout disclosure.
async function openAppLayout(page){
 await preferences(page,'App appearance');const disclosure=page.locator('details[data-disclosure="app-layout"]');
 if(!await disclosure.evaluate(node=>node.open))await disclosure.locator(':scope > summary').click();
 await page.getByRole('button',{name:'App layout',exact:true}).click();
}
// The website editor is the website files editor, a screen of its own. Leaving it
// with unsaved changes asks to save them; Cancel keeps the editor open, and its own
// Discard changes command removes a draft. Saved pages are read from the file store.
const files=page=>page.locator('#main[data-website-files-app]');
const canvas=page=>page.frameLocator('#website-files-canvas');
const filesStatus=page=>page.locator('[data-website-files-status]');
const leaveQuestion=page=>page.getByRole('dialog',{name:'Save website changes before leaving? Cancel keeps the editor open.',exact:true});
const savedPage=async id=>(await new WebsiteFileStore(fixture.workspace).open(id)).html;
const occurrences=(html,text)=>html.split(text).length-1;
async function openWebsite(page){await navigate(page,'Website editor');return openDefaultWebsite(page);}
async function write(page,text){
 await files(page).locator('[data-website-file-block]').selectOption('paragraph');await files(page).getByRole('button',{name:'Insert element',exact:true}).click();
 const paragraph=canvas(page).getByText('Write your text here.',{exact:true});await expect(paragraph).toHaveCount(1);
 await paragraph.click();await page.keyboard.press('End');await page.keyboard.type(' '+text);
 await expect(canvas(page).getByText(text)).toBeVisible();await expect(filesStatus(page)).toHaveText('Unsaved website changes');
}
async function saveWebsite(page){await files(page).getByRole('button',{name:'Save website',exact:true}).click();await expect(filesStatus(page)).toHaveText('Website saved.');}
async function editWebsite(page){const id=await openWebsite(page);await write(page,'Navigation page');await saveWebsite(page);expect(await savedPage(id)).toContain('Navigation page');return id;}
async function backToWorkspace(page){await files(page).getByRole('button',{name:'Back to workspace',exact:true}).click();}
async function discardEdits(page){
 await files(page).locator('.website-authoring-tools').getByRole('button',{name:'Discard changes',exact:true}).click();
 await page.getByRole('dialog',{name:'Discard your unsaved website changes?',exact:true}).getByRole('button',{name:'Discard changes',exact:true}).click();
 await expect(filesStatus(page)).toHaveText('Website saved.');
}
const inWorkspace=page=>expect(page.getByRole('button',{name:'Menu',exact:true})).toBeVisible();

test('leaving the website editor asks to save, keeps the draft on Cancel and carries no discarded edit into other sections',async({page})=>{
  const id=await editWebsite(page);
  await write(page,'An unwanted change');await backToWorkspace(page);await leaveQuestion(page).getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(leaveQuestion(page)).toHaveCount(0);await expect(canvas(page).getByText('An unwanted change')).toBeVisible();expect(await savedPage(id)).not.toContain('An unwanted change');
  await discardEdits(page);await expect(canvas(page).getByText('An unwanted change')).toHaveCount(0);await expect(canvas(page).getByText('Navigation page')).toBeVisible();
  await write(page,'Intended change');await backToWorkspace(page);await leaveQuestion(page).getByRole('button',{name:'Save and leave',exact:true}).click();
  await inWorkspace(page);const html=await savedPage(id);expect(html).toContain('Intended change');expect(html).not.toContain('An unwanted change');
  // A website design choice is a draft of the website: leaving offers to discard it.
  await preferences(page,'Appearance');await expect(page.getByRole('heading',{level:1,name:'Website design',exact:true})).toBeVisible();
  await page.getByRole('button',{name:/Studio Spacious cards/}).click();await navigate(page,'Projects');await choose(page,'Discard changes');
  await expect(page.locator('html')).toHaveAttribute('data-theme','research');
});

test('a failed save keeps the website editor and its draft open for correction or retry',async({page})=>{
  const id=await editWebsite(page);await write(page,'Keep this draft');
  await page.context().route('**/api/website-files/save',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic write failure'})}));
  await backToWorkspace(page);await leaveQuestion(page).getByRole('button',{name:'Save and leave',exact:true}).click();
  await expect(page.locator('#notice [role=alert]')).toHaveText('Synthetic write failure');await expect(files(page)).toBeVisible();
  await expect(canvas(page).getByText('Keep this draft')).toBeVisible();await expect(filesStatus(page)).toHaveText('Unsaved website changes');expect(await savedPage(id)).not.toContain('Keep this draft');
  await page.context().unroute('**/api/website-files/save');await backToWorkspace(page);await leaveQuestion(page).getByRole('button',{name:'Save and leave',exact:true}).click();
  await inWorkspace(page);expect(await savedPage(id)).toContain('Keep this draft');
});

test('Back, Forward and direct hash navigation keep the editor route on Cancel and save the draft before leaving',async({page})=>{
  const id=await editWebsite(page);const editorURL=page.url();await write(page,'Back draft');
  await page.evaluate(()=>history.back());await leaveQuestion(page).getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page).toHaveURL(editorURL);await expect(canvas(page).getByText('Back draft')).toBeVisible();
  await page.evaluate(()=>{location.hash='#/projects';});await leaveQuestion(page).getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page).toHaveURL(editorURL);await expect(canvas(page).getByText('Back draft')).toBeVisible();expect(await savedPage(id)).not.toContain('Back draft');
  await page.evaluate(()=>{location.hash='#/projects';});await leaveQuestion(page).getByRole('button',{name:'Save and leave',exact:true}).click();
  await expect(page).toHaveURL(/#\/projects$/);await expect(page.getByRole('heading',{name:'Projects',exact:true})).toBeVisible();expect(await savedPage(id)).toContain('Back draft');
  await page.evaluate(()=>history.back());await expect(page).toHaveURL(editorURL);await expect(canvas(page).getByText('Back draft')).toBeVisible();await expect(filesStatus(page)).toHaveText('Website saved.');
  await page.evaluate(()=>history.forward());await expect(page).toHaveURL(/#\/projects$/);await expect(page.getByRole('heading',{name:'Projects',exact:true})).toBeVisible();
});

test('publishing and local access forms cannot silently lose or carry unsaved fields',async({page})=>{
  await preferences(page,'Integrations');await page.getByLabel('GitHub owner / organization').fill('discard-me');
  await navigate(page,'Projects');await choose(page,'Stay here');await expect(page.getByLabel('GitHub owner / organization')).toHaveValue('discard-me');
  await navigate(page,'Projects');await choose(page,'Discard changes');await preferences(page,'Integrations');await expect(page.getByLabel('GitHub owner / organization')).toHaveValue('');
  await preferences(page,'Storage & access');await page.getByLabel('Username (optional)').fill('Unsubmitted account');
  await navigate(page,'Projects');await choose(page,'Stay here');await expect(page.getByLabel('Username (optional)')).toHaveValue('Unsubmitted account');
  await navigate(page,'Projects');await choose(page,'Discard changes');await preferences(page,'Storage & access');await expect(page.getByLabel('Username (optional)')).toHaveValue('');
});

// The workspace name is its folder name: saving it renames and reopens the folder.
test('inline workspace details protect edits and invalid forms cannot be saved by navigating away',async({page})=>{
  await editWorkspace(page);const form=page.locator('#workspace-name-form');
  await form.getByLabel('Workspace name',{exact:true}).fill('Changed workspace');await preferences(page,'Appearance');await choose(page,'Stay here');await expect(form.getByLabel('Workspace name',{exact:true})).toHaveValue('Changed workspace');
  await preferences(page,'Appearance');await choose(page,'Discard changes');await expect(page.locator('.workspace-name')).toHaveText(book.title);
  await editWorkspace(page);await page.getByLabel('Workspace name',{exact:true}).fill('');await preferences(page,'Appearance');await choose(page,'Save and continue');await expect(guard(page).getByRole('alert')).toContainText('required fields');
  await choose(page,'Stay here');await page.getByLabel('Workspace name',{exact:true}).fill('Saved through prompt');await preferences(page,'Appearance');await choose(page,'Save and continue');await expect(page.locator('.workspace-name')).toHaveText('Saved through prompt',{timeout:30000});
});

test('switching workspaces from the website editor asks first and does not persist a discarded draft',async({page})=>{
  const id=await editWebsite(page);await write(page,'Do not persist on switching');
  await backToWorkspace(page);await leaveQuestion(page).getByRole('button',{name:'Cancel',exact:true}).click();await expect(canvas(page).getByText('Do not persist on switching')).toBeVisible();
  await discardEdits(page);await backToWorkspace(page);await inWorkspace(page);
  await navigate(page,'Workspaces');await expect(page.getByRole('heading',{name:'Workspaces',exact:true})).toBeVisible();
  const html=await savedPage(id);expect(html).not.toContain('Do not persist on switching');expect(html).toContain('Navigation page');
});

test('menu placement, size, visibility and ordering are previewable, discardable and persist only when saved',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await expect(page.getByText('Publish selected website content.',{exact:true})).toHaveCount(0);
  await openAppLayout(page);const layout=page.getByRole('dialog',{name:'App layout',exact:true});
  await layout.getByLabel('Menu position').selectOption('right');await range(layout.getByRole('slider',{name:/Side menu width/}),330);
  await layout.getByRole('button',{name:'Move Website earlier',exact:true}).click();await layout.getByRole('button',{name:'Move Website earlier',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-navigation','right');expect(await page.locator('html').evaluate(el=>el.style.getPropertyValue('--app-navigation-width'))).toBe('330px');
  expect(await page.locator('#workspace-navigation > [data-nav-section]').evaluateAll(els=>els.map(el=>el.dataset.navSection))).toEqual(['website','projects','workspace']);
  await layout.getByRole('button',{name:'Done',exact:true}).click();await choose(page,'Discard changes');await expect(page.locator('html')).toHaveAttribute('data-navigation','left');
  await openAppLayout(page);await layout.getByLabel('Menu position').selectOption('top');await layout.getByRole('button',{name:'Move Website earlier',exact:true}).click();await layout.getByRole('button',{name:'Save app settings',exact:true}).click();await expect(layout.locator('[data-interface-status]')).not.toContainText(/Saving|Unsaved/);await layout.getByRole('button',{name:'Done',exact:true}).click();
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-navigation','top');await expect(page.locator('#workspace-navigation > [data-nav-section]')).toHaveCount(3);expect(await page.locator('#workspace-navigation > [data-nav-section]').evaluateAll(els=>els.map(el=>el.dataset.navSection))).toEqual(['website','projects','workspace']);
  await page.screenshot({path:test.info().outputPath('menu-top.png'),fullPage:true});
  await openAppLayout(page);await layout.getByLabel('Hide the menu until I need it').check();await layout.getByRole('button',{name:'Save app settings',exact:true}).click();await expect(layout.locator('[data-interface-status]')).not.toContainText(/Saving|Unsaved/);await layout.getByRole('button',{name:'Done',exact:true}).click();await expect(page.locator('.sidebar')).toBeHidden();await page.getByRole('button',{name:'Menu',exact:true}).click();await expect(page.locator('.sidebar')).toBeVisible();
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.getByRole('button',{name:'Menu',exact:true}).click();await expect(page.getByRole('button',{name:'Projects',exact:true})).toBeVisible();expect(errors).toEqual([]);
});


test('failed website saves keep the draft; a delayed save completes once and Discard removes the failed edit',async({page})=>{
  const id=await openWebsite(page);await write(page,'One saved page');
  let release;const waiting=new Promise(resolve=>{release=resolve;});await page.context().route('**/api/website-files/save',async route=>{await waiting;await route.continue();});
  const save=files(page).getByRole('button',{name:'Save website',exact:true});await save.click();await expect(save).toBeDisabled();release();
  await expect(filesStatus(page)).toHaveText('Website saved.');await page.context().unroute('**/api/website-files/save');
  expect(occurrences(await savedPage(id),'One saved page')).toBe(1);
  await write(page,'Unwanted failed edit');
  await page.context().route('**/api/website-files/save',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic form write failure'})}));
  await save.click();await expect(filesStatus(page)).toHaveText('Synthetic form write failure');await expect(canvas(page).getByText('Unwanted failed edit')).toBeVisible();
  await discardEdits(page);await expect(canvas(page).getByText('Unwanted failed edit')).toHaveCount(0);await page.context().unroute('**/api/website-files/save');
  await write(page,'A separate intended change');await saveWebsite(page);
  const html=await savedPage(id);expect(occurrences(html,'One saved page')).toBe(1);expect(html).toContain('A separate intended change');expect(html).not.toContain('Unwanted failed edit');
});


test('website previews and appearance previews do not add browser history entries',async({page})=>{
  await openWebsite(page);
  const editorURL=page.url(),historyLength=await page.evaluate(()=>history.length);
  await files(page).getByRole('button',{name:'Preview saved website',exact:true}).click();
  const preview=page.locator('#website-files-preview');await expect(preview).toBeVisible();
  await expect.poll(()=>preview.evaluate(el=>el.contentWindow.location.pathname)).toContain('/api/website-files/');
  expect(await page.evaluate(()=>history.length)).toBe(historyLength);await expect(page).toHaveURL(editorURL);
  await files(page).getByRole('button',{name:'Return to editing',exact:true}).click();await expect(page.locator('#website-files-canvas')).toBeVisible();
  await files(page).getByRole('button',{name:'Site appearance',exact:true}).click();const appearance=page.getByRole('dialog',{name:'Site appearance',exact:true});
  await expect(appearance.locator('iframe')).toBeVisible();await expect.poll(()=>appearance.locator('iframe').evaluate(el=>el.contentWindow.location.pathname)).toContain('/api/website-files/');
  expect(await page.evaluate(()=>history.length)).toBe(historyLength);
  await appearance.getByRole('button',{name:'Cancel',exact:true}).click();await expect(appearance).toHaveCount(0);
  expect(await page.evaluate(()=>history.length)).toBe(historyLength);await expect(page).toHaveURL(editorURL);
  await page.evaluate(()=>history.back());await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
});

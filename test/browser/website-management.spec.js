import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {WebsiteSites} from '../../src/website-sites.js';
import {WebsiteEditor} from '../../src/website-editor.js';
import {randomUUID} from 'node:crypto';
import {navigate,preferences} from './preferences-helper.js';

test('workspace website manager creates, names, saves and reopens independent websites and destinations',async({page},info)=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-site-management-')),book=sampleNotebook();book.entries[0].share=false;
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0}),sites=new WebsiteSites(f.workspace);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const card=name=>page.locator('[data-website-card]').filter({has:page.getByRole('heading',{name,exact:true})});
 const manager=async()=>{await page.locator('.website-site-context').getByRole('button',{name:'Websites',exact:true}).click();await expect(page.getByRole('heading',{name:'Websites',exact:true})).toBeVisible();await expect(page.locator('[data-website-card]').first()).toBeVisible();};
 const create=async name=>{await page.getByRole('button',{name:'New website',exact:true}).click();await page.getByLabel('Website name',{exact:true}).fill(name);await page.getByRole('button',{name:'Create website',exact:true}).click();await expect(page.locator('.website-site-context')).toContainText(name);};
 try{
  await page.goto(app.url);await navigate(page,'Websites');await expect(page.getByRole('heading',{name:'Websites',exact:true})).toBeVisible();
  await create('Field journal');await expect(page.getByLabel('Page',{exact:true})).toHaveValue('');
  await page.getByRole('navigation',{name:'Editing tools',exact:true}).getByRole('button',{name:'Content',exact:true}).click();
  await expect(page.locator('.website-preview-panel')).not.toHaveClass(/canvas-is-loading/);
  await expect(page.locator('#website-draft-preview')).not.toHaveAttribute('aria-busy','true');
  await page.getByRole('button',{name:'Add page',exact:true}).click();await page.getByLabel('Page title',{exact:true}).fill('Field observations');
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  const firstId=(await sites.list()).sites.find(site=>site.name==='Field journal').id;
  await page.locator('.website-site-context').getByRole('button',{name:'Publishing destination',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Publishing destination',exact:true})).toBeVisible();await expect(page.locator('#main-navigation [data-action=publishing]')).toHaveAttribute('aria-current','page');await expect(page.locator('#main-navigation [data-action=preferences]')).not.toHaveAttribute('aria-current','page');
  await page.getByLabel('GitHub owner / organization',{exact:true}).fill('Example');await page.getByLabel('Repository name',{exact:true}).fill('field-journal');
  await page.getByRole('button',{name:'Save destination',exact:true}).click();await expect(page.locator('#destination-status')).toHaveText('Destination saved on this device.');
  await manager();await create('Learning website');await page.getByRole('button',{name:'Add page',exact:true}).click();await page.getByLabel('Page title',{exact:true}).fill('Learning notes');
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.locator('.website-site-context').getByRole('button',{name:'Publishing destination',exact:true}).click();await expect(page.getByLabel('Repository name',{exact:true})).toHaveValue('');
  await page.getByLabel('GitHub owner / organization',{exact:true}).fill('Example');await page.getByLabel('Repository name',{exact:true}).fill('learning-notes');
  await page.getByRole('button',{name:'Save destination',exact:true}).click();await expect(page.locator('#destination-status')).toHaveText('Destination saved on this device.');
  await manager();await card('Learning website').getByRole('button',{name:'Rename website',exact:true}).click();await page.getByLabel('Website name',{exact:true}).fill('Public lessons');await page.getByRole('button',{name:'Save name',exact:true}).click();await expect(page.locator('.website-site-context')).toContainText('Public lessons');
  await manager();await expect(card('Public lessons')).toBeVisible();await expect(card('Learning website')).toHaveCount(0);
  await card('Field journal').getByRole('button',{name:'Website editor',exact:true}).click();await expect(page.getByLabel('Page',{exact:true})).toContainText('Field observations');await page.reload();await expect(page.locator('.website-site-context')).toContainText('Field journal');await expect(page.getByLabel('Page',{exact:true})).toContainText('Field observations');
  await manager();await card('Field journal').getByRole('button',{name:'Publishing destination',exact:true}).click();await expect(page.getByLabel('Repository name',{exact:true})).toHaveValue('field-journal');
  await manager();await card('Public lessons').getByRole('button',{name:'Publishing destination',exact:true}).click();await expect(page.getByLabel('Repository name',{exact:true})).toHaveValue('learning-notes');
  await manager();await page.screenshot({path:info.outputPath('website-manager.png'),fullPage:false});
  await page.getByRole('button',{name:'New website',exact:true}).click();await page.getByLabel('Website name',{exact:true}).fill(' FIELD   JOURNAL ');await page.getByRole('button',{name:'Create website',exact:true}).click();await expect(page.getByText('A website with this name already exists in this workspace. Choose a different name.',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await card('Public lessons').getByRole('button',{name:'Rename website',exact:true}).click();await page.getByLabel('Website name',{exact:true}).fill('field journal');await page.getByRole('button',{name:'Save name',exact:true}).click();await expect(page.locator('[data-website-form-error]')).toContainText('A website with this name already exists');await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.locator('.website-site-context')).toContainText('Public lessons');await manager();await expect(card('Public lessons')).toBeVisible();await expect(card('field journal')).toHaveCount(0);
  const defaultName=(await sites.read(null)).site.name;await card(defaultName).getByRole('button',{name:'Rename website',exact:true}).click();await page.getByLabel('Website name',{exact:true}).fill('Original design');await page.getByRole('button',{name:'Save name',exact:true}).click();await manager();await expect(card('Original design')).toBeVisible();await expect(card(defaultName)).toHaveCount(0);
  await card('Original design').getByRole('button',{name:'Publishing destination',exact:true}).click();await expect(page).toHaveURL(/#\/websites\/default\/settings$/);await expect(page.getByRole('heading',{name:'Publishing destination',exact:true})).toBeVisible();await expect(page.locator('.preferences-heading')).toHaveCount(0);await page.reload();await expect(page.getByRole('heading',{name:'Publishing destination',exact:true})).toBeVisible();
  await navigate(page,'Preferences');await preferences(page,'Appearance');await expect(page.locator('.preferences-heading')).toBeVisible();await expect(page).toHaveURL(/#\/preferences\/appearance$/);await expect(page.locator('#main-navigation [data-action=preferences]')).toHaveAttribute('aria-current','page');await page.reload();await expect(page.locator('.preferences-heading')).toBeVisible();
  expect((await sites.read(firstId)).book.pages.map(value=>value.title)).toEqual(['Field observations']);expect((await sites.list()).sites).toHaveLength(2);expect((await f.workspace.read()).book.entries).toEqual(book.entries);expect(errors).toEqual([]);
 }finally{await page.close();await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});


test('manager rename asks before saving or discarding a retained website draft',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-site-rename-draft-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),sites=new WebsiteSites(f.workspace),editor=new WebsiteEditor(f.workspace);
 const websiteId=(await sites.change({workspaceId:book.id,etag:(await f.workspace.outline()).etag,operation:'create',name:'Field journal'})).id;
 const execute=(operation,command={})=>editor.execute(operation,{workspaceId:book.id,websiteId,...command});
 const change=async operations=>{const current=await execute('open');return execute('change',{websitePin:current.websitePin,draftId:current.draft?.id??null,expectedRevision:current.draft?.revision??null,commandId:randomUUID(),operations});};
 const original={id:randomUUID(),title:'Saved observations',body:'Saved page text',share:true,sections:[]},draft={...original,title:'Unfinished observations',body:'Unfinished page text'};
 const created=await change([{type:'append',collection:'pages',values:[original]}]);await execute('save',{draftId:created.draft.id,expectedRevision:created.draft.revision,commandId:randomUUID()});
 const retained=await change([{type:'replace',collection:'pages',key:original.id,value:draft}]);
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0}),browser=page.context();
 const guard=()=>page.getByRole('dialog',{name:'Unsaved changes',exact:true}),renameForm=()=>page.locator('#website-site-form');
 const card=name=>page.locator('[data-website-card]').filter({has:page.getByRole('heading',{name,exact:true})});
 const assertRetained=async()=>{expect((await sites.read(websiteId)).book.pages).toEqual([original]);expect((await sites.read(websiteId)).site.name).toBe('Field journal');expect((await execute('open')).draft).toEqual(retained.draft);};
 try{
  await page.goto(app.url);await navigate(page,'Websites');await card('Field journal').getByRole('button',{name:'Rename website',exact:true}).click();
  await expect(guard()).toBeVisible();await expect(renameForm()).toHaveCount(0);await assertRetained();
  await page.keyboard.press('Escape');await expect(guard()).not.toBeVisible();await expect(renameForm()).toHaveCount(0);await assertRetained();
  await page.locator('.website-site-context').getByRole('button',{name:'Rename website',exact:true}).click();await expect(guard()).toBeVisible();await guard().getByRole('button',{name:'Stay here',exact:true}).click();await expect(renameForm()).toHaveCount(0);await assertRetained();
  // Reopen the manager without deciding the durable draft, as after closing the app.
  await page.close();page=await browser.newPage();await page.goto(app.origin+'/#/websites');
  await card('Field journal').getByRole('button',{name:'Rename website',exact:true}).click();await expect(guard()).toBeVisible();await guard().getByRole('button',{name:'Discard changes',exact:true}).click();
  await expect(renameForm()).toBeVisible();expect((await execute('open')).draft).toBeNull();expect((await sites.read(websiteId)).book.pages).toEqual([original]);
  await page.getByLabel('Website name',{exact:true}).fill('Renamed journal');await page.getByRole('button',{name:'Save name',exact:true}).click();await expect(page.locator('.website-site-context')).toContainText('Renamed journal');expect((await sites.read(websiteId)).book.pages).toEqual([original]);
  await page.locator('.website-site-context').getByRole('button',{name:'Websites',exact:true}).click();await expect(card('Renamed journal')).toBeVisible();
  await change([{type:'replace',collection:'pages',key:original.id,value:draft}]);
  await card('Renamed journal').getByRole('button',{name:'Rename website',exact:true}).click();await expect(guard()).toBeVisible();await guard().getByRole('button',{name:'Save and continue',exact:true}).click();
  await expect(renameForm()).toBeVisible();expect((await execute('open')).draft).toBeNull();expect((await sites.read(websiteId)).book.pages).toEqual([draft]);
  await page.getByLabel('Website name',{exact:true}).fill('Finished journal');await page.getByRole('button',{name:'Save name',exact:true}).click();await expect(page.locator('.website-site-context')).toContainText('Finished journal');
  const saved=await sites.read(websiteId);expect(saved.site.name).toBe('Finished journal');expect(saved.book.pages).toEqual([draft]);expect((await execute('open')).draft).toBeNull();
 }finally{await page.close();await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

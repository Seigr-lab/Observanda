import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {createNotebook} from '../../src/model.js';
import {defaultPageLayout} from '../../src/web/website-layouts.js';
import {WebsiteSites} from '../../src/website-sites.js';
import {WebsiteEditor} from '../../src/website-editor.js';
import {MediaStore} from '../../src/media.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {editorTab,chooseWebsitePage,openPageSettings,addSection} from './composer-helper.js';

test('selected pages, layouts, logos and media retain independent edits across windows, history and saved reopening',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-selected-editor-'));let fixture,app;
 const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().includes('/api/websites/'))requests.push(request);});
 try{
  const book=createNotebook('Website collections');fixture=await encryptedFixture(directory,book);const sites=new WebsiteSites(fixture.workspace),id=(await sites.change({workspaceId:book.id,etag:(await fixture.workspace.outline()).etag,operation:'create',name:'Observations'})).id;
  const media=new MediaStore(fixture.workspace.root,fixture.vault),bytes=await readFile(new URL('../../src/preview-assets/image.png',import.meta.url)),assets=[];
  for(let i=0;i<26;i++)assets.push({...await media.import(bytes,'image'),caption:'Library image '+String(i).padStart(2,'0'),alt:'Image '+i,transcript:''});
  const pages=Array.from({length:31},(_,i)=>({id:randomUUID(),title:'Page '+String(i).padStart(2,'0'),body:'Original page '+i,share:true,sections:[]})),before=await sites.read(id);
  const layouts=pages.map((page,i)=>({...defaultPageLayout('page:'+page.id),heading:'Original heading '+i})),branding=[{target:'home',logos:[]},...pages.map((page,i)=>({target:'page:'+page.id,logos:[{id:assets[0].id,alt:'Original logo '+i}]}))];
  await sites.save(id,{workspaceId:book.id,baseEtag:before.etag,websitePin:before.websitePin,metadata:{pages,branding,website:{...before.book.website,assets,layouts,logoId:assets[0].id,logoAlt:'Inherited home logo'}},projects:[],changes:[],removed:[],selection:before.site.selection});
  app=await startServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
  await page.goto(app.url);await expect(page.getByRole('button',{name:'Menu',exact:true})).toBeVisible();await page.goto(new URL('/#/websites/'+id+'/editor',app.url).href);await expect(page.locator('.website-site-context')).toContainText('Observations');
  await chooseWebsitePage(page,'pages/'+pages[30].id+'.html');await openPageSettings(page);await page.getByLabel('Page introduction',{exact:true}).fill('Selected final page');
  // Only the selected target is hydrated. Typing then switching checkpoints the
  // layout independently from the page and from every unseen target.
  await expect(page.locator('.workspace-logo')).toHaveCount(0);
  await page.getByText('Page header',{exact:true}).click();await expect(page.getByLabel('Display heading',{exact:true})).toHaveValue('Original heading 30');
  await page.getByLabel('Display heading',{exact:true}).fill('Selected final heading');
  await chooseWebsitePage(page,'pages/'+pages[0].id+'.html');await openPageSettings(page);await page.getByText('Page header',{exact:true}).click();await expect(page.getByLabel('Display heading',{exact:true})).toHaveValue('Original heading 0');
  await chooseWebsitePage(page,'pages/'+pages[30].id+'.html');await openPageSettings(page);await page.getByText('Page header',{exact:true}).click();await expect(page.getByLabel('Display heading',{exact:true})).toHaveValue('Selected final heading');
  await page.getByRole('button',{name:'Undo',exact:true}).click();await openPageSettings(page);await page.getByText('Page header',{exact:true}).click();await expect(page.getByLabel('Display heading',{exact:true})).toHaveValue('Original heading 30');
  await page.getByRole('button',{name:'Redo',exact:true}).click();await openPageSettings(page);await page.getByText('Page header',{exact:true}).click();await expect(page.getByLabel('Display heading',{exact:true})).toHaveValue('Selected final heading');
  await page.getByText('Page actions',{exact:true}).click();await page.getByRole('button',{name:'Page logos',exact:true}).click();
  await expect(page.locator('#leave-dialog')).not.toBeVisible();await expect(page.getByLabel('Logo 1 alternative text',{exact:true})).toHaveValue('Original logo 30');
  await page.getByLabel('Logo 1 alternative text',{exact:true}).fill('Selected final logo');
  await page.getByLabel('Branding scope',{exact:true}).selectOption('home');await expect(page.locator('.logo-editor')).toHaveCount(0);await expect(page.getByRole('button',{name:'Use default logos',exact:true})).toBeVisible();
  await page.getByLabel('Branding scope',{exact:true}).selectOption('page-picker');await page.getByRole('dialog').getByLabel('Find a page',{exact:true}).fill('Page 30');await page.getByRole('dialog').locator('[data-page-path="pages/'+pages[30].id+'.html"]').click();
  await expect(page.getByLabel('Logo 1 alternative text',{exact:true})).toHaveValue('Selected final logo');
  let interrupted=false;const interruptPages=async route=>{if(!interrupted&&route.request().postDataJSON()?.collection==='pages'){interrupted=true;await route.fulfill({status:503,json:{message:'Interrupted selected page loading'}});return;}await route.continue();};
  await page.route('**/api/websites/editor/window',interruptPages);const brandingURL=page.url();
  await page.getByRole('button',{name:'Back to website editor',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Interrupted selected page loading'})).toBeVisible();expect(interrupted).toBe(true);expect(page.url()).toBe(brandingURL);await expect(page.getByLabel('Logo 1 alternative text',{exact:true})).toBeEditable();await expect(page.getByLabel('Logo 1 alternative text',{exact:true})).toHaveValue('Selected final logo');
  await page.unroute('**/api/websites/editor/window',interruptPages);
  await page.getByRole('button',{name:'Back to website editor',exact:true}).click();await expect(page.locator('#leave-dialog')).not.toBeVisible();await expect(page.locator('#website-preview-page')).toBeVisible();
  await page.goBack();await expect(page.getByLabel('Logo 1 alternative text',{exact:true})).toHaveValue('Selected final logo');await expect(page.locator('#leave-dialog')).not.toBeVisible();await page.goForward();await expect(page.locator('#website-preview-page')).toBeVisible();
  await page.getByRole('button',{name:'Undo',exact:true}).click();await openPageSettings(page);await page.getByText('Page actions',{exact:true}).click();await page.getByRole('button',{name:'Page logos',exact:true}).click();await expect(page.getByLabel('Logo 1 alternative text',{exact:true})).toHaveValue('Original logo 30');
  await page.getByRole('button',{name:'Back to website editor',exact:true}).click();await page.getByRole('button',{name:'Redo',exact:true}).click();
  await page.locator('.website-site-context').getByRole('button',{name:'Appearance',exact:true}).click();await expect(page.getByLabel('Header alignment',{exact:true})).toBeVisible();await expect(page.locator('#leave-dialog')).not.toBeVisible();await page.locator('.website-site-context').getByRole('button',{name:'Website editor',exact:true}).click();
  await editorTab(page,'Media');await expect(page.locator('.website-media-library article')).toHaveCount(12);
  await page.locator('#website-media-search').fill('image 25');await expect(page.locator('.website-media-library article')).toHaveCount(1);
  const caption=page.getByLabel('Media caption',{exact:true});await caption.fill('Selected field image');await expect(caption).toBeFocused();
  await addSection(page,'asset');const select=page.locator('[data-website-media-select]');await select.selectOption('find');
  const dialog=page.getByRole('dialog'),filtered=page.waitForResponse(response=>response.url().endsWith('/api/websites/editor/window')&&response.request().postDataJSON()?.search==='Selected field');await dialog.getByLabel('Find media',{exact:true}).fill('Selected field');const found=await (await filtered).json();expect(found.rows,JSON.stringify({found,errors})).toHaveLength(1);await expect(dialog.locator('[data-choose-media]')).toHaveCount(1);await dialog.locator('[data-choose-media]').click();
  await expect(select).toHaveValue(assets[25].id);await expect(select).toBeFocused();
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(select).toHaveValue('');
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(select).toHaveValue(assets[25].id);
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.reload();await chooseWebsitePage(page,'pages/'+pages[30].id+'.html');await openPageSettings(page);await expect(page.getByLabel('Page introduction',{exact:true})).toHaveValue('Selected final page');
  await page.getByText('Page header',{exact:true}).click();await expect(page.getByLabel('Display heading',{exact:true})).toHaveValue('Selected final heading');
  await page.getByText('Page actions',{exact:true}).click();await page.getByRole('button',{name:'Page logos',exact:true}).click();await expect(page.getByLabel('Logo 1 alternative text',{exact:true})).toHaveValue('Selected final logo');
  await page.reload();await expect(page.getByLabel('Logo 1 alternative text',{exact:true})).toHaveValue('Selected final logo');
  const saved=(await sites.read(id)).book;expect(saved.pages).toHaveLength(31);expect(saved.pages[0]).toEqual(pages[0]);expect(saved.pages[30].sections[0].assetId).toBe(assets[25].id);expect(saved.website.assets).toHaveLength(26);expect(saved.website.assets[25].caption).toBe('Selected field image');
  expect(saved.website.layouts).toHaveLength(31);expect(saved.website.layouts[0]).toEqual(layouts[0]);expect(saved.website.layouts[30].heading).toBe('Selected final heading');expect(saved.branding).toHaveLength(32);expect(saved.branding[0]).toEqual({target:'home',logos:[]});expect(saved.branding[1]).toEqual(branding[1]);expect(saved.branding[31].logos).toEqual([{id:assets[0].id,alt:'Selected final logo'}]);
  for(const request of requests.filter(request=>new URL(request.url()).pathname==='/api/websites/editor/change'))for(const operation of request.postDataJSON().operations)if(operation.type==='settings')expect(['branding','layouts']).not.toContain(operation.path.at(-1));
  for(const collection of ['layouts','branding'])expect(requests.some(request=>new URL(request.url()).pathname==='/api/websites/editor/item'&&request.postDataJSON().collection===collection&&request.postDataJSON().key==='page:'+pages[30].id)).toBe(true);
  expect(requests.some(request=>new URL(request.url()).pathname==='/api/websites/save')).toBe(false);
  for(const request of requests.filter(request=>new URL(request.url()).pathname==='/api/websites/editor/window'))expect(request.postDataJSON().limit).toBeLessThanOrEqual(100);
  expect(errors).toEqual([]);
 }finally{await page.close();await app?.close();if(fixture)clearVault(fixture.vault);expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));await rm(directory,{recursive:true,force:true});}
});


test('branding page-name completion keeps a pressed return control and redo history',async({page})=>{
 test.setTimeout(60000);page.setDefaultTimeout(10000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-branding-return-'));let fixture,app,release;
 try{
  const book=createNotebook('Branding return');fixture=await encryptedFixture(directory,book);const sites=new WebsiteSites(fixture.workspace),id=(await sites.change({workspaceId:book.id,etag:(await fixture.workspace.outline()).etag,operation:'create',name:'Selected website'})).id;
  const authored={id:randomUUID(),title:'Named page',body:'Original text',share:true,sections:[]},before=await sites.read(id);
  await sites.save(id,{workspaceId:book.id,baseEtag:before.etag,websitePin:before.websitePin,metadata:{pages:[authored],branding:[{target:'page:'+authored.id,logos:[]}]},projects:[],changes:[],removed:[],selection:before.site.selection});
  const editor=new WebsiteEditor(fixture.workspace),common={workspaceId:book.id,websiteId:id},opened=await editor.execute('open',common),changed=await editor.execute('change',{...common,websitePin:opened.websitePin,draftId:null,expectedRevision:null,commandId:randomUUID(),operations:[{type:'settings',path:['document','website','footer'],value:'Retained redo'}]});
  await editor.execute('undo',{...common,websitePin:changed.websitePin,draftId:changed.draft.id,expectedRevision:changed.draft.revision,commandId:randomUUID()});
  app=await startServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});await page.goto(app.url);await expect(page.getByRole('button',{name:'Menu',exact:true})).toBeVisible();await page.goto(new URL('/#/websites/'+id+'/editor',app.url).href);await expect(page.locator('.website-site-context')).toContainText('Selected website');
  await chooseWebsitePage(page,'pages/'+authored.id+'.html');await openPageSettings(page);await page.getByText('Page actions',{exact:true}).click();await expect(page.getByRole('button',{name:'Redo',exact:true})).toBeEnabled();
  let arrived;const waiting=new Promise(resolve=>{arrived=resolve;}),held=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/websites/editor/item',async route=>{const data=route.request().postDataJSON();if(data.collection!=='pages'||data.key!==authored.id){await route.continue();return;}const response=await route.fetch();arrived();await held;await route.fulfill({response}).catch(()=>{});});
  await page.getByRole('button',{name:'Page logos',exact:true}).click();await waiting;
  const back=page.getByRole('button',{name:'Back to website editor',exact:true}),original=await back.elementHandle(),box=await back.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();release();
  await expect(page.getByLabel('Branding scope',{exact:true}).locator('option:checked')).toHaveText('Page: Named page');
  const retained=await original.evaluate(node=>node.isConnected);await page.mouse.up();expect(retained,'Completing a name lookup replaced the pressed Back button').toBe(true);
  await expect(page.locator('#website-preview-page')).toBeVisible();await expect(page.getByRole('button',{name:'Redo',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Redo',exact:true}).click();
  await expect.poll(async()=>{const current=await editor.execute('open',common);return current.site.document.website.footer;}).toBe('Retained redo');
 }finally{release?.();await page.mouse.up().catch(()=>{});await page.close();await app?.close();if(fixture)clearVault(fixture.vault);expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));await rm(directory,{recursive:true,force:true});}
});

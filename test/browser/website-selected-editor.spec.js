import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {createNotebook} from '../../src/model.js';
import {WebsiteSites} from '../../src/website-sites.js';
import {MediaStore} from '../../src/media.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {editorTab,chooseWebsitePage,openPageSettings,addSection} from './composer-helper.js';

test('selected pages and media remain editable across windows, history and saved reopening',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-selected-editor-'));let fixture,app;
 const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().includes('/api/websites/'))requests.push(request);});
 try{
  const book=createNotebook('Website collections');fixture=await encryptedFixture(directory,book);const sites=new WebsiteSites(fixture.workspace),id=(await sites.change({workspaceId:book.id,etag:(await fixture.workspace.outline()).etag,operation:'create',name:'Observations'})).id;
  const media=new MediaStore(fixture.workspace.root,fixture.vault),bytes=await readFile(new URL('../../src/preview-assets/image.png',import.meta.url)),assets=[];
  for(let i=0;i<26;i++)assets.push({...await media.import(bytes,'image'),caption:'Library image '+String(i).padStart(2,'0'),alt:'Image '+i,transcript:''});
  const pages=Array.from({length:31},(_,i)=>({id:randomUUID(),title:'Page '+String(i).padStart(2,'0'),body:'Original page '+i,share:true,sections:[]})),before=await sites.read(id);
  await sites.save(id,{workspaceId:book.id,baseEtag:before.etag,websitePin:before.websitePin,metadata:{pages,website:{...before.book.website,assets}},projects:[],changes:[],removed:[],selection:before.site.selection});
  app=await startServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
  await page.goto(app.url);await expect(page.getByRole('button',{name:'Menu',exact:true})).toBeVisible();await page.goto(new URL('/#/websites/'+id+'/editor',app.url).href);await expect(page.locator('.website-site-context')).toContainText('Observations');
  await chooseWebsitePage(page,'pages/'+pages[30].id+'.html');await openPageSettings(page);await page.getByLabel('Page introduction',{exact:true}).fill('Selected final page');
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
  const saved=(await sites.read(id)).book;expect(saved.pages).toHaveLength(31);expect(saved.pages[0]).toEqual(pages[0]);expect(saved.pages[30].sections[0].assetId).toBe(assets[25].id);expect(saved.website.assets).toHaveLength(26);expect(saved.website.assets[25].caption).toBe('Selected field image');
  expect(requests.some(request=>new URL(request.url()).pathname==='/api/websites/save')).toBe(false);
  for(const request of requests.filter(request=>new URL(request.url()).pathname==='/api/websites/editor/window'))expect(request.postDataJSON().limit).toBeLessThanOrEqual(100);
  expect(errors).toEqual([]);
 }finally{await page.close();await app?.close();if(fixture)clearVault(fixture.vault);expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));await rm(directory,{recursive:true,force:true});}
});

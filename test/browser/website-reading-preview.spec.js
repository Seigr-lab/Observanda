import {test,expect} from '@playwright/test';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {createNotebook} from '../../src/model.js';
import {WebsiteSites} from '../../src/website-sites.js';
import {clearVault} from '../../src/encryption.js';
import {startServer} from '../../src/server.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {openPageSettings} from './composer-helper.js';

test('browse unsaved website changes without saving or preparing, with aligned menus and immediate heading feedback',async({page},info)=>{
 test.setTimeout(120000);page.setDefaultTimeout(20000);
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-reading-preview-'));
 let fixture,app,release;const errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST')requests.push(new URL(request.url()).pathname);});
 try{
  const book=createNotebook('Preview qualification');fixture=await encryptedFixture(directory,book);
  const sites=new WebsiteSites(fixture.workspace),websiteId=(await sites.change({workspaceId:book.id,etag:(await fixture.workspace.outline()).etag,operation:'create',name:'Field notes'})).id;
  const before=await sites.read(websiteId),pages=Array.from({length:45},(_,i)=>({id:randomUUID(),title:'Page '+String(i).padStart(2,'0'),body:'Public page '+i,share:true,sections:[]}));
  const privatePage={id:randomUUID(),title:'Withheld page',body:'PRIVATE_PREVIEW_SENTINEL',share:false,sections:[]};
  const navigation=[{target:'home',label:'Home',show:true,parent:null},{target:'page:'+pages[0].id,label:'Research',show:true,parent:null},{target:'page:'+pages[1].id,label:'Measurements',show:true,parent:'page:'+pages[0].id},{target:'page:'+pages[2].id,label:'About',show:true,parent:null},...pages.slice(3).map(page=>({target:'page:'+page.id,label:page.title,show:false,parent:null}))];
  await sites.save(websiteId,{workspaceId:book.id,baseEtag:before.etag,websitePin:before.websitePin,metadata:{pages:[...pages,privatePage],website:{...before.book.website,home:{...before.book.website.home,enabled:true,title:'Saved heading',showTitle:true,introduction:'Saved introduction'},navigation}},projects:[],changes:[],removed:[],selection:before.site.selection});
  app=await startServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
  await page.goto(app.url);await expect(page.getByRole('button',{name:'Menu',exact:true})).toBeVisible();
  await page.goto(new URL('/#/websites/'+websiteId+'/editor',app.url).href);
  const canvas=page.frameLocator('#website-draft-preview');await expect(canvas.locator('.site-header h1')).toHaveText('Saved heading');
  const saved=await sites.read(websiteId);
  await openPageSettings(page);
  // Hold the real durable checkpoint response: presentation must update while
  // storage is still waiting, and the save indicator must remain unsaved.
  let entered,continued;const waiting=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve),resumed=new Promise(resolve=>continued=resolve);
  await page.route('**/api/websites/editor/change',async route=>{entered();await gate;await route.continue();continued();});
  await page.getByLabel('Show homepage heading',{exact:true}).uncheck();await waiting;
  await expect(canvas.locator('.site-header h1')).toHaveCount(0);
  await expect(page.locator('#save-status')).not.toHaveText('Saved');
  release();await resumed;await page.unroute('**/api/websites/editor/change');
  await page.getByLabel('Homepage introduction',{exact:true}).fill('Unsaved preview introduction');
  await page.getByRole('button',{name:'Preview website',exact:true}).click();
  const dialog=page.getByRole('dialog'),preview=page.frameLocator('.website-reading-preview iframe');
  await expect(preview.locator('.site-header p')).toHaveText('Unsaved preview introduction');
  await expect(preview.locator('.site-header h1')).toHaveCount(0);
  await expect(preview.locator('body')).not.toContainText('PRIVATE_PREVIEW_SENTINEL');
  await expect(dialog.getByRole('button',{name:'Prepare selected edition'})).toHaveCount(0);
  await expect(preview.locator('.canvas-section-edit,.ProseMirror')).toHaveCount(0);
  await expect(dialog.locator('[data-reading-status]')).toHaveText('');
  await expect.poll(()=>preview.locator('.site-menu').first().evaluate(element=>getComputedStyle(element).display)).toBe('flex');
  const home=await preview.locator('.site-menu > li > a').filter({hasText:/^Home$/}).boundingBox(),group=await preview.locator('.site-menu > li > a').filter({hasText:/^Research$/}).boundingBox();
  expect(Math.abs(home.y+home.height/2-group.y-group.height/2)).toBeLessThan(1);
  await preview.locator('summary[aria-label="Pages under Research"]').click();
  await preview.getByRole('link',{name:'Measurements',exact:true}).click();
  await expect(preview.locator('.site-header h1')).toHaveText('Page 01');
  await expect(dialog.getByRole('combobox',{name:'Preview page',exact:true})).toHaveValue('pages/'+pages[1].id+'.html');
  await dialog.getByRole('button',{name:'Next pages',exact:true}).click();await expect(dialog.locator('[data-reading-page] option').filter({hasText:'Page 44'})).toHaveCount(1);
  await expect(dialog.locator('[data-reading-page] option').filter({hasText:'Withheld page'})).toHaveCount(0);
  await dialog.getByRole('combobox',{name:'Preview width'}).selectOption('phone');await expect(page.locator('[data-reading-canvas]')).toHaveClass('phone-preview');
  await expect(preview.locator('body')).not.toContainText('PRIVATE_PREVIEW_SENTINEL');
  await page.screenshot({path:info.outputPath('draft-reading-preview.png')});
  await dialog.getByRole('button',{name:'Back to editing',exact:true}).click();
  await expect(page.getByLabel('Homepage introduction',{exact:true})).toHaveValue('Unsaved preview introduction');
  const after=await sites.read(websiteId);expect(after.websitePin).toEqual(saved.websitePin);expect(after.book.website.home).toEqual(saved.book.website.home);
  expect(requests.filter(route=>/\/api\/(?:preview$|publication-jobs\/start$|websites\/editor\/save$)/.test(route))).toEqual([]);
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.reload();await expect(canvas.locator('.site-header p')).toHaveText('Unsaved preview introduction');await expect(canvas.locator('.site-header h1')).toHaveCount(0);
  expect(errors).toEqual([]);
 }finally{release?.();await app?.close();if(fixture)clearVault(fixture.vault);expect(path.dirname(directory)).toBe(parent);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

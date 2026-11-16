import {test,expect} from '@playwright/test';
import {EventEmitter} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../../src/storage.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {websiteFilesHttp} from '../../src/website-files-http.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';
import {mountFilesEditor} from './mount-files-editor.js';
import {siteMenu} from './website-site-menu-helper.js';

test('an author starts a course website and gets linked lessons, a lesson sidebar and a menu',async({page})=>{
 test.setTimeout(45000);page.setDefaultTimeout(10000);
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-starter-browser-'));
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)}),store=new WebsiteFileStore(workspace),id=randomUUID();
 try{
  await mkdir(path.join(root,'.observanda'));
  await store.importFiles(id,{name:'Existing site',files:new Map([['style.css',''],['index.html','<html lang="en"><head><title>Existing</title></head><body><main><h1>Existing</h1></main></body></html>']])});
  await page.exposeFunction('filesAPI',async(route,data)=>{
   let value;await websiteFilesHttp({method:'POST',headers:{}},new EventEmitter(),{workspace,url:new URL(route,'https://website.test'),body:async()=>data??{},json:r=>{value=r;},check:async()=>{},title:'Existing site',preparation:async()=>({state:'ready',defaultSiteId:id})});return value;
  });
  await page.setViewportSize({width:1360,height:850});await mountFilesEditor(page);
  const canvas=page.frameLocator('#website-files-canvas');
  await expect(canvas.getByRole('heading',{name:'Existing'})).toBeVisible();
  await (await siteMenu(page)).getByRole('button',{name:'New website',exact:true}).click();
  const form=page.locator('[data-website-files-form]'),starters=form.getByRole('group',{name:'Starting layout'});
  await expect(starters.getByRole('radio',{name:/Blank website/})).toBeChecked();
  // Each starter shows the home page it creates: its menu, regions and record lists.
  const coursePreview=starters.locator('label').filter({has:page.getByRole('radio',{name:/^Course/})}).frameLocator('iframe');
  await expect(coursePreview.locator('aside[data-website-region="sidebar"]')).toContainText('Lesson 2');
  await expect(coursePreview.locator('[data-starter-preview-menu]')).toContainText('Resources');
  const labPreview=starters.locator('label').filter({has:page.getByRole('radio',{name:/^Laboratory/})}).frameLocator('iframe');
  await expect(labPreview.locator('.starter-preview-records h2')).toBeVisible();
  await form.getByLabel('Website name',{exact:true}).fill('Beekeeping basics');
  await expect(coursePreview.locator('h1')).toHaveText('Beekeeping basics');
  await starters.getByRole('radio',{name:/^Course/}).check();
  await form.getByRole('button',{name:'New website',exact:true}).click();
  await expect(canvas.getByRole('heading',{name:'Beekeeping basics',level:1})).toBeVisible();
  const sidebar=canvas.locator('aside[data-website-region="sidebar"]');
  await expect(sidebar.getByRole('link',{name:'Lesson 2'})).toBeVisible();
  await expect(canvas.locator('nav[data-website-menu]').getByRole('link',{name:'Resources'})).toBeVisible();
  await expect(canvas.locator('footer[data-website-region="footer"]')).toContainText('Beekeeping basics — published with Observanda.');
  const sites=(await store.list({limit:10})).items.map(item=>item.name);expect(sites).toContain('Beekeeping basics');
  // A new page can start from a page layout, previewed in the website's own stylesheet.
  await page.locator('[data-action="website-files-new-page"]').click();
  const pageForm=page.locator('[data-website-files-form]'),layouts=pageForm.getByRole('group',{name:'Page layout'});
  await expect(layouts.getByRole('radio',{name:/^Blank page/})).toBeChecked();
  await pageForm.getByLabel('Page title',{exact:true}).fill('Visit the apiary');await pageForm.getByLabel('Page file name',{exact:true}).fill('visit.html');
  const contactPreview=layouts.locator('label').filter({has:page.getByRole('radio',{name:/^Contact page/})}).frameLocator('iframe');
  await expect(contactPreview.locator('h1')).toHaveText('Visit the apiary');await expect(contactPreview.locator('section.ow-contact dl')).toBeVisible();
  await layouts.getByRole('radio',{name:/^Contact page/}).check();
  await pageForm.getByRole('button',{name:'Add page',exact:true}).click();
  await expect(canvas.locator('section.ow-contact')).toBeVisible();await expect(canvas.locator('section.ow-hero')).toHaveCount(1);
  await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  const created=(await store.list({limit:10})).items.find(item=>item.name==='Beekeeping basics');
  const saved=await store.open(created.id,{path:'visit.html'});expect(saved.html).toContain('ow-contact');expect(saved.css).toContain('.ow-hero,');
 }finally{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

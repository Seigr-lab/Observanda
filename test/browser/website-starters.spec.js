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
  await page.getByRole('button',{name:'New website',exact:true}).first().click();
  const form=page.locator('[data-website-files-form]'),starters=form.getByRole('group',{name:'Start from'});
  await expect(starters.getByRole('radio',{name:/Blank website/})).toBeChecked();
  await form.getByLabel('Website name',{exact:true}).fill('Beekeeping basics');
  await starters.getByRole('radio',{name:/^Course/}).check();
  await form.getByRole('button',{name:'New website',exact:true}).click();
  await expect(canvas.getByRole('heading',{name:'Beekeeping basics',level:1})).toBeVisible();
  const sidebar=canvas.locator('aside[data-website-region="sidebar"]');
  await expect(sidebar.getByRole('link',{name:'Lesson 2'})).toBeVisible();
  await expect(canvas.locator('nav[data-website-menu]').getByRole('link',{name:'Resources'})).toBeVisible();
  await expect(canvas.locator('footer[data-website-region="footer"]')).toContainText('Beekeeping basics — published with Observanda.');
  const sites=(await store.list({limit:10})).items.map(item=>item.name);expect(sites).toContain('Beekeeping basics');
 }finally{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

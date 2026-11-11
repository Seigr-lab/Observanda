import {test,expect} from '@playwright/test';
import {EventEmitter} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../../src/storage.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {websiteFilesHttp} from '../../src/website-files-http.js';
import {componentOperation} from '../../src/website-component-storage.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';
import {mountFilesEditor} from './mount-files-editor.js';

test('a site header region appears on every page, survives page edits and can be turned off for one page',async({page})=>{
 test.setTimeout(45000);page.setDefaultTimeout(8000);
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-site-regions-'));
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)}),store=new WebsiteFileStore(workspace),id=randomUUID();
 workspace.openCatalogue=workspace.catalogue=()=>{throw Error('Site regions opened research storage');};
 try{
  await mkdir(path.join(root,'.observanda'));
  const doc=(title,body)=>'<html lang="en"><head><title>'+title+'</title><link rel="stylesheet" href="'+(title==='Notes'?'../':'')+'style.css"></head><body><main><h1>'+title+'</h1>'+body+'</main></body></html>';
  let state=await store.importFiles(id,{name:'Apiary log',files:new Map([['style.css','body{font:18px sans-serif}'],['index.html',doc('Hives','<section><p>Apiary log banner</p></section><p id="note">Spring inspection</p>')],['notes/one.html',doc('Notes','<p>Queen seen</p>')]])});
  // The banner exists only in the reusable library, as an author would leave it after detaching.
  state=await componentOperation(store,'create',id,{expectedRevision:state.site.revision,blockPath:'0/1',name:'Banner'});
  await componentOperation(store,'detach',id,{expectedRevision:state.site.revision,instance:state.html.match(/data-website-instance="([^"]+)"/)[1]});
  await page.exposeFunction('filesAPI',async(route,data)=>{
   let value;await websiteFilesHttp({method:'POST',headers:{}},new EventEmitter(),{workspace,url:new URL(route,'https://website.test'),body:async()=>data??{},json:r=>{value=r;},check:async()=>{},title:'Apiary log',preparation:async()=>({state:'ready',defaultSiteId:id})});return value;
  });
  await page.setViewportSize({width:1360,height:850});await mountFilesEditor(page);
  const canvas=page.frameLocator('#website-files-canvas'),panel=page.locator('.website-files-regions');
  await expect(canvas.getByRole('heading',{name:'Hives'})).toBeVisible();

  await page.getByRole('button',{name:'Site regions',exact:true}).click();
  const whole=panel.locator('section',{has:page.getByRole('heading',{name:'Whole website'})}),header=whole.locator('[data-region-slot="header"]');
  await header.getByRole('combobox',{name:'Component',exact:true}).selectOption({label:'Banner'});
  await header.getByRole('button',{name:'Apply to the whole website'}).click();
  await expect(panel.getByRole('status')).toHaveText('Site regions updated.');
  await expect(panel.getByText('Shown on this page: Header: Banner')).toBeVisible();
  for(const file of ['index.html','notes/one.html'])expect((await store.open(id,{path:file})).html).toMatch(/<body><header data-website-region="header"><section data-website-instance="[^"]+"><p>Apiary log banner<\/p><\/section><\/header>/);

  await panel.getByRole('button',{name:'Return to editing'}).click();
  await expect(canvas.locator('header[data-website-region="header"]')).toContainText('Apiary log banner');
  await canvas.locator('#note').click();await page.keyboard.press('End');await page.keyboard.type(', two frames of brood');
  await page.getByRole('button',{name:'Save website',exact:true}).click();
  await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  const saved=(await store.open(id)).html;
  expect(saved).toContain('two frames of brood');expect(saved).toMatch(/data-website-region="header"/);

  await page.getByRole('button',{name:'Site regions',exact:true}).click();
  const here=panel.locator('section',{has:page.getByRole('heading',{name:'This page (index.html)'})});
  await here.locator('[data-region-slot="header"]').getByRole('combobox',{name:'Header',exact:true}).selectOption({label:'None'});
  await here.locator('[data-region-slot="header"]').getByRole('button',{name:'Apply',exact:true}).click();
  await expect(panel.getByText('Header on the page index.html: None')).toBeVisible();
  await expect(panel.getByText('No regions on this page',{exact:false})).toBeVisible();
  expect((await store.open(id)).html).not.toContain('data-website-region');
  expect((await store.open(id,{path:'notes/one.html'})).html).toContain('data-website-region="header"');

  await panel.getByRole('button',{name:'Follow the whole website'}).click();
  await expect(panel.getByText('Every page follows the whole website.')).toBeVisible();
  expect((await store.open(id)).html).toContain('data-website-region="header"');
 }finally{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

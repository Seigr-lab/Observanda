import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {WebsiteFileStore,websiteSourceId} from '../../src/website-file-store.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';

// A real 1x1 PNG, so the copy's picture renders in the canvas and preview.
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
test.use({screenshot:'off',trace:'off',video:'off'});
test('an entry card shows a chosen cover photograph and the entry date in the page language',async({page})=>{
 test.setTimeout(150000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-entry-card-')),book=sampleNotebook();
 const database=process.env.OBSERVANDA_DATABASE_URL;book.entries=[];let app,fixture;
 try{
  fixture=await encryptedFixture(directory,book);
  const store=new WebsiteFileStore(fixture.workspace),siteId=randomUUID(),photo=randomUUID();
  const sourceId=websiteSourceId({workspaceId:fixture.workspace.vault.id,projectId:randomUUID(),notebookId:randomUUID(),recordId:randomUUID()});
  const asset={path:'assets/'+createHash('sha256').update(pixel).digest('hex')+'.png',bytes:pixel,contentType:'image/png'};
  const html='<section data-observanda-part="title"><h2>Hive 4 inspection</h2></section><article class="record-page"><div class="entry-meta" data-observanda-part="metadata"><span>observation</span><time datetime="2026-05-02">2026-05-02</time><span>completed</span></div>'+
   '<div class="prose rich-document" data-observanda-part="body"><p>Brood frames inspected.</p></div><div id="record-figure-'+photo+'" data-observanda-part="media:'+photo+'"><figure class="media-figure"><img src="'+asset.path+'" alt="Capped brood frame"><figcaption>Capped brood</figcaption></figure></div></article>';
  const token=await store.beginSourceUpdate({sourceId});const source=await store.putSource({sourceId,title:'Hive 4 inspection',html,assets:[asset]},{token});
  let opened=await store.importFiles(siteId,{name:'Colmenar',files:new Map([['index.html','<!doctype html><html lang="es"><head><title>Colmenar</title></head><body><main><h1>Colmenar</h1></main></body></html>'],['style.css','']])});
  opened=await store.insertSource(siteId,{path:'index.html',expectedRevision:opened.site.revision,sourceId,sourceRevision:source.revision});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
  await page.goto(app.origin+'/?view=website#'+app.launchToken);await page.locator('[data-website-file-site]').selectOption(siteId);
  const canvas=page.frameLocator('#website-files-canvas'),copy=canvas.locator('section[data-observanda-source="'+sourceId+'"]');
  const panel=page.locator('dialog[data-website-presentation]'),toolbar=page.locator('[data-action="website-files-presentation"]:not([data-placement-context])');
  await expect(copy).toHaveCount(1);await toolbar.click();await expect(panel).toBeVisible();
  await panel.getByRole('radio',{name:'Compact card',exact:true}).check();
  const details=panel.getByRole('group',{name:'Card details'});await expect(details).toBeVisible();
  await details.getByLabel('Cover image',{exact:true}).selectOption({label:'Capped brood'});
  await details.getByRole('checkbox',{name:"Show the entry's date",exact:true}).check();
  await panel.getByRole('button',{name:'Apply to this copy',exact:true}).click();await expect(panel).not.toBeVisible();
  await expect(copy).toHaveAttribute('data-observanda-display','card');
  const cover=copy.locator('img.website-entry-cover');await expect(cover).toHaveAttribute('alt','Capped brood frame');
  await expect(copy.locator('time[datetime="2026-05-02"]')).toHaveText(/2026/);await expect(copy.locator('time[datetime="2026-05-02"]')).not.toHaveText('2026-05-02');
  await toolbar.click();await expect(details.getByLabel('Cover image',{exact:true})).toHaveValue('media:'+photo);
  await expect(details.getByRole('checkbox',{name:"Show the entry's date",exact:true})).toBeChecked();
  await panel.press('Escape');await expect(panel).not.toBeVisible();
  await page.getByRole('button',{name:'Preview saved website',exact:true}).click();
  const saved=page.frameLocator('#website-files-preview');
  await expect(saved.locator('img.website-entry-cover')).toBeVisible();
  // The cover loads lazily; wait for the picture itself, then check it is the published file.
  const coverImage=saved.locator('img.website-entry-cover');
  await expect.poll(()=>coverImage.evaluate(image=>({width:image.naturalWidth,src:image.currentSrc}))).toMatchObject({width:1});
 }finally{
  try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{if(database===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=database;}
  if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-entry-card-'))throw Error('Unexpected fixture directory');
  await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});
 }
});

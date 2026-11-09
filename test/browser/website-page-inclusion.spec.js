import {test,expect} from '@playwright/test';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {unzipSync} from 'fflate';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {createNotebook} from '../../src/model.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

test('save a private page, review its navigation, publish, withdraw and verify the delivery receipts with research offline',async({page,browser})=>{
 test.setTimeout(120000);
 const root=await mkdtemp(path.join(os.tmpdir(),'website-inclusion-desktop-')),folder=path.join(root,'Edition'),database=process.env.OBSERVANDA_DATABASE_URL;
 let app,fixture,reader;
 try{
  fixture=await encryptedFixture(root,createNotebook('Research'));await mkdir(folder);
  const store=new WebsiteFileStore(fixture.workspace),id=randomUUID(),name='notes/observations.html';
  await store.create({id,name:'Field atlas',html:'<!doctype html><html lang="en"><head><title>Field atlas</title><link rel="stylesheet" href="style.css"></head><body><nav><a href="'+name+'">Restricted trail notes</a></nav><main><h1>Public atlas</h1></main></body></html>',css:'body{color:navy}'});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(root,'preferences.json'),port:0});
  await page.goto(app.origin+'/?view=website#'+app.launchToken);
  const button=label=>page.getByRole('button',{name:label,exact:true});
  const canvas=page.frameLocator('#website-files-canvas'),selection=page.locator('[data-website-file-page]');
  const publish=async()=>{
   await button('Publish to folder').click();await page.getByLabel('Destination folder',{exact:true}).fill(folder);
   await button('Review file changes').click();await page.locator('[data-website-file-folder-confirm]').check();
   await button('Write reviewed files').click();await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible();
  };
  await button('Add page').click();
  const form=page.locator('[data-website-files-form]');await form.getByLabel('Page title',{exact:true}).fill('Sampling notes');
  await form.getByLabel('Page file name').fill(name);await expect(form.getByRole('combobox',{name:'Publication',exact:true})).toHaveValue('private');
  await form.getByRole('button',{name:'Add page',exact:true}).click();
  await expect(canvas.getByRole('heading',{name:'Sampling notes'})).toBeVisible();
  await button('Image gallery').click();await page.locator('[data-gallery-files]').setInputFiles('src/preview-assets/image.png');
  await page.locator('[data-gallery-field=alt]').fill('Draft calibration image');await page.locator('[data-action=website-files-gallery-close]').click();
  await button('Save website').click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  const zip=async()=>{
   const next=page.waitForEvent('download');await button('Download website ZIP').click();
   const download=await next;return unzipSync(await readFile(await download.path()));
  };
  const privateZIP=await zip();expect(privateZIP[name]).toBeUndefined();expect(Object.keys(privateZIP).some(k=>k.startsWith('pictures/'))).toBe(false);
  expect(Buffer.from(privateZIP['index.html']).toString()).not.toContain('Restricted trail notes');
  await selection.selectOption('index.html');await button('Preview saved website').click();
  await expect(page.frameLocator('#website-files-preview').getByRole('heading',{name:'Public atlas'})).toBeVisible();
  await expect(page.frameLocator('#website-files-preview').getByRole('link',{name:'Restricted trail notes'})).toHaveCount(0);
  await publish();
  await page.reload();await selection.selectOption(name);await button('Website pages').click();await button('Check last delivery').click();
  await expect(page.getByText('The last delivery excludes this private page.',{exact:true})).toBeVisible();
  await button('Review inclusion').click();const impact=page.getByRole('region',{name:'Review publication changes'});
  await expect(impact).toContainText('Menu link');await expect(impact).toContainText('pictures/');
  await impact.getByRole('button',{name:'Include in next publication'}).click();
  await button('Check last delivery').click();await expect(page.getByText(/page is ready for the next publication/)).toBeVisible();
  await publish();reader=await browser.newPage();await reader.goto(pathToFileURL(path.join(folder,'index.html')).href);
  await reader.getByRole('link',{name:'Restricted trail notes'}).click();await expect(reader.getByRole('heading',{name:'Sampling notes'})).toBeVisible();
  await expect.poll(()=>reader.getByAltText('Draft calibration image').evaluate(image=>image.naturalWidth)).toBeGreaterThan(0);
  await page.reload();await selection.selectOption(name);await button('Website pages').click();await button('Check last delivery').click();
  await expect(page.getByText(/matches the last confirmed delivery/)).toBeVisible();await button('Review withdrawal').click();
  await impact.getByRole('button',{name:'Make private'}).click();await button('Check last delivery').click();
  await expect(page.getByText(/last delivery still contains this page/)).toBeVisible();await publish();
  const after=await readFile(path.join(folder,'index.html'),'utf8');expect(after).not.toContain('Restricted trail notes');
  await expect(readFile(path.join(folder,name))).rejects.toHaveProperty('code','ENOENT');
  expect((await store.open(id,{path:name})).html).toContain('Draft calibration image');
 }finally{
  if(database===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=database;
  await reader?.close();try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
 }
});

import {test,expect} from '@playwright/test';
import {mkdir,mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {clearVault} from '../../src/encryption.js';
import {createNotebook} from '../../src/model.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

test('the editor moves, copies, archives and restores saved pages and sites offline, then publishes the reviewed site to a folder',async({page,browser})=>{
 test.setTimeout(120000);
 const root=await mkdtemp(path.join(os.tmpdir(),'website-organization-')),folder=path.join(root,'published'),database=process.env.OBSERVANDA_DATABASE_URL;
 let fixture,app,reader;
 try{
  fixture=await encryptedFixture(root,createNotebook('Station ledger'));await mkdir(folder);
  const store=new WebsiteFileStore(fixture.workspace),id=randomUUID(),html=(title,body)=>'<!doctype html><html lang="en"><head><title>'+title+'</title><link rel="stylesheet" href="style.css"></head><body><main>'+body+'</main></body></html>';
  await store.importFiles(id,{name:'Station atlas',files:new Map([['index.html',html('Station atlas','<h1>Stations</h1><a href="field.html#observations">Field report</a>')],['field.html',html('Field report','<h1 id="observations">Station observations</h1><a href="index.html">Stations</a>')],['style.css','h1{color:navy}']])});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/offline';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(root,'preferences.json'),port:0});
  await page.goto(app.origin+'/?view=website#'+app.launchToken);
  const button=name=>page.getByRole('button',{name,exact:true}),canvas=page.frameLocator('#website-files-canvas'),field=k=>page.locator('[data-lifecycle-field="'+k+'"]');
  const managePage=async()=>{await button('Website pages').click();await button('Manage this page').click();};
  const review=async()=>{await page.locator('[data-action="website-files-life-review"]').click();await expect(page.locator('[data-action="website-files-life-apply"]')).toBeVisible();};
  const apply=()=>page.locator('[data-action="website-files-life-apply"]').click();
  await page.locator('[data-website-file-page]').selectOption('field.html');
  await managePage();await field('operation').selectOption('move');await field('destination').fill('studies/2026/field.html');await review();
  await expect(page.locator('.website-page-form')).toContainText('index.html');await apply();
  await expect(canvas.getByRole('heading',{name:'Station observations'})).toBeVisible();
  await managePage();await field('operation').selectOption('duplicate');await field('title').fill('Private field copy');await review();await apply();
  await expect(page.locator('[data-website-file-page]')).toHaveValue('private-field-copy.html');
  await managePage();await field('operation').selectOption('archive');await review();await apply();
  await expect(page.locator('[data-website-file-page]')).toHaveValue('index.html');
  await managePage();await button('Archived pages').click();await button('Private field copy private-field-copy.html').click();await apply();
  await expect(page.locator('[data-website-file-page]')).toHaveValue('private-field-copy.html');
  await button('Manage website').click();await field('operation').selectOption('duplicate');await field('title').fill('Independent atlas');await review();await apply();
  await expect(page.getByRole('heading',{name:'Independent atlas',exact:true})).toBeVisible();
  await button('Manage website').click();await field('operation').selectOption('archive');await review();await apply();
  await expect(page.getByRole('heading',{name:'Station atlas',exact:true})).toBeVisible();
  await button('Manage website').click();await button('Archived websites').click();await button('Independent atlas').click();await apply();
  await expect(page.getByRole('heading',{name:'Independent atlas',exact:true})).toBeVisible();
  await button('Publish to folder').click();await page.getByLabel('Destination folder',{exact:true}).fill(folder);
  await button('Review file changes').click();await page.locator('[data-website-file-folder-confirm]').check();await button('Write reviewed files').click();
  await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible();
  expect(await readFile(path.join(folder,'index.html'),'utf8')).toContain('studies/2026/field.html#observations');
  for(const absent of ['field.html','private-field-copy.html'])await expect(stat(path.join(folder,absent))).rejects.toMatchObject({code:'ENOENT'});
  reader=await browser.newPage();await reader.goto(pathToFileURL(path.join(folder,'index.html')).href);
  await reader.getByRole('link',{name:'Field report'}).click();await expect(reader.getByRole('heading',{name:'Station observations'})).toBeVisible();
  expect(await reader.locator('h1').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(0, 0, 128)');
 }finally{
  if(database===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=database;
  await reader?.close();try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
 }
});

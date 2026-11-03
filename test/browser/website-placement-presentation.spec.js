import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {seedWebsitePickerCorpus} from '../helpers/website-picker-corpus.js';

test.use({screenshot:'off',trace:'off',video:'off'});
test('one saved lab entry can be a full entry, card and selected section on different website pages',async({page})=>{
 test.setTimeout(150000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-entry-display-')),book=sampleNotebook();
 const database=process.env.OBSERVANDA_DATABASE_URL;book.entries=[];let app,fixture;
 try{
  fixture=await encryptedFixture(directory,book);
  const store=new WebsiteFileStore(fixture.workspace),siteId=randomUUID(),{examples:[source]}=await seedWebsitePickerCorpus(store,{count:1});
  const pageHTML=title=>'<!doctype html><html><head><title>'+title+'</title></head><body><main><h1>'+title+'</h1><p>Local page introduction</p></main></body></html>';
  let opened=await store.importFiles(siteId,{name:'Transect atlas',files:new Map([['index.html',pageHTML('Field atlas')],['methods.html',pageHTML('Sampling protocol')],['style.css','']])});
  for(const path of ['index.html','index.html','methods.html'])opened=await store.insertSource(siteId,{path,expectedRevision:opened.site.revision,sourceId:source.id,sourceRevision:source.revision});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  await expect(fixture.workspace.catalogue(db=>db.head())).rejects.toMatchObject({code:'DATABASE_UNAVAILABLE'});
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
  const requests=[];page.on('request',r=>{const route=new URL(r.url()).pathname;if(route.startsWith('/api/'))requests.push(route);});
  await page.goto(app.origin+'/?view=website#'+app.launchToken);await page.locator('[data-website-file-site]').selectOption(siteId);
  const canvas=page.frameLocator('#website-files-canvas'),copies=canvas.locator('section[data-observanda-source="'+source.id+'"]');
  const panel=page.locator('dialog[data-website-presentation]'),toolbar=page.locator('[data-action="website-files-presentation"]:not([data-placement-context])');
  async function enter(){await expect(toolbar).toBeEnabled();await toolbar.focus();await expect(toolbar).toBeFocused();await toolbar.press('Enter');await expect(panel).toBeVisible();}
  async function apply(){const button=panel.getByRole('button',{name:'Apply to this copy',exact:true});await button.focus();await button.press('Enter');await expect(panel).not.toBeVisible();}
  await expect(copies).toHaveCount(2);
  await enter();await panel.getByLabel('Entry copy on this page').selectOption('1');
  await panel.getByLabel('Display as').selectOption('card');await panel.getByLabel('Content to show').selectOption('body');await apply();
  await expect(copies.nth(1)).toHaveAttribute('data-observanda-display','card');
  await expect(copies.nth(1)).toContainText('Field measurements');await expect(copies.nth(1)).not.toContainText('Sampling method');
  await expect(copies.first()).toContainText('Sampling method');
  await page.locator('[data-website-file-page]').selectOption('methods.html');await expect(copies).toHaveCount(1);
  await copies.locator('h1,h2,h3').first().click();const contextual=page.locator('[data-placement-context]');await expect(contextual).toBeVisible();
  await contextual.click();await panel.getByLabel('Display as').selectOption('section');
  await panel.getByLabel('Content to show').selectOption('section:'+source.sectionId);await apply();
  await expect(copies.first()).toContainText('the observer compared');await expect(copies.first()).not.toContainText('Field measurements');
  await page.reload();await page.locator('[data-website-file-page]').selectOption('methods.html');
  await page.getByRole('button',{name:'Preview saved website',exact:true}).click();
  const saved=page.frameLocator('#website-files-preview');await expect(saved.locator('[data-observanda-display="section"]')).toContainText('the observer compared');
  await expect(saved.getByText('Local page introduction')).toBeVisible();await expect(saved.locator('[data-observanda-display="card"]')).toHaveCount(0);
  expect((await store.open(siteId)).html.match(/data-observanda-display="card"/g)).toHaveLength(1);
  expect(requests.some(route=>route.includes('/research/')||route==='/api/storage')).toBe(false);
  expect(requests.filter(route=>route.endsWith('/library/present-placement'))).toHaveLength(2);
 }finally{
  try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{if(database===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=database;}
  if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-entry-display-'))throw Error('Unexpected fixture directory');
  await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});
 }
});

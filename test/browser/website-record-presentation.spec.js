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
test('a full lab entry copy can leave out parts, choose a layout and speak the page language',async({page})=>{
 test.setTimeout(150000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-presentation-')),book=sampleNotebook();
 const database=process.env.OBSERVANDA_DATABASE_URL;book.entries=[];let app,fixture;
 try{
  fixture=await encryptedFixture(directory,book);
  const store=new WebsiteFileStore(fixture.workspace),siteId=randomUUID(),{examples:[source]}=await seedWebsitePickerCorpus(store,{count:1});
  const pageHTML='<!doctype html><html lang="es"><head><title>Apiario</title></head><body><main><h1>Apiario</h1><p>Introducción local</p></main></body></html>';
  let opened=await store.importFiles(siteId,{name:'Apiario',files:new Map([['index.html',pageHTML],['style.css','']])});
  opened=await store.insertSource(siteId,{path:'index.html',expectedRevision:opened.site.revision,sourceId:source.id,sourceRevision:source.revision});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
  const requests=[];page.on('request',r=>{const route=new URL(r.url()).pathname;if(route.startsWith('/api/'))requests.push(route);});
  await page.goto(app.origin+'/?view=website#'+app.launchToken);await page.locator('[data-website-file-site]').selectOption(siteId);
  const canvas=page.frameLocator('#website-files-canvas'),copy=canvas.locator('section[data-observanda-source="'+source.id+'"]');
  const panel=page.locator('dialog[data-website-presentation]'),toolbar=page.locator('[data-action="website-files-presentation"]:not([data-placement-context])');
  await expect(copy).toHaveCount(1);
  // The record's own words already follow the page language.
  await expect(copy.locator('[data-observanda-part="metadata"] > span').last()).not.toHaveText(/^(draft|planned|in progress|completed)$/);
  await expect(toolbar).toBeEnabled();await toolbar.click();await expect(panel).toBeVisible();
  const full=panel.getByRole('radio',{name:'Full entry',exact:true});await expect(full).toBeChecked();
  const parts=panel.getByRole('group',{name:'Parts to show'});await expect(parts).toBeVisible();
  const details=parts.getByRole('checkbox',{name:'Type, date and status',exact:true}),sections=parts.getByRole('checkbox',{name:'Sections and template fields',exact:true});
  await expect(details).toBeChecked();await expect(sections).toBeChecked();
  const apply=panel.getByRole('button',{name:'Apply to this copy',exact:true});await expect(apply).toBeDisabled();
  await details.press('Space');await expect(details).not.toBeChecked();await expect(apply).toBeEnabled();
  await panel.getByLabel('Layout',{exact:true}).selectOption('split');
  await apply.click();await expect(panel).not.toBeVisible();
  await expect(copy).toHaveAttribute('data-observanda-hide','details');await expect(copy).toHaveAttribute('data-observanda-layout','split');
  await expect(copy.locator('[data-observanda-part="metadata"]')).toHaveCount(0);await expect(copy).toContainText('the observer compared');
  // The section heading sits under the record title in the outline.
  await expect(copy.locator('[data-observanda-part^="section:"] > h3')).toHaveCount(1);
  await toolbar.click();await expect(panel).toBeVisible();
  await expect(parts.getByRole('checkbox',{name:'Type, date and status',exact:true})).not.toBeChecked();
  await expect(panel.getByLabel('Layout',{exact:true})).toHaveValue('split');
  // Leaving out every part is not offered.
  for(const box of await parts.getByRole('checkbox').all())if(await box.isChecked())await box.uncheck();
  await expect(apply).toBeDisabled();
  await panel.press('Escape');await expect(panel).not.toBeVisible();
  await page.setViewportSize({width:375,height:812});
  await page.getByRole('button',{name:'Preview saved website',exact:true}).click();
  const saved=page.frameLocator('#website-files-preview');
  await expect(saved.locator('section[data-observanda-layout="split"]')).toBeVisible();
  await expect(saved.getByText('Introducción local')).toBeVisible();
  const overflow=await saved.locator('html').evaluate(root=>root.scrollWidth-root.clientWidth);expect(overflow).toBeLessThanOrEqual(0);
  expect(requests.some(route=>route.includes('/research/')||route==='/api/storage')).toBe(false);
  expect(requests.filter(route=>route.endsWith('/library/present-placement'))).toHaveLength(1);
 }finally{
  try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{if(database===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=database;}
  if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-record-presentation-'))throw Error('Unexpected fixture directory');
  await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});
 }
});

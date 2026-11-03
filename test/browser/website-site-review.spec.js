import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

const documentHTML=(title,body,css='style.css')=>'<!doctype html><html lang="en"><head><title>'+title+'</title><link rel="stylesheet" href="'+css+'"></head><body><main><h1>'+title+'</h1>'+body+'</main></body></html>';
test('review the published site, repair a cross-page link and describe a figure with research offline',async({page})=>{
 test.setTimeout(150000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-site-review-')),database=process.env.OBSERVANDA_DATABASE_URL;
 let fixture,app;
 try{
  const book=sampleNotebook();book.entries=[];fixture=await encryptedFixture(directory,book);
  const store=new WebsiteFileStore(fixture.workspace),siteId=randomUUID();
  const home=documentHTML('Optics atlas','<p><a href="methods/assays.html#wrong">Instrument methods</a></p><p><a href="draft/protocol.html">Private protocol</a></p><p><a href="https://example.org/citations">Citations</a></p><figure><img src="spectrum.svg"><figcaption>Observed spectrum</figcaption></figure>');
  const methods=documentHTML('Assay methods','<h2 id="calibration">Calibration</h2><table><tr><td>526 nm</td></tr></table>','../style.css');
  await store.importFiles(siteId,{name:'Optics atlas',files:new Map([['index.html',home],['methods/assays.html',methods],['spectrum.svg','<svg xmlns="http://www.w3.org/2000/svg"></svg>'],['style.css','body{background-image:url(absent.png)}']]),
   draftFiles:new Map([['draft/protocol.html',documentHTML('Unreleased canary','','../draft-styles.css')],['draft-styles.css','']])});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
  page.setDefaultTimeout(15000);await page.goto(app.origin+'/?view=website#'+app.launchToken);
  const canvas=page.frameLocator('#website-files-canvas');
  await expect(canvas.getByRole('heading',{name:'Optics atlas'})).toBeVisible();
  const guideButton=page.getByRole('button',{name:'Website guide',exact:true});await guideButton.click();
  const guide=page.getByRole('dialog').filter({has:page.locator('[data-context-help-close]')});
  await expect(guide.locator('article section')).toHaveCount(5);await expect(guide).toContainText('Choose which entries, writing sections and figures');
  await guide.locator('[data-context-help-close]').click();await expect(guideButton).toBeFocused();
  await page.getByRole('button',{name:'Check page',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('draft/protocol.html');await page.getByRole('button',{name:'Cancel',exact:true}).click();
  const routes=[],record=r=>routes.push(new URL(r.url()));page.on('request',record);
  const check=async()=>{await page.getByRole('button',{name:'Check website',exact:true}).click();const d=page.getByRole('dialog',{name:'Check website'});await expect(d.getByRole('status',{name:'Check website'})).toContainText('findings');return d;};
  let d=await check();
  await expect(d.getByRole('status',{name:'Check website'})).toContainText('5 findings in 3 files');
  expect(routes.some(url=>/spectrum\.svg$|absent\.png$/.test(url.pathname))).toBe(false);
  await d.getByRole('button',{name:'index.html (3)',exact:true}).click();
  const bad=d.locator('li').filter({hasText:'methods/assays.html#wrong'});
  await bad.locator('summary').click();
  if(process.env.OBSERVANDA_SITE_REVIEW_SCREENSHOT)await d.screenshot({path:process.env.OBSERVANDA_SITE_REVIEW_SCREENSHOT});
  const address=bad.getByLabel('Destination URL or page');
  await address.fill('methods/assays.html#still-wrong');await bad.getByRole('button',{name:'Apply in editor'}).click();
  await expect(address).toBeFocused();await expect(d).toBeVisible();
  await address.fill('methods/assays.html#calibration');await bad.getByRole('button',{name:'Apply in editor'}).click();
  await expect(canvas.getByRole('link',{name:'Instrument methods'})).toHaveAttribute('href','methods/assays.html#calibration');
  await page.getByRole('button',{name:'Save website',exact:true}).click();
  d=await check();await expect(d.getByRole('status',{name:'Check website'})).toContainText('4 findings in 3 files');
  await d.getByRole('button',{name:'index.html (2)',exact:true}).click();
  const figure=d.locator('li').filter({hasText:'alternative text'});
  await figure.locator('summary').click();
  await figure.getByLabel('Image description (alt text)').fill('Fluorescence peak at 526 nm');await figure.getByRole('button',{name:'Apply in editor'}).click();
  await expect(canvas.getByRole('img',{name:'Fluorescence peak at 526 nm'})).toBeVisible();
  await page.getByRole('button',{name:'Save website',exact:true}).click();
  await expect.poll(async()=>(await store.open(siteId)).html).toContain('alt="Fluorescence peak at 526 nm"');
  d=await check();await expect(d.getByRole('status',{name:'Check website'})).toContainText('3 findings in 3 files');
  await d.getByRole('button',{name:'style.css (1)',exact:true}).click();await expect(d.locator('li')).toContainText('absent.png');
  await d.getByRole('button',{name:'methods/assays.html (1)',exact:true}).click();await expect(d.locator('li')).toContainText('headers');
  expect(routes.some(url=>url.pathname.includes('/research/')||url.pathname.includes('/draft/')||url.origin==='https://example.org')).toBe(false);
  const original=await store.open(siteId);
  await store.save(siteId,{expectedRevision:original.site.revision,path:original.path,html:original.html.replace('Private protocol','Renamed protocol'),css:original.css});
  await d.getByRole('button',{name:'Open in editor',exact:true}).first().click();
  await expect(d).toHaveCount(0);await expect(canvas.getByRole('link',{name:'Renamed protocol'})).toBeVisible();
  await page.evaluate(()=>{window.previewExternal=[];window.open=(...args)=>{window.previewExternal.push(args);return null;};});
  await canvas.getByRole('link',{name:'Citations'}).click();expect(await page.evaluate(()=>window.previewExternal)).toEqual([]);
  await page.getByRole('button',{name:'Dismiss',exact:true}).click();
  await page.getByRole('button',{name:'Preview saved website',exact:true}).click();
  const citation=page.frameLocator('#website-files-preview').getByRole('link',{name:'Citations'});
  await citation.evaluate(node=>node.click());expect(await page.evaluate(()=>window.previewExternal)).toEqual([]);
  await citation.click();expect(await page.evaluate(()=>window.previewExternal)).toEqual([['https://example.org/citations','_blank','noopener,noreferrer']]);
  await page.locator('[data-action="website-files-visual"]').click();
 }finally{
  if(database===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=database;
  try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
 }
});

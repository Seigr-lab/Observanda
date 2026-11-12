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

const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
test.use({screenshot:'off',trace:'off',video:'off'});
test('a presentation is previewed live, undone and redone, and a block takes an uploaded background picture with overlay and shadow',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-presentation-undo-')),book=sampleNotebook();
 const database=process.env.OBSERVANDA_DATABASE_URL;book.entries=[];let app,fixture;
 try{
  fixture=await encryptedFixture(directory,book);
  const store=new WebsiteFileStore(fixture.workspace),siteId=randomUUID(),{examples:[source]}=await seedWebsitePickerCorpus(store,{count:1});
  let opened=await store.importFiles(siteId,{name:'Apiary',files:new Map([['index.html','<!doctype html><html lang="en"><head><title>Apiary</title><link rel="stylesheet" href="style.css"></head><body><main><h1>Apiary</h1><section><h2>Welcome</h2><p>Hives and notes.</p></section></main></body></html>'],['style.css','body{margin:0}']])});
  opened=await store.insertSource(siteId,{path:'index.html',expectedRevision:opened.site.revision,sourceId:source.id,sourceRevision:source.revision});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
  const requests=[];page.on('request',r=>{const route=new URL(r.url()).pathname;if(route.startsWith('/api/'))requests.push(route);});
  await page.goto(app.origin+'/?view=website#'+app.launchToken);await page.locator('[data-website-file-site]').selectOption(siteId);
  const canvas=page.frameLocator('#website-files-canvas'),copy=canvas.locator('section[data-observanda-source="'+source.id+'"]');
  const panel=page.locator('dialog[data-website-presentation]'),toolbar=page.locator('[data-action="website-files-presentation"]:not([data-placement-context])');
  await expect(copy).toHaveCount(1);await toolbar.click();await expect(panel).toBeVisible();
  // Live preview follows the choice before anything is saved.
  const live=panel.getByRole('region',{name:'Live preview of this page'});await expect(live).toBeVisible();
  const preview=panel.frameLocator('iframe');
  await expect(preview.locator('section[data-observanda-source="'+source.id+'"]')).toBeVisible();
  await panel.getByLabel('Layout',{exact:true}).selectOption('plain');
  await expect(preview.locator('section[data-observanda-layout="plain"]')).toHaveCount(1);
  await expect(copy).not.toHaveAttribute('data-observanda-layout','plain');
  expect(requests.filter(route=>route.endsWith('/library/present-placement'))).toHaveLength(0);
  await panel.getByRole('button',{name:'Apply to this copy',exact:true}).click();await expect(panel).not.toBeVisible();
  await expect(copy).toHaveAttribute('data-observanda-layout','plain');
  // The presentation step is undone and redone with the page history.
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(copy).not.toHaveAttribute('data-observanda-layout','plain');
  await page.getByRole('button',{name:'Redo',exact:true}).click();
  await expect(copy).toHaveAttribute('data-observanda-layout','plain');
  // A picture uploaded from the inspector becomes the block's background, with
  // its size, an overlay and a drop shadow chosen in the same place.
  await canvas.getByRole('heading',{name:'Welcome'}).click();
  const inspector=page.locator('.website-visual-style');
  await inspector.getByText('Background, spacing and effects',{exact:true}).click();
  await inspector.locator('input[data-visual-picture-upload]').setInputFiles({name:'hive.png',mimeType:'image/png',buffer:pixel});
  const pictureChoice=inspector.getByLabel('Background picture');
  await expect(pictureChoice).toHaveValue(/url\("pictures\/[a-f0-9-]{36}\.png"\)/);
  await inspector.getByLabel('Picture size').selectOption('cover');
  await inspector.getByLabel('Overlay colour on the picture').fill('#102030');
  await inspector.getByLabel('Overlay strength (0 to 0.9)').fill('0.5');
  await inspector.getByLabel('Shadow').selectOption({label:'Medium'});
  await inspector.getByRole('button',{name:'Apply styles',exact:true}).click();
  const welcome=canvas.locator('section:has(h2:text("Welcome"))');
  // The overlay layer and the picture layer are sized alike.
  await expect(welcome).toHaveCSS('background-size','cover, cover');
  const painted=await welcome.evaluate(node=>{const style=getComputedStyle(node);return {image:style.backgroundImage,shadow:style.boxShadow,strength:style.getPropertyValue('--website-overlay-strength').trim()};});
  expect(painted.image).toContain('linear-gradient');expect(painted.image).toContain('url("blob:');expect(painted.shadow).not.toBe('none');expect(painted.strength).toBe('0.5');
  // Saving uploads the picture with the page and keeps it as a site picture.
  const before=(await store.open(siteId)).site.revision;
  await page.getByRole('button',{name:'Save website',exact:true}).click();
  await expect.poll(async()=>(await store.open(siteId)).site.revision).not.toBe(before);
  const saved=await store.open(siteId),uploaded=/url\("(pictures\/[a-f0-9-]{36}\.png)"\)/.exec(saved.css)?.[1];
  expect(uploaded).toBeTruthy();expect((await store.scope(()=>store.raw(siteId))).files.some(file=>file.name===uploaded&&file.picture)).toBe(true);
  // The saved picture is now offered among the site's pictures.
  await canvas.getByRole('heading',{name:'Welcome'}).click();
  await inspector.getByText('Background, spacing and effects',{exact:true}).click();
  await expect(inspector.getByLabel('Background picture').locator('option',{hasText:/^Picture 1 /})).toHaveCount(1);
 }finally{
  try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{if(database===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=database;}
  if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-presentation-undo-'))throw Error('Unexpected fixture directory');
  await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});
 }
});

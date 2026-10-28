import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {WebsiteSites} from '../../src/website-sites.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {task} from './composer-helper.js';
import {pathToFileURL} from 'node:url';
import {buildBrowser} from '../../scripts/browser-build.js';
import {createApplicationAssets} from '../../src/application-assets.js';

for(const compiled of [false,true])test('website edits paint immediately with delayed saves, failures and retries ('+(compiled?'compiled':'source')+')',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-website-interaction-'));let f,app,release;
 const errors=[],paints=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  const book=sampleNotebook();f=await encryptedFixture(directory,book);const sites=new WebsiteSites(f.workspace),id=(await sites.change({workspaceId:book.id,etag:(await f.workspace.outline()).etag,operation:'create',name:'Responsive editing'})).id,initial=await sites.read(id);
  const sections=Array.from({length:12},(_,i)=>({id:randomUUID(),kind:'text',title:'Element '+i,body:'Retained content '+i,show:true})),home={...initial.book.website.home,enabled:true,sections};
  await sites.save(id,{workspaceId:book.id,baseEtag:initial.etag,websitePin:initial.websitePin,metadata:{website:{...initial.book.website,home}},projects:[],changes:[],removed:[],selection:initial.site.selection});
  let browserAssets;if(compiled){const out=path.join(directory,'browser');await buildBrowser({out});browserAssets=await createApplicationAssets({builtDirectory:pathToFileURL(out+path.sep)});}
  app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0,browserAssets});await page.goto(app.url);await expect(page.getByRole('button',{name:'Menu',exact:true})).toBeVisible();if(compiled)await expect(page.locator('script[type="module"][src^="/assets/app-"]')).toHaveCount(1);await page.goto(new URL('/#/websites/'+id+'/editor',app.url).href);
  const canvas=page.frameLocator('#website-draft-preview');await expect(canvas.locator('[data-section-id]')).toHaveCount(12);
  await canvas.locator('[data-section-id="'+sections[0].id+'"]>.canvas-section-edit').click();
  await expect(page.locator('#website-section-order').getByRole('button',{name:'Remove',exact:true})).toBeVisible();
  let arrived;const waiting=new Promise(resolve=>{arrived=resolve;}),held=new Promise(resolve=>{release=resolve;});let fail=true;const commands=[];
  await page.route('**/api/websites/editor/change',async route=>{
   commands.push(route.request().postDataJSON());if(!fail){await route.continue();return;}arrived();await held;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Temporary checkpoint failure',code:'UNAVAILABLE'})});
  });
  // Moving an existing element must also paint without waiting for storage.
  // Restore its position before the removal so readback remains exact below.
  for(const [direction,first] of [['down',sections[1].id],['up',sections[0].id]]){
   const moved=await page.locator('#website-section-order [data-action="website-section-'+direction+'"]').evaluate(async button=>{const doc=document.querySelector('#website-draft-preview').contentDocument,start=performance.now();button.click();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {first:doc.querySelector('[data-composition="home"]>[data-section-id]').dataset.sectionId,ms:performance.now()-start};});
   paints.push({action:'move-'+direction,ms:moved.ms});expect(moved.first).toBe(first);expect(moved.ms).toBeLessThan(250);
  }
  // Allow the asynchronous event dispatcher and browser paint, but hold the
  // server response: removal must not depend on checkpoint or preview latency.
  const removed=await page.locator('#website-section-order [data-action="website-section-remove"]').evaluate(async button=>{const doc=document.querySelector('#website-draft-preview').contentDocument,id=button.dataset.id,start=performance.now();button.click();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {remaining:Boolean(doc.querySelector('[data-section-id="'+id+'"]')),ms:performance.now()-start};});
  paints.push({action:'remove',ms:removed.ms});expect(removed.remaining).toBe(false);expect(removed.ms).toBeLessThan(250);await waiting;
  await expect(canvas.locator('[data-section-id]')).toHaveCount(11);await expect(page.locator('#save-status')).not.toHaveText('Saved');
  release();await expect(page.locator('[data-action="website-draft-retry"]')).toBeVisible();await expect(canvas.locator('[data-section-id]')).toHaveCount(11);
  fail=false;await page.locator('[data-action="website-draft-retry"]').click();await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeEnabled();
  expect(commands[1].commandId).toBe(commands[0].commandId);expect(commands[1].operations).toEqual(commands[0].operations);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(canvas.locator('[data-section-id]')).toHaveCount(12);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(canvas.locator('[data-section-id]')).toHaveCount(11);
  // The canvas itself also exposes removal, without opening the inspector.
  const second=canvas.locator('[data-section-id="'+sections[1].id+'"]');await second.hover();await second.locator(':scope>.canvas-section-remove').focus();await page.keyboard.press('Enter');await expect(second).toHaveCount(0);
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();await expect(canvas.locator('[data-section-id]')).toHaveCount(10);
  expect((await sites.read(id)).book.website.home.sections).toEqual(sections.slice(2));
  // Insert and duplicate a nested branch while every checkpoint is held.
  // The local composition must be usable before any server preview can exist.
  await page.unroute('**/api/websites/editor/change');const insertionHeld=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/websites/editor/change',async route=>{await insertionHeld;await route.continue();});
  const paintClick=async locator=>{const start=await page.evaluate(()=>performance.now());await locator.evaluate(button=>button.click());return page.evaluate(async start=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return performance.now()-start;},start);};
  await task(page,'Page');expect(await paintClick(page.locator('.insert-grid [data-kind="container"]'))).toBeLessThan(250);
  await expect(canvas.locator('[data-section-id]')).toHaveCount(11);const container=canvas.locator('.section-container');await expect(container).toHaveCount(1);
  expect(await paintClick(page.locator('.insert-grid [data-kind="heading"]'))).toBeLessThan(250);
  await expect(container.locator('.section-heading')).toHaveCount(1);await container.locator('.section-heading>.canvas-section-edit').click();
  await page.getByLabel('Section heading',{exact:true}).fill('Immediate heading');await expect(container.locator('.section-heading>h2')).toHaveText('Immediate heading');
  await page.getByRole('navigation',{name:'Section tools',exact:true}).getByRole('button',{name:'Style',exact:true}).click();
  const padding=page.locator('[data-style-value][data-key="padding"]');await padding.fill('37');await expect(container.locator('.section-heading')).toHaveCSS('padding-top','37px');
  await padding.fill('');await expect(container.locator('.section-heading')).not.toHaveCSS('padding-top','37px');
  expect(await paintClick(page.locator('#website-section-order [data-action="website-section-duplicate"]'))).toBeLessThan(250);await expect(container.locator('.section-heading')).toHaveCount(2);
  await container.screenshot({path:test.info().outputPath('nested-element-controls.png')});
  await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(await paintClick(container.locator(':scope>.canvas-section-remove'))).toBeLessThan(250);await expect(canvas.locator('[data-section-id]')).toHaveCount(10);
  await page.setViewportSize({width:1280,height:900});await task(page,'Page');
  expect(await paintClick(page.locator('.insert-grid [data-kind="popup"]'))).toBeLessThan(250);
  const popup=canvas.locator('.section-popup');await popup.locator(':scope>.canvas-section-edit').click();
  await page.getByLabel('Section heading',{exact:true}).fill('Immediate popup');await page.getByLabel('Popup button label',{exact:true}).fill('Open details');
  await expect(popup.locator(':scope>details>summary')).toHaveText('Open details');await expect(popup.locator(':scope>details>.popup-body>h2')).toHaveText('Immediate popup');
  await task(page,'Page');expect(await paintClick(page.locator('.insert-grid [data-kind="copy-text"]'))).toBeLessThan(250);
  const copy=popup.locator('.section-copy-text');await copy.locator(':scope>.canvas-section-edit').click();
  await page.getByLabel('Section heading',{exact:true}).fill('Exact value');await page.getByLabel('Text to copy',{exact:true}).fill('  CaseSensitive<&> value  ');await page.getByLabel('Description or network',{exact:true}).fill('<literal description>');await page.getByLabel('Copy button label',{exact:true}).fill('Copy exact value');
  await expect(copy.getByRole('textbox',{name:'Exact value',exact:true})).toHaveValue('  CaseSensitive<&> value  ');await expect(copy.locator('.public-copy>.prose')).toHaveText('<literal description>');await expect(copy.locator('.public-copy>button')).toHaveText('Copy exact value');
  expect(await paintClick(popup.locator(':scope>.canvas-section-remove'))).toBeLessThan(250);await expect(canvas.locator('[data-section-id]')).toHaveCount(10);
  release();await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  expect((await sites.read(id)).book.website.home.sections).toEqual(sections.slice(2));
  await page.unroute('**/api/websites/editor/change');await task(page,'Add');
  await page.getByLabel('Upload image, audio or video',{exact:true}).setInputFiles('src/preview-assets/image.png');
  const picture=canvas.locator('.section-asset img');await expect(picture).toHaveCount(1);await canvas.locator('.section-asset>.canvas-section-edit').click();await picture.click();
  const presentationHeld=new Promise(resolve=>{release=resolve;});await page.route('**/api/websites/editor/change',async route=>{await presentationHeld;await route.continue();});
  await page.getByLabel('Image width (%)').fill('60');await page.getByLabel('Image proportions').selectOption('wide');await page.getByLabel('Image fit',{exact:true}).selectOption('cover');
  await expect(picture).toHaveCSS('aspect-ratio','16 / 9');await expect(picture).toHaveCSS('object-fit','cover');
  await task(page,'Site');await page.locator('.site-tools').getByRole('button',{name:'Typography',exact:true}).click();await page.getByRole('button',{name:'Size',exact:true}).click();await page.getByLabel('Body text size (px)',{exact:true}).fill('22');await expect(canvas.locator('body')).toHaveCSS('font-size','22px');
  await task(page,'Site');await page.locator('.site-tools').getByRole('button',{name:'Layout & branding',exact:true}).click();await page.getByRole('navigation',{name:'Site design'}).getByRole('button',{name:'Colors'}).click();await page.getByLabel('Page background',{exact:true}).fill('#f7f1e8');await expect(canvas.locator('body')).toHaveCSS('background-color','rgb(247, 241, 232)');
  release();await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();await expect(canvas.locator('body')).toHaveCSS('font-size','22px');await expect(picture).toHaveCSS('aspect-ratio','16 / 9');
  const final=(await sites.read(id)).book.website;expect(final.palette.background).toBe('#f7f1e8');expect(final.typography.fontSize).toBe(22);expect(final.presentation.media.some(item=>item.width===60&&item.ratio==='wide'&&item.fit==='cover')).toBe(true);expect(errors).toEqual([]);console.log(JSON.stringify({build:compiled?'compiled':'source',paintMeasurements:paints,storage:'disposable local encrypted workspace',checkpoint:'held during measured changes'}));
 }finally{release?.();await page.close();await app?.close();if(f)clearVault(f.vault);expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

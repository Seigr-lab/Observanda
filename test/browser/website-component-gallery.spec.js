import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {createNotebook} from '../../src/model.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

test('an authored gallery becomes a linked library section with edited pictures and a working published viewer on both pages',async({page,browser})=>{
 test.setTimeout(150000);
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-library-galleries-')),out=path.join(root,'Publication');
 const picture=path.resolve('src/preview-assets/image.png'),db=process.env.OBSERVANDA_DATABASE_URL,requests=[];
 let fixture,app,reader;
 try{
  await mkdir(out);fixture=await encryptedFixture(root,createNotebook('Microscopy'));const id=randomUUID(),store=new WebsiteFileStore(fixture.workspace),nested='methods/optics.html';
  const html=title=>'<html lang="en"><head><title>'+title+'</title></head><body><main><h1>'+title+'</h1></main></body></html>';
  await store.importFiles(id,{name:'Microscopy guide',files:new Map([['index.html',html('Microscopy guide')],[nested,html('Optical method')],['style.css','body{padding:2rem;font-family:sans-serif} section{padding:1rem}']])});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(root,'preferences.json'),port:0});page.setDefaultTimeout(15000);
  page.on('request',req=>requests.push(new URL(req.url()).pathname));
  await page.goto(app.origin+'/?view=website#'+app.launchToken);
  const canvas=page.frameLocator('#website-files-canvas'),library=page.locator('[data-website-components]'),pages=page.locator('[data-website-file-page]');
  await expect(canvas.getByRole('heading',{name:'Microscopy guide'})).toBeVisible();
  await page.getByRole('button',{name:'Image gallery',exact:true}).click();
  await page.locator('[data-gallery-files]').setInputFiles(picture);
  await page.locator('[data-gallery-field=alt]').fill('Baseline bead');await page.locator('[data-gallery-field=caption]').fill('Baseline recording');
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  await page.locator('[data-action=website-files-gallery-close]').click();
  await page.getByRole('button',{name:'Reusable library',exact:true}).click();
  await canvas.locator('main > section').click({position:{x:3,y:3}});
  await library.getByLabel('Component name',{exact:true}).fill('Calibration gallery');await library.getByRole('button',{name:'Create from selected block'}).click();
  await expect(library.getByText('Placements 1 · Pages 1')).toBeVisible();
  await pages.selectOption(nested);await expect(canvas.getByRole('heading',{name:'Optical method'})).toBeVisible();
  await library.getByRole('button',{name:'Insert instance'}).click();
  await expect(library.getByText('Placements 2 · Pages 2')).toBeVisible();
  await canvas.locator('[data-website-instance]').click({position:{x:3,y:3}});
  await page.getByRole('button',{name:'Image gallery',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Edit main component'}),editor=dialog.locator('.website-gallery-editor');
  await expect(editor.getByLabel('Image description (alt text)')).toHaveValue('Baseline bead');
  await editor.locator('[data-gallery-files]').setInputFiles(picture);
  await expect(editor.locator('li[data-image-index]')).toHaveCount(2);
  const added=editor.locator('li[data-image-index]').last();await added.getByLabel('Image description (alt text)').fill('Calibrated bead');
  await added.locator('[data-gallery-field=caption]').fill('Reference signal');
  await added.getByRole('button',{name:'Move up'}).click();await editor.locator('[data-gallery-columns]').selectOption('2');
  const wording=dialog.frameLocator('iframe').getByRole('heading').first();
  await wording.click();await dialog.getByRole('button',{name:'Edit text in the page',exact:true}).click();
  await page.keyboard.press('End');await page.keyboard.type(' plates');
  await expect(wording).toHaveText('Image gallery plates');
  await expect(dialog.locator('[data-main-source]')).toHaveValue(/Image gallery plates/);
  await dialog.getByRole('button',{name:'Review component changes'}).click();
  await dialog.getByRole('button',{name:'Update all instances'}).click();await expect(dialog).not.toBeVisible();
  await expect(canvas.locator('[data-image-gallery] img').first()).toHaveAttribute('alt','Calibrated bead');
  await page.getByRole('button',{name:'Publish to folder',exact:true}).click();await page.getByLabel('Destination folder',{exact:true}).fill(out);
  await page.getByRole('button',{name:'Review file changes'}).click();await page.locator('[data-website-file-folder-confirm]').check();await page.getByRole('button',{name:'Write reviewed files'}).click();
  await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible();
  reader=await browser.newPage();
  for(const name of ['index.html',nested]){
   await reader.goto(pathToFileURL(path.join(out,name)).href);
   const images=reader.locator('[data-image-gallery] img');await expect(images).toHaveCount(2);
   await expect(reader.getByRole('heading',{name:'Image gallery plates'})).toBeVisible();
   await expect(images.first()).toHaveAttribute('srcset',/320w, .*480w$/);
   await expect(images.first()).toHaveAttribute('alt','Calibrated bead');await expect(images.last()).toHaveAttribute('alt','Baseline bead');
   await expect(reader.locator('[data-image-gallery]')).toHaveCSS('display','grid');
   await images.first().click();const viewer=reader.getByRole('dialog');await expect(viewer).toBeVisible();await expect(viewer).toContainText('Reference signal');
   await viewer.getByRole('button',{name:'Next image'}).click();await expect(viewer).toContainText('Baseline recording');
   await viewer.getByRole('button',{name:'Close gallery'}).click();await expect(viewer).not.toBeVisible();
   const published=await readFile(path.join(out,name),'utf8');expect(published).not.toMatch(/data-observanda-editor|data:image/);
  }
  expect(requests.some(route=>route.includes('/research/'))).toBe(false);
 }finally{
  if(db===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=db;
  await reader?.close();try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
 }
});

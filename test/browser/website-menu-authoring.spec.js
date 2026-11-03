import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {contentBuffer} from '../../src/file-content.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';

test('open converted navigation in place, drag to nest and publish independent header and footer menus offline',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-menu-authoring-')),database=process.env.OBSERVANDA_DATABASE_URL;
 let fixture,app;
 try{
  const book=sampleNotebook();book.entries=[];fixture=await encryptedFixture(directory,book);
  const store=new WebsiteFileStore(fixture.workspace),id=randomUUID(),method='methods/assay.html';
  const html=(title,prefix)=>'<!doctype html><html lang="en"><head><title>'+title+'</title><link rel="stylesheet" href="'+prefix+'style.css"></head><body><div class="site-top"><a class="site-name" href="'+prefix+'index.html">Optics lab</a><nav aria-label="Website"><ul class="site-menu"><li><a href="'+prefix+'index.html">Overview</a></li><li><a href="'+prefix+method+'">Methods</a></li></ul></nav></div><main><h1>'+title+'</h1><p>Retained scientific writing.</p></main><footer>Optics laboratory</footer></body></html>';
  await store.importFiles(id,{name:'Optics handbook',files:new Map([['index.html',html('Optics handbook','')],[method,html('Assay method','../')],['style.css','.site-menu{display:flex;gap:1rem}.site-top nav{color:rgb(19,82,95)}']])});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
  const requests=[];page.on('request',req=>requests.push(new URL(req.url()).pathname));
  await page.goto(app.origin+'/?view=website#'+app.launchToken);
  const canvas=page.frameLocator('#website-files-canvas'),menu=page.getByRole('region',{name:'Website menu',exact:true});
  await canvas.getByRole('navigation').getByRole('link',{name:'Methods'}).hover();
  await canvas.getByRole('button',{name:'Edit menu',exact:true}).click();
  const preview=menu.frameLocator('[data-menu-preview]');
  await expect(preview.getByRole('navigation')).toHaveCSS('color','rgb(19, 82, 95)');
  const from=menu.getByRole('button',{name:'Move menu item Methods'}),to=menu.getByRole('button',{name:'Overview',exact:true}).locator('..');
  await from.dragTo(to);
  await expect(menu.locator('[data-menu-node][data-depth="1"]')).toContainText('Methods');
  const methods=menu.getByRole('button',{name:'Methods',exact:true});await methods.press('Alt+ArrowLeft');
  await expect(methods.locator('..')).toHaveAttribute('data-depth','0');await methods.press('Alt+ArrowRight');
  await expect(methods.locator('..')).toHaveAttribute('data-depth','1');
  expect((await methods.boundingBox()).x-(await menu.getByRole('button',{name:'Overview',exact:true}).boundingBox()).x).toBeGreaterThan(8);
  await preview.locator('summary').click();await expect(preview.getByRole('link',{name:'Methods'})).toBeVisible();
  await menu.getByRole('button',{name:'Save menu'}).click();await expect(menu.getByRole('button',{name:'Save menu'})).toBeDisabled();
  await menu.getByRole('button',{name:'New menu',exact:true}).click();await menu.getByLabel('Menu name',{exact:true}).fill('Protocol resources');
  await menu.getByLabel('Location on each page').selectOption('footer');await menu.getByRole('button',{name:'Add menu item'}).click();
  await menu.getByLabel('Menu label',{exact:true}).fill('Assay protocol');await menu.getByRole('button',{name:'Choose a page'}).click();await menu.locator('[data-menu-path="'+method+'"]').click();
  await expect(preview.getByRole('link',{name:'Assay protocol'})).toBeVisible();
  await menu.getByRole('button',{name:'Add submenu item'}).click();await menu.getByLabel('Menu label',{exact:true}).fill('Instrument reference');
  await menu.getByLabel('Link',{exact:true}).fill('https://example.org/optics');
  await page.keyboard.press('ControlOrMeta+s');await expect(menu.getByRole('button',{name:'Delete menu'})).toBeEnabled();
  await expect(menu.getByRole('button',{name:'Save menu'})).toBeDisabled();
  await expect(menu.getByRole('combobox',{name:'Navigation menu',exact:true}).locator('option:checked')).toHaveText('Protocol resources');
  await preview.locator('summary').click();await expect(preview.getByRole('link',{name:'Instrument reference'})).toHaveAttribute('href','https://example.org/optics');
  if(process.env.OBSERVANDA_MENU_SCREENSHOT)await menu.screenshot({path:process.env.OBSERVANDA_MENU_SCREENSHOT});
  await menu.getByRole('button',{name:'Return to editing'}).click();
  await page.locator('[data-website-file-page]').selectOption(method);
  await page.getByRole('button',{name:'Preview saved website',exact:true}).click();
  const reader=page.frameLocator('#website-files-preview');await expect(reader.locator('footer nav')).toHaveAccessibleName('Protocol resources');
  await expect(reader.locator('footer nav').getByRole('link',{name:'Assay protocol'})).toHaveAttribute('href','assay.html');
  const exported=await store.export(id);for(const file of ['index.html',method]){
   const text=(await contentBuffer(exported.files.get(file))).toString();expect(text).toContain('Retained scientific writing.');expect(text).toContain('aria-label="Protocol resources"');expect(text).toContain('site-submenu');
  }
  expect(requests.filter(p=>p.startsWith('/api/research/')||p==='/api/storage')).toEqual([]);
 }finally{
  if(database===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=database;
  try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
 }
});

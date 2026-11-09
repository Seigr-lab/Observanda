import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createNotebook} from '../../src/model.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {listWebsiteRecovery} from '../../src/website-recovery.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

// J3: design, reuse, save, deliberate inclusion, renderer recovery and an
// independently read publication, all through the ordinary website editor.
test('a designed page is reused in a nested folder, a private page is included after review and the recovered draft publishes as seen in the editor',async({context,browser})=>{
 test.setTimeout(240000);
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-website-journey-')),folder=path.join(root,'Edition'),database=process.env.OBSERVANDA_DATABASE_URL;
 let app,fixture,reader,page=await context.newPage();
 try{
  await mkdir(folder);fixture=await encryptedFixture(root,createNotebook('Field station'));
  const store=new WebsiteFileStore(fixture.workspace),id=randomUUID();
  const html=(title,body)=>'<!doctype html><html lang="en"><head><title>'+title+'</title><link rel="stylesheet" href="style.css"></head><body><main><h1>'+title+'</h1>'+body+'</main></body></html>';
  await store.importFiles(id,{name:'Field station',files:new Map([['index.html',html('Field station','<p>Welcome to the station.</p>')],
   ['methods.html',html('Methods','<section class="plates"><h2>Plates</h2><p>Plate A</p><p>Plate B</p></section>')],['style.css','body{font-family:sans-serif}']])});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(root,'preferences.json'),port:0});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);
  await page.goto(app.origin+'/?view=website#'+app.launchToken);
  const button=label=>page.getByRole('button',{name:label,exact:true}),canvas=()=>page.frameLocator('#website-files-canvas'),pages=page.locator('[data-website-file-page]');
  const status=page.locator('[data-website-files-status]'),form=page.locator('[data-website-files-form]');
  const save=async()=>{await button('Save website').click();await expect(status).toHaveText('Website saved.');};
  const publish=async()=>{
   await button('Publish to folder').click();await page.getByLabel('Destination folder',{exact:true}).fill(folder);
   await button('Review file changes').click();await page.locator('[data-website-file-folder-confirm]').check();
   await button('Write reviewed files').click();await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible();
   await button('Return to editing').click();
  };

  // Typography and a responsive grid on the methods page.
  await pages.selectOption('methods.html');const plates=canvas().locator('main section');
  await plates.click({position:{x:4,y:4}});
  const appearance=page.locator('[data-website-visual-inspector]'),layout=appearance.locator('.website-layout-inspector');
  await appearance.locator('[data-visual-property="letter-spacing"]').fill('2');await appearance.getByRole('button',{name:'Apply styles',exact:true}).click();
  await expect(plates).toHaveCSS('letter-spacing','2px');
  await layout.locator(':scope > summary').click();
  for(const [view,gap] of [['desktop','24px'],['phone','6px']]){
   await page.locator('[data-website-file-viewport]').selectOption(view);
   if(view==='desktop'){await layout.locator('[data-layout-property="display"]').selectOption('grid');await layout.locator('[data-layout-property="grid-template-columns"]').fill('2');}
   await layout.locator('[data-layout-property="gap"]').fill(gap);await layout.getByRole('button',{name:'Apply layout',exact:true}).click();
  }
  await page.locator('[data-website-file-viewport]').selectOption('desktop');await expect(plates).toHaveCSS('gap','24px');
  await save();

  // Undo and redo keep the draft boundary around a text change.
  const heading=canvas().getByRole('heading',{name:'Methods'});await heading.click();await page.keyboard.press('End');await page.keyboard.type(' and plates');
  await expect(canvas().getByRole('heading',{name:'Methods and plates'})).toBeVisible();
  await button('Undo').click();await expect(canvas().getByRole('heading',{name:'Methods',exact:true})).toBeVisible();
  await button('Redo').click();await expect(canvas().getByRole('heading',{name:'Methods and plates'})).toBeVisible();
  await save();

  // Save the page as a design and reuse it in a nested folder.
  await button('Website pages').click();await button('Page design').click();
  await form.getByLabel('Design name').fill('Plate layout');await form.getByRole('button',{name:'Save design'}).click();await expect(form).not.toBeVisible();
  await button('Add page').click();await form.getByLabel('Page title',{exact:true}).fill('Spring plates');
  await form.getByLabel('Page file name').fill('seasons/spring/plates.html');await form.locator('[data-website-file-field=inclusion]').selectOption('included');
  await form.getByRole('button',{name:'Use a page design'}).click();await form.getByLabel('Page design to use').selectOption({label:'Plate layout'});
  await form.getByRole('button',{name:'Add page',exact:true}).click();
  await expect(canvas().getByRole('heading',{name:'Spring plates'})).toBeVisible();
  const reused=canvas().locator('main section');await expect(reused).toHaveCSS('letter-spacing','2px');await expect(reused).toHaveCSS('gap','24px');

  // A private page stays out of publication until its inclusion is reviewed.
  await button('Add page').click();await form.getByLabel('Page title',{exact:true}).fill('Station logbook');
  await form.getByLabel('Page file name').fill('logbook.html');await expect(form.getByRole('combobox',{name:'Publication',exact:true})).toHaveValue('private');
  await form.getByRole('button',{name:'Add page',exact:true}).click();await expect(canvas().getByRole('heading',{name:'Station logbook'})).toBeVisible();
  await publish();expect(await readdir(folder)).not.toContain('logbook.html');
  await pages.selectOption('logbook.html');await button('Website pages').click();await button('Review inclusion').click();
  await page.getByRole('region',{name:'Review publication changes'}).getByRole('button',{name:'Include in next publication'}).click();

  // Unsaved work survives a renderer termination and is recovered explicitly.
  await pages.selectOption('index.html');const welcome=canvas().locator('main > p');
  await welcome.click();await page.keyboard.press('End');await page.keyboard.insertText(' Open daily.');
  await expect.poll(async()=>(await listWebsiteRecovery(store)).items.length,{timeout:12000}).toBeGreaterThan(0);
  await expect(page.getByText(/Recovery copy saved at/)).toBeVisible();
  const url=page.url(),cdp=await context.newCDPSession(page),crashed=page.waitForEvent('crash');
  void cdp.send('Page.crash').catch(()=>{});await crashed;await page.close();
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);await page.goto(url);
  await expect(page.getByRole('button',{name:'Recover draft',exact:true})).toBeVisible();await page.getByRole('button',{name:'Recover draft',exact:true}).click();
  await expect(page.frameLocator('#website-files-canvas').locator('main > p')).toHaveText('Welcome to the station. Open daily.');
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  await page.getByRole('button',{name:'Publish to folder',exact:true}).click();await page.getByLabel('Destination folder',{exact:true}).fill(folder);
  await page.getByRole('button',{name:'Review file changes',exact:true}).click();await page.locator('[data-website-file-folder-confirm]').check();
  await page.getByRole('button',{name:'Write reviewed files',exact:true}).click();await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible();

  // The independent publication matches the editor at each designed width.
  reader=await browser.newPage();
  await reader.goto(pathToFileURL(path.join(folder,'seasons/spring/plates.html')).href);
  for(const [width,gap] of [[1440,'24px'],[375,'6px']]){
   await reader.setViewportSize({width,height:900});const section=reader.locator('main section');
   await expect(section).toHaveCSS('gap',gap);await expect(section).toHaveCSS('letter-spacing','2px');
  }
  expect(await reader.locator('main section').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(2);
  await reader.goto(pathToFileURL(path.join(folder,'index.html')).href);await expect(reader.locator('main > p')).toHaveText('Welcome to the station. Open daily.');
  await reader.goto(pathToFileURL(path.join(folder,'logbook.html')).href);await expect(reader.getByRole('heading',{name:'Station logbook'})).toBeVisible();
  for(const name of ['index.html','methods.html','logbook.html','seasons/spring/plates.html'])expect(await readFile(path.join(folder,name),'utf8')).not.toMatch(/data-observanda-editor|contenteditable/);
  expect((await listWebsiteRecovery(store)).items).toHaveLength(0);
  expect(errors).toEqual([]);
 }finally{
  if(database===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=database;
  await reader?.close();try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
 }
});

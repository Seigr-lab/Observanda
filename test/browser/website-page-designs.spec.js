import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {createNotebook} from '../../src/model.js';
import {clearVault} from '../../src/encryption.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

test('name a live website page design, use its scientific layout in a nested folder and read the independent publication',async({page,browser})=>{
 test.setTimeout(120000);
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-page-design-ui-')),folder=path.join(root,'Publication');
 let app,fixture,reader;const requests=[],previousDatabase=process.env.OBSERVANDA_DATABASE_URL;
 try{
  await mkdir(folder);fixture=await encryptedFixture(root,createNotebook('Experiments'));
  const store=new WebsiteFileStore(fixture.workspace),id=randomUUID();
  const site=(title,body,css='style.css')=>'<!doctype html><html lang="en"><head><title>'+title+'</title><link rel="stylesheet" href="'+css+'"></head><body><main><h1>'+title+'</h1>'+body+'</main></body></html>';
  const family='Instrument Sans (Display); edition';
  const font=await readFile(new URL('../../src/fonts/atkinson.ttf',import.meta.url));
  await store.importFiles(id,{name:'Microscopy handbook',files:new Map([['index.html',site('Microscopy handbook','<p>Introduction</p>')],['reports/donor.html',site('Protocol','<section class="website-columns"><h2>Donor title</h2><p><a href="../index.html">Example label</a></p><table><thead><tr><th>Batch</th></tr></thead><tbody><tr><td>PRIVATE COMPOSITION VALUE</td></tr></tbody></table></section>','../style.css')],['fonts/design.ttf',font],['style.css','@font-face{font-family:'+JSON.stringify(family)+';src:url(fonts/design.ttf)}body{font-family:sans-serif}.website-columns{display:grid;gap:1rem;padding:18px}']]),draftFiles:new Map([['draft.html',site('Do not choose this','PRIVATE DRAFT')],['draft-styles.css','']])});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(root,'preferences.json'),port:0});
  page.setDefaultTimeout(15000);page.on('request',r=>requests.push(new URL(r.url()).pathname));
  await page.goto(app.origin+'/?view=website#'+app.launchToken);
  const canvas=page.frameLocator('#website-files-canvas'),pages=page.locator('[data-website-file-page]');
  await pages.selectOption('reports/donor.html');await expect(canvas.getByRole('heading',{name:'Protocol'})).toBeVisible();
  const donor=canvas.locator('main section');
  await donor.click({position:{x:4,y:4}});
  const appearance=page.locator('[data-website-visual-inspector]'),layout=appearance.locator('.website-layout-inspector');
  await appearance.locator('[data-visual-property="font-family"]').selectOption({label:family});
  await appearance.locator('[data-visual-property="letter-spacing"]').fill('2');
  await appearance.getByRole('button',{name:'Apply styles',exact:true}).click();
  await expect(donor).toHaveClass(/ow-visual-/);
  await expect(donor).toHaveCSS('letter-spacing','2px');
  await layout.locator(':scope > summary').click();
  for(const [view,gap] of [['desktop','27px'],['tablet','19px'],['phone','7px']]){
   await page.locator('[data-website-file-viewport]').selectOption(view);
   if(view==='desktop'){
    await layout.locator('[data-layout-property="display"]').selectOption('grid');
    await layout.locator('[data-layout-property="grid-template-columns"]').fill('2');
   }
   await layout.locator('[data-layout-property="gap"]').fill(gap);
   await layout.getByRole('button',{name:'Apply layout',exact:true}).click();
  }
  await expect(donor).toHaveCSS('gap','7px');
  const donorClasses=await donor.getAttribute('class');
  await page.getByRole('button',{name:'Save website',exact:true}).click();
  await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  await page.getByRole('button',{name:'Website pages',exact:true}).click();
  await page.getByRole('button',{name:'Page design',exact:true}).click();
  const form=page.locator('[data-website-files-form]');
  await form.getByLabel('Design name').fill('Instrument method');
  await form.getByRole('button',{name:'Save design'}).click();
  await expect(form).not.toBeVisible();
  await page.getByRole('button',{name:'Add page',exact:true}).click();
  await form.getByLabel('Page title',{exact:true}).fill('Sampling sequence');
  await form.getByLabel('Page file name').fill('studies/new/sequence.html');
  await form.getByRole('button',{name:'Use a page design'}).click();
  await form.getByLabel('Page design to use').selectOption({label:'Instrument method'});
  if(process.env.OBSERVANDA_PAGE_DESIGN_SCREENSHOT)await form.screenshot({path:process.env.OBSERVANDA_PAGE_DESIGN_SCREENSHOT});
  await form.getByRole('button',{name:'Add page',exact:true}).click();
  await expect(canvas.getByRole('heading',{name:'Sampling sequence'})).toBeVisible();
  const generated=canvas.locator('main section');
  const copyClasses=await generated.getAttribute('class');
  for(const kind of ['layout','visual']){
   const pattern=new RegExp('ow-'+kind+'-[a-f0-9-]{36}');
   expect(copyClasses).toMatch(pattern);
   expect(copyClasses.match(pattern)[0]).not.toBe(donorClasses.match(pattern)[0]);
  }
  await page.reload();await pages.selectOption('studies/new/sequence.html');await expect(generated).toHaveCSS('letter-spacing','2px');
  await expect(canvas.locator('.website-columns')).toHaveCount(1);await expect(canvas.getByRole('table')).toBeVisible();
  await expect(canvas.getByRole('link')).toHaveAttribute('href','../../index.html');
  await expect(canvas.locator('body')).not.toContainText('PRIVATE COMPOSITION VALUE');
  await page.getByRole('button',{name:'Publish to folder',exact:true}).click();
  await page.getByLabel('Destination folder',{exact:true}).fill(folder);
  await page.getByRole('button',{name:'Review file changes'}).click();await page.locator('[data-website-file-folder-confirm]').check();
  await page.getByRole('button',{name:'Write reviewed files'}).click();await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible();
  reader=await browser.newPage();await reader.goto(pathToFileURL(path.join(folder,'studies/new/sequence.html')).href);
  for(const [width,gap] of [[1440,'27px'],[768,'19px'],[375,'7px']]){
   await reader.setViewportSize({width,height:900});
   await expect(reader.locator('main section')).toHaveCSS('gap',gap);
   await expect(reader.locator('main section')).toHaveCSS('letter-spacing','2px');
   expect(await reader.locator('main section').evaluate(el=>getComputedStyle(el).fontFamily)).toContain(family);
   expect(await reader.locator('main section').evaluate(s=>getComputedStyle(s).gridTemplateColumns.split(' ').length)).toBe(2);
  }
  await expect(reader.locator('.website-columns')).toHaveCSS('display','grid');await expect(reader.getByRole('cell')).not.toHaveText('PRIVATE COMPOSITION VALUE');
  await reader.getByRole('link').click();await expect(reader.getByRole('heading',{name:'Microscopy handbook'})).toBeVisible();
  expect(requests.filter(route=>route.includes('/research/'))).toEqual([]);expect(await readFile(path.join(folder,'studies/new/sequence.html'),'utf8')).not.toContain('Do not choose this');
 }finally{if(previousDatabase===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=previousDatabase;
  await reader?.close();try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:100});}}
});

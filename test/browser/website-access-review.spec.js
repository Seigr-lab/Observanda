import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createNotebook} from '../../src/model.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

test('repair rendered accessibility findings, then read and operate the exported research report using the keyboard',async({page,browser})=>{
 test.setTimeout(150000);
 const dir=await mkdtemp(path.join(os.tmpdir(),'observanda-visual-access-')),out=path.join(dir,'publication'),db=process.env.OBSERVANDA_DATABASE_URL;
 let app,fixture,reader;
 try{
  await mkdir(out);fixture=await encryptedFixture(dir,createNotebook('Field notes'));const id=randomUUID();
  const home='<!doctype html><html lang="en"><head><title>Transect report</title><link rel="stylesheet" href="style.css"></head><body><h1>Transect report</h1><h3>Stations</h3><p class="dim">Depth is measured in metres.</p><img src="plot.svg" role="img" alt=""><section class="chart">A long chart</section><button command="show-modal" commandfor="notes">Read methods</button><dialog id="notes" aria-label="Methods" closedby="none"><p>Three sampling stations.</p></dialog></body></html>';
  const css='body{color:black;background:white} .dim{color:#eee} button:focus-visible{outline:none} @media(max-width:800px){.chart{width:960px}}';
  const files=new WebsiteFileStore(fixture.workspace);
  await files.importFiles(id,{name:'Transect report',files:new Map([['index.html',home],['style.css',css],['plot.svg','<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50"/></svg>']])});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(dir,'preferences.json'),port:0});
  const errors=[];page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));await page.goto(app.origin+'/?view=website#'+app.launchToken);
  const canvas=page.frameLocator('#website-files-canvas'),check=page.getByRole('button',{name:'Check page',exact:true});
  await expect(canvas.getByRole('heading',{name:'Transect report'})).toBeVisible();
  async function review(width=768){
   await check.focus();await check.press('Enter');const panel=page.getByRole('dialog',{name:'Check page'});
   await expect(panel).toBeVisible();await panel.getByLabel('Viewport width in pixels').selectOption(String(width));
   await expect(panel.getByRole('status')).toContainText('at '+width+' px');return panel;
  }
  async function repair(panel,pattern,change,matching={}){
   let row=panel.getByRole('listitem').filter({hasText:pattern});
   if(matching.repairable)row=row.filter({has:page.locator('details')});
   await row.locator('summary').click();if(change)await change(row);
   await row.getByRole('button',{name:'Apply in editor'}).click();await expect(panel).not.toBeVisible();
  }
  let panel=await review();await expect(panel.getByText(/element extends past/)).toBeVisible();
  await panel.getByRole('button',{name:'Keyboard sequence'}).press('Enter');await expect(panel.getByText('1. Read methods')).toBeVisible();
  await panel.getByRole('button',{name:'Keyboard sequence'}).press('Enter');
  await repair(panel,/Text contrast falls/);
  panel=await review();await expect(panel.getByText(/Text contrast falls/)).toHaveCount(0);
  await repair(panel,/Describe the information/,row=>row.getByLabel('Image description (alt text)').fill('Dissolved oxygen at three stations'));
  panel=await review();await repair(panel,/A heading skips/,row=>row.getByLabel('Heading level').selectOption('2'));
  panel=await review();await repair(panel,/main landmark count/);
  panel=await review();await repair(panel,/element extends past/);
  panel=await review();await repair(panel,/focus stays visible/);
  panel=await review();await repair(panel,/Open and close this dialog/,row=>row.getByLabel('Close button label').fill('Return to report'),{repairable:true});
  panel=await review(375);await expect(panel.getByText(/element extends past/)).toHaveCount(0);
  await expect(panel.getByText(/reduced motion enabled/)).toBeVisible();await panel.getByRole('button',{name:'Cancel'}).press('Enter');
  await page.getByRole('button',{name:'Image gallery',exact:true}).click();
  const gallery=page.locator('[data-website-page-gallery]');
  await gallery.locator('input[type=file]').setInputFiles(path.resolve('src/preview-assets/image.png'));
  await gallery.getByLabel('Image purpose').selectOption('decorative');
  await gallery.getByLabel('Accessible link name').fill('Open station photograph');
  await gallery.locator('[data-action=website-files-gallery-close]').click();
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  await page.reload();await expect(canvas.getByRole('img',{name:'Dissolved oxygen at three stations'})).toBeVisible();
  await page.getByRole('button',{name:'Publish to folder',exact:true}).click();await page.getByLabel('Destination folder',{exact:true}).fill(out);
  await page.getByRole('button',{name:'Review file changes'}).click();await page.locator('[data-website-file-folder-confirm]').check();await page.getByRole('button',{name:'Write reviewed files'}).click();
  await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible();
  expect(await readFile(path.join(out,'index.html'),'utf8')).not.toMatch(/data-observanda-editor|website-access-measure/);
  reader=await browser.newPage({viewport:{width:375,height:840},reducedMotion:'reduce'});await reader.goto(pathToFileURL(path.join(out,'index.html')).href);
  const main=reader.getByRole('main');await expect(main.getByRole('heading',{level:2,name:'Stations'})).toBeVisible();
  await expect(main.getByRole('img',{name:'Dissolved oxygen at three stations'})).toBeVisible();
  await expect(main.getByRole('link',{name:'Open station photograph'}).locator('img')).toHaveAttribute('role','presentation');
  expect(await reader.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await reader.keyboard.press('Tab');const trigger=main.getByRole('button',{name:'Read methods'});await expect(trigger).toBeFocused();
  await expect(trigger).toHaveCSS('outline-style','solid');await reader.keyboard.press('Enter');
  const notes=reader.getByRole('dialog',{name:'Methods'});await expect(notes).toBeVisible();
  const tree=await reader.context().newCDPSession(reader);
  try{
   const {nodes}=await tree.send('Accessibility.getFullAXTree');
   expect(nodes.some(node=>!node.ignored&&node.role?.value==='dialog'&&node.name?.value==='Methods')).toBe(true);
   expect(nodes.some(node=>!node.ignored&&node.role?.value==='button'&&node.name?.value==='Return to report')).toBe(true);
  }finally{await tree.detach();}
  await expect(notes.getByRole('button',{name:'Return to report'})).toBeFocused();await reader.keyboard.press('Enter');
  await expect(notes).not.toBeVisible();await expect(trigger).toBeFocused();expect(errors).toEqual([]);
 }finally{
  if(db===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=db;
  await reader?.close();try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(dir,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
 }
});

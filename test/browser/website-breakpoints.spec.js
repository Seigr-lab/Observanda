import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createNotebook} from '../../src/model.js';
import {clearVault} from '../../src/encryption.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

test('author a 1100 px scientific grid, follow its cascade and independently read the published layout across widths',async({page,browser})=>{
 test.setTimeout(90000);page.setDefaultTimeout(8000);
 const root=await mkdtemp(path.join(os.tmpdir(),'website-breakpoints-')),folder=path.join(root,'public'),database=process.env.OBSERVANDA_DATABASE_URL;
 let fixture,app,reader;
 try{
  await mkdir(folder);fixture=await encryptedFixture(root,createNotebook('Instrument atlas'));
  const store=new WebsiteFileStore(fixture.workspace),id=randomUUID();
  const figures=Array.from({length:36},(_,n)=>'<figure><figcaption>Sensor '+(n+1)+'</figcaption><table><tr><th>Time</th><td>'+n+' ms</td></tr></table></figure>').join('');
  const html='<html lang="en"><head><title>Atlas</title><link rel="stylesheet" href="style.css"></head><body><main><section id="plates" class="plates"><h2>Characterization</h2>'+figures+'</section></main></body></html>';
  const original='.plates { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)) } figure { margin:0; min-width:0 } @media (min-width: 450px){figure {border: 1px solid #888}} @container card (min-width: 300px){table {border-collapse:collapse}}';
  await store.importFiles(id,{name:'Instrument atlas',files:new Map([['index.html',html],['style.css',original]])});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/offline';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(root,'prefs.json'),port:0});
  const button=name=>page.getByRole('button',{name,exact:true}),canvas=page.frameLocator('#website-files-canvas'),grid=canvas.locator('#plates');
  const columns=layer=>layer.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(/\s+/).length);
  await page.goto(app.origin+'/?view=website#'+app.launchToken);await expect(grid).toBeVisible();
  await button('Breakpoints').first().click();const d=page.locator('dialog[data-website-ranges]');
  await d.getByRole('button',{name:'Add breakpoint',exact:true}).click();
  await d.getByLabel('Breakpoint name').fill('Instrument grid');await d.getByLabel('Through width (px)').fill('1100');
  await d.getByRole('button',{name:'Keep breakpoint'}).click();await d.getByRole('button',{name:'Review website changes'}).click();
  await expect(d).toContainText('0 stylesheets will change');await d.getByRole('button',{name:'Save website breakpoints'}).click();await expect(d).toHaveCount(0);
  const viewport=page.locator('[data-website-file-viewport]');
  const option=viewport.locator('option').filter({hasText:'Instrument grid'}),breakpoint=await option.getAttribute('value');await viewport.selectOption(breakpoint);
  await canvas.getByRole('heading',{name:'Characterization'}).click();
  const inspector=page.locator('.website-layout-inspector');await inspector.locator('summary').first().click();
  const field=key=>inspector.locator('[data-layout-property="'+key+'"]');
  const applyLayout=inspector.getByRole('button',{name:'Apply layout',exact:true});
  await field('grid-template-columns').fill('2');await field('order').fill('2');await field('visibility').selectOption('visible');await applyLayout.click();
  await expect.poll(()=>columns(grid)).toBe(2);
  const fluid=inspector.locator('.website-fluid-sizing');
  await fluid.locator('summary').click();await fluid.getByLabel('Minimum',{exact:true}).fill('6');
  await fluid.getByLabel('Preferred',{exact:true}).fill('2');await fluid.getByLabel('Maximum',{exact:true}).fill('24');
  await fluid.getByRole('button',{name:'Apply fluid size'}).click();await expect(grid).toHaveCSS('column-gap','22px');
  const trace=inspector.locator('details').filter({has:page.getByText('Inspect layout at this width',{exact:true})});
  await trace.locator('summary').click();await trace.locator('select').selectOption('grid-template-columns');
  await expect(trace.locator('output')).toContainText('@media (max-width: 1100px)');
  const at=async value=>{
   if(await viewport.inputValue()!=='custom')await viewport.selectOption('custom');
   const width=page.locator('[data-viewport-width]');await width.fill(String(value));await width.press('Enter');
  };
  await at(1099);await expect(trace.locator('output')).toContainText('At 1099 px');await expect.poll(()=>columns(grid)).toBe(2);
  await at(1101);await expect(trace.locator('output')).toContainText('from .plates.');await expect.poll(()=>columns(grid)).toBe(4);
  await at(1100);await expect(grid).toHaveCSS('order','2');
  await field('order').fill('');await applyLayout.click();await expect(grid).toHaveCSS('order','0');await expect.poll(()=>columns(grid)).toBe(2);
  await button('Save website').click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  const saved=await store.open(id);expect(saved.css).toContain(original);expect(saved.css).toContain('@media (max-width: 1100px)');expect(saved.css).toContain('clamp(6px, 2vw, 24px)');
  await button('Publish to folder').click();await page.getByLabel('Destination folder',{exact:true}).fill(folder);
  await button('Review file changes').click();await page.locator('[data-website-file-folder-confirm]').check();await button('Write reviewed files').click();
  await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible();
  expect(await readFile(path.join(folder,'style.css'),'utf8')).toContain(original);
  reader=await browser.newPage();await reader.goto(pathToFileURL(path.join(folder,'index.html')).href);
  const published=reader.locator('#plates');await expect(published.locator('figure')).toHaveCount(36);
  const failures=[];
  for(let width=320;width<=1440;width++){
   await reader.setViewportSize({width,height:800});
   const size=await published.evaluate(el=>{
    const view=el.ownerDocument.defaultView,style=view.getComputedStyle(el);
    return {columns:style.gridTemplateColumns.split(/\s+/).length,gap:parseFloat(style.columnGap)||0,overflows:document.documentElement.scrollWidth>view.innerWidth,order:style.order};
   });
   if(size.columns!==(width<=1100?2:4)||Math.abs(size.gap-(width<=1100?width*.02:0))>.01||size.overflows||size.order!=='0')failures.push({width,...size});
  }
  expect(failures.slice(0,5)).toEqual([]);
 }finally{
  if(database===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=database;
  await reader?.close();try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(root,{recursive:true,force:true,maxRetries:10});}
 }
});

import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {WebsiteFileStore,websiteSourceId} from '../../src/website-file-store.js';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';

async function drag(page,source,target,edge,{outline=false,capture=false}={}){
 await source.scrollIntoViewIfNeeded();const a=await source.boundingBox(),b=await target.boundingBox();
 const x=b.x+b.width*.55,y=b.y+(edge==='before'?3:edge==='after'?b.height-3:b.height/2);
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
 await page.mouse.move(a.x+a.width/2+9,a.y+a.height/2,{steps:4});
 await page.mouse.move(x,y,{steps:12});await page.mouse.move(x+1,y);
 try{
  if(outline)await expect(target).toHaveAttribute('data-layer-drop',edge);
  else await expect(page.locator('.website-layer-drop-guide')).toHaveAttribute('data-position',edge);
  if(capture&&process.env.OBSERVANDA_SECTION_DRAG_SCREENSHOT)await page.screenshot({path:process.env.OBSERVANDA_SECTION_DRAG_SCREENSHOT});
 }
 finally{await page.mouse.up();}
}

test('reorder a converted masthead, card and permitted entry from the canvas and outline with research offline',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(8000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-section-drag-')),previous=process.env.OBSERVANDA_DATABASE_URL;
 let fixture,app;
 try{
  const book=sampleNotebook();book.entries=[];fixture=await encryptedFixture(directory,book);
  const store=new WebsiteFileStore(fixture.workspace),id=randomUUID();
  const html='<!doctype html><html lang="en"><head><title>Field atlas</title><link rel="stylesheet" href="style.css"></head><body><a class="skip" href="#main">Skip to content</a><div class="site-top"><a href="index.html">Field atlas</a><nav aria-label="Website"><a href="index.html">Home</a></nav></div><header class="site-header"><p>Instrument field notes</p></header><div class="page-frame"><main id="main"><div class="page-composition"><section id="overview"><p>Sampling overview</p></section><section id="manifesto"><h2>Method card</h2><p>Sensor calibration details</p></section></div></main></div><footer class="site-footer"><p>Field research</p></footer></body></html>';
  const css='body{margin:0;background:#f7f7f0;color:#173b3a;font:16px/1.5 system-ui}.skip{position:absolute;left:-9999px}nav{float:right}a{color:#145c58}.site-top,header,section,footer{box-sizing:border-box;padding:12px 24px;min-height:48px;border-bottom:1px solid #b9c9bf}section{min-height:64px}#manifesto{border:1px solid #b9c9bf;border-radius:6px;background:white;margin:6px 12px}p,h2{margin:0}';
  const imported=await store.importFiles(id,{name:'Field atlas',files:new Map([['index.html',html],['style.css',css]])});
  const provenance={workspaceId:fixture.workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()},sourceId=websiteSourceId(provenance);
  const token=await store.beginSourceUpdate({sourceId,provenance,target:'website'});
  await store.putSource({sourceId,provenance,title:'Spore count',html:'<article><h2 data-observanda-part="name">Spore count</h2><p data-observanda-part="body">Six plots</p></article>'},{token});
  await store.insertSource(id,{sourceId,expectedRevision:imported.site.revision});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
  const research=[];page.on('request',r=>{if(new URL(r.url()).pathname.includes('/research/'))research.push(r.url());});
  await page.goto(app.origin+'/?view=website#'+app.launchToken);
  const canvas=page.frameLocator('#website-files-canvas'),intro=canvas.locator('header.site-header'),card=canvas.locator('#manifesto'),overview=canvas.locator('#overview');
  const grip=canvas.getByRole('button',{name:'⠿ Move',exact:true}),source=canvas.locator('[data-observanda-source]');
  await expect(intro).toContainText('Instrument field notes');await intro.hover();await expect(grip).toBeVisible();
  await drag(page,grip,overview,'before');await expect(canvas.locator('main .page-composition > header + #overview')).toHaveCount(1);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(canvas.locator('body > header')).toHaveCount(1);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(canvas.locator('main header')).toHaveCount(1);
  await card.hover();await drag(page,grip,intro,'before',{capture:true});await expect(canvas.locator('#manifesto + header')).toHaveCount(1);
  const list=page.locator('[data-website-files-structure]');await page.getByRole('searchbox',{name:'Filter page layers'}).fill('Spore count');
  const entryHandle=list.getByRole('button',{name:/^Drag Spore count to move/}).first();
  await drag(page,entryHandle,card,'after');await expect(canvas.locator('#manifesto + [data-observanda-source]')).toHaveCount(1);
  await source.locator('[data-observanda-part="body"]').hover();
  expect(await source.getAttribute('data-observanda-source')).toBe(sourceId);
  await page.getByRole('searchbox',{name:'Filter page layers'}).fill('Field research');
  const footer=list.getByRole('button',{name:'Field research',exact:true}).first().locator('xpath=ancestor::li[1]');
  await intro.hover();await drag(page,grip,footer,'before',{outline:true});await expect(canvas.locator('body > header + footer')).toHaveCount(1);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(canvas.locator('main header')).toHaveCount(1);
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  const saved=await store.open(id);expect(saved.html).not.toMatch(/data-layer-|website-layer-drop-guide|data-observanda-editor/);
  await page.reload();await expect(canvas.locator('#manifesto + [data-observanda-source] + header + #overview')).toHaveCount(1);
  await page.getByRole('button',{name:'Preview saved website',exact:true}).click();
  const preview=page.frameLocator('#website-files-preview');await expect(preview.locator('#manifesto + [data-observanda-source]')).toContainText('Six plots');
  await expect(preview.locator('header + #overview')).toHaveCount(1);await expect(preview.getByRole('navigation',{name:'Website'})).toBeVisible();
  expect(research).toEqual([]);
 }finally{
  if(previous===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=previous;
  try{await page.close();await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
 }
});

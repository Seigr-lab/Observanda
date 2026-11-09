import {test,expect} from '@playwright/test';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createNotebook} from '../../src/model.js';
import {clearVault} from '../../src/encryption.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

test('fitted canvas, saved preview and a published website agree with an independent browser at each CSS breakpoint',async({page,browser})=>{
 test.setTimeout(120000);
 await page.setViewportSize({width:1024,height:900});
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-logical-viewport-')),folder=path.join(directory,'edition');
 let fixture,app,reader,pixels;
 try{
  await mkdir(folder);fixture=await encryptedFixture(directory,createNotebook('Research station'));
  const html='<!doctype html><html lang="en"><head><title>Plot comparison</title><link rel="stylesheet" href="style.css"></head><body><main><h1>Plot comparison</h1><div id="plots"><article id="first">River</article><article id="second">Lake</article><article id="third">Forest</article></div></main></body></html>';
  const css='html,body,main{margin:0;padding:0}#plots{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;background:rgb(90,44,30)}#plots article{background:rgb(24,122,93);color:white;padding:18px}'+
   '@media(max-width:900px){#plots{grid-template-columns:repeat(2,1fr)}}@media(max-width:600px){#plots{grid-template-columns:1fr}}';
  await new WebsiteFileStore(fixture.workspace).create({name:'Plot comparison',html,css});
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
  await page.goto(app.origin+'/?view=website#'+app.launchToken);
  const button=name=>page.getByRole('button',{name,exact:true}),canvas=page.frameLocator('#website-files-canvas');
  await expect(canvas.locator('#plots article')).toHaveCount(3);
  await expect(page.locator('.website-files-editor>aside').first()).toBeVisible();
  await expect(page.locator('.website-files-inspection')).toBeVisible();
  // Publish through the application, then load those exact files independently.
  await button('Publish to folder').click();await page.getByLabel('Destination folder',{exact:true}).fill(folder);
  await button('Review file changes').click();await page.locator('[data-website-file-folder-confirm]').check();await button('Write reviewed files').click();
  await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible();
  await page.reload();await expect(canvas.locator('#plots')).toBeVisible();
  reader=await browser.newPage();pixels=await browser.newPage();await reader.goto(pathToFileURL(path.join(folder,'index.html')).href);
  async function geometry(node){
   return node.evaluate(el=>{
    const r=el.querySelector('#second').getBoundingClientRect();
    return {width:el.ownerDocument.defaultView.innerWidth,columns:getComputedStyle(el).gridTemplateColumns,x:r.x,y:r.y,w:r.width,h:r.height};
   });
  }
  for(const [choice,width] of [['desktop',1440],['phone',375],['tablet',768],['custom',900],['custom',901],['custom',1124]]){
   await page.locator('[data-website-file-viewport]').selectOption(choice);
   if(choice==='custom'){const field=page.locator('[data-viewport-width]');await field.fill(String(width));await field.press('Enter');await field.blur();}
   await expect.poll(()=>canvas.locator('body').evaluate(el=>el.ownerDocument.defaultView.innerWidth)).toBe(width);
   await expect(page.locator('[data-viewport-readout]')).toContainText(width+' × ');
   await expect(page.locator('[data-viewport-readout]')).toContainText(width<=600?'≤ 600 px':width<=900?'601–900 px':'> 900 px');
   const logical=await geometry(canvas.locator('#plots'));
   await reader.setViewportSize({width,height:900});
   expect(logical).toEqual(await geometry(reader.locator('#plots')));
   const box=await page.locator('#website-files-canvas').boundingBox();
   const painted=await canvas.locator('#second').boundingBox(),scale=box.width/width;
   expect(Math.abs(painted.x-box.x-logical.x*scale)).toBeLessThan(1);
   expect(Math.abs(painted.y-box.y-logical.y*scale)).toBeLessThan(1);
   const trail=page.locator('[data-layer-trail] [aria-current]');
   await canvas.locator('#first').click();await expect(trail).toHaveText('first');
   await page.mouse.click(painted.x+painted.width/2,painted.y+painted.height/2);
   await expect(trail).toHaveText('second');
   if(width===1440)expect(scale).toBeLessThan(0.7);
   // The gap is above the second article when the grid has a single column.
    for(const [view,article,ratio] of [[page,painted,scale],[reader,await reader.locator('#second').boundingBox(),1]]){
     const screenshot=await view.screenshot();
     const outside=logical.x>0?[-5,15]:[10,-5],inside=[10,15];
     const points=[outside,inside].map(([dx,dy])=>[Math.round(article.x+dx*ratio),Math.round(article.y+dy*ratio)]);
     const colors=await pixels.evaluate(async({data,points})=>{
      const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();
      const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
      return points.map(([x,y])=>Array.from(ctx.getImageData(x,y,1,1).data).slice(0,3));
     },{data:screenshot.toString('base64'),points});
     expect(colors).toEqual([[90,44,30],[24,122,93]]);
    }
  }
  const startingWidth=(await page.locator('#website-files-canvas').boundingBox()).width;
  await page.setViewportSize({width:1280,height:900});
  await expect.poll(async()=>(await page.locator('#website-files-canvas').boundingBox()).width).toBeGreaterThan(startingWidth);
  expect(await geometry(canvas.locator('#plots'))).toEqual(await geometry(reader.locator('#plots')));
  await page.setViewportSize({width:1024,height:900});
  await expect.poll(async()=>(await page.locator('#website-files-canvas').boundingBox()).width).toBe(startingWidth);
  await page.locator('[data-viewport-zoom]').selectOption('actual');
  await expect.poll(async()=>Math.round((await page.locator('#website-files-canvas').boundingBox()).width)).toBe(1124);
  const host=page.locator('[data-viewport-host]');
  await host.evaluate(el=>{el.scrollLeft=el.scrollWidth;});
  await expect.poll(()=>host.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
  await canvas.locator('#third').click();await expect(page.locator('[data-layer-trail] [aria-current]')).toHaveText('third');
  await page.locator('[data-viewport-zoom]').selectOption('fit');
  await expect.poll(()=>host.evaluate(el=>el.scrollLeft)).toBe(0);
  // Place the selected article using physical window coordinates while zoomed.
  await canvas.locator('#second').click();
  const layout=page.locator('.website-layout-inspector');
  await layout.locator(':scope > summary').click();
  const coordinates=layout.locator('.website-layout-composer > details').last();
  await coordinates.locator(':scope > summary').click();
  await coordinates.getByLabel('Coordinate units').selectOption('px');
  await coordinates.getByRole('button',{name:'Choose a point in the canvas'}).click();
  const grid=await canvas.locator('#plots').boundingBox(),point={x:grid.x+grid.width*.24,y:grid.y+grid.height*.64};
  await page.mouse.click(point.x,point.y);
  await expect(canvas.locator('#second')).toHaveCSS('position','absolute');
  const moved=await canvas.locator('#second').boundingBox();
  expect(Math.abs(moved.x-point.x)).toBeLessThan(2);expect(Math.abs(moved.y-point.y)).toBeLessThan(2);
  await button('Undo').click();
  await button('Preview saved website').click();
  const preview=page.frameLocator('#website-files-preview');await expect(preview.locator('#plots')).toBeVisible();
  await expect.poll(()=>geometry(preview.locator('#plots'))).toEqual(await geometry(reader.locator('#plots')));
  await page.locator('[data-website-file-viewport]').selectOption('phone');await reader.setViewportSize({width:375,height:900});
  await expect.poll(()=>geometry(preview.locator('#plots'))).toEqual(await geometry(reader.locator('#plots')));
 }finally{await pixels?.close();await reader?.close();await app?.close();if(fixture)await clearVault(fixture.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

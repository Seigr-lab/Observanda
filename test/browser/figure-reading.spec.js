import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {createFigure} from '../../src/web/figure-model.js';
import {createComposition} from '../../src/web/figure-composition.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {buildPublication} from '../../src/publication.js';

function fixtureBook(){
 const book=upgradeNotebook(sampleNotebook()),record=book.entries[0],plot=createFigure();
 plot.title='Close measurements';plot.x.label='Elapsed ratio';plot.y.label='Response ratio';plot.x.min=plot.y.min=1;plot.x.max=plot.y.max=1.000000004;
 plot.series[0].points=[{x:1,y:1,error:null},{x:1.000000002,y:1.000000002,error:1e-10},{x:1.000000004,y:1.000000004,error:null}];
 const panels=createComposition([plot,plot]);panels.title='Linked response comparison';panels.layout.linkX=panels.layout.linkY=true;
 record.figures=[plot,panels];record.sections=[];record.attachments=[];record.relations=[];record.share=true;book.entries=[record];return {book,record};
}
const noOverflow=page=>expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
async function inspect(page,root,{image=false,keyboard=false}={}){
 const displays=root.locator('.figure-reading-view');await expect(displays).toHaveCount(2);
 for(const [i,display] of (await displays.all()).entries()){
  const toggle=display.getByRole('checkbox',{name:'Enlarge figure',exact:true}),viewport=display.getByRole('region');
  if(keyboard){await toggle.focus();await page.keyboard.press('Space');}else await toggle.check();
  await expect(toggle).toBeChecked();await expect(display.locator('.figure-reading-hint')).toBeVisible();
  await expect.poll(()=>viewport.evaluate(el=>el.scrollWidth>el.clientWidth+100)).toBe(true);await noOverflow(page);
  if(image&&i===0){await expect.poll(()=>viewport.locator('img').evaluate(el=>el.complete&&el.naturalWidth===840&&el.getBoundingClientRect().width>=840)).toBe(true);}
  else{
   const fonts=await viewport.locator('.figure-value-tick,.figure-coordinate-tick').evaluateAll(nodes=>nodes.map(node=>parseFloat(getComputedStyle(node).fontSize)*node.ownerSVGElement.getBoundingClientRect().width/node.ownerSVGElement.viewBox.baseVal.width));
   expect(fonts.length).toBeGreaterThan(3);expect(Math.min(...fonts)).toBeGreaterThanOrEqual(10);
  }
  await test.step('Pan figure '+i+' using the keyboard',async()=>{await viewport.focus();await page.keyboard.press('ArrowRight');await expect.poll(()=>viewport.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);});
  await test.step('Return figure '+i+' to fitted size',async()=>{if(keyboard){await toggle.focus();await page.keyboard.press('Space');}else await toggle.uncheck();await expect(toggle).not.toBeChecked();await expect(display.locator('.figure-reading-hint')).not.toBeVisible();});
  await expect.poll(()=>viewport.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await noOverflow(page);
 }
}

test('record and lab-book readers enlarge precise figures without entering editing or writing records',async({page},info)=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-figure-reading-')),{book,record}=fixtureBook(),f=await encryptedFixture(directory,book),before=await f.workspace.read(),app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences')}),errors=[],writes=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(new URL(request.url()).pathname==='/api/research/records/save')writes.push(request.url());});
 try{
  await page.setViewportSize({width:390,height:844});await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id+'/read',record.id);
  const reader=page.locator('.record-reader');await expect(reader.locator('.figure-reading-view')).toHaveCount(2);await inspect(page,reader);
  const toggle=reader.getByRole('checkbox',{name:'Enlarge figure',exact:true}).first();await toggle.check();await toggle.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('precise-figure-reading-phone.png')});
  await page.emulateMedia({media:'print'});await expect(toggle).not.toBeVisible();await noOverflow(page);await page.emulateMedia({media:'screen'});
  await page.evaluate(id=>location.hash='#/notebooks/'+id+'/read',record.notebookId);const records=page.locator('[data-reading-record]');await expect(records).toHaveCount(1);await inspect(page,records);
  await expect(page.locator('[contenteditable=true]')).toHaveCount(0);expect((await f.workspace.read()).etag).toBe(before.etag);expect(writes).toEqual([]);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('exported scientific figures can be inspected at native size with JavaScript disabled',async({browser},info)=>{
 const {book,record}=fixtureBook(),publication=buildPublication(book),filename=[...publication.files].find(([name,body])=>name.endsWith('.html')&&String(body).includes('id="record-figure-'+record.figures[0].id+'"'))[0];
 const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}}),page=await context.newPage();
 await page.route('https://figure-reading.test/**',route=>{
  const file=publication.files.get(decodeURIComponent(new URL(route.request().url()).pathname.slice(1)));
  const extension=path.extname(new URL(route.request().url()).pathname),type={'.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.js':'text/javascript'}[extension]??'application/octet-stream';
  return route.fulfill(file===undefined?{status:404}:{status:200,contentType:type,body:typeof file==='string'?file:Buffer.from(file)});
 });
 try{
  await page.goto('https://figure-reading.test/'+filename);await inspect(page,page.locator('.record-page'),{image:true,keyboard:true});
  const plot=page.locator('#record-figure-'+record.figures[0].id);await plot.getByRole('checkbox',{name:'Enlarge figure',exact:true}).focus();await page.keyboard.press('Space');await page.screenshot({path:info.outputPath('exported-figure-native-size.png')});
 }finally{await context.close().catch(()=>{});}
});

test('historical comparisons keep each figure revision bound to its own clipping geometry',async({page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-figure-history-')),{book,record}=fixtureBook(),f=await encryptedFixture(directory,book);
 const saved=await f.workspace.read();saved.book.entries[0].figures[0].style={fontSize:24};await f.workspace.save(saved.book,saved.etag);
 const before=await f.workspace.read(),app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences')});
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id+'/read',record.id);await expect(page.locator('.record-reader .figure-reading-view')).toHaveCount(2);
  await page.getByRole('button',{name:'History',exact:true}).click();const dialog=page.locator('#dialog');await dialog.getByRole('button',{name:'Review version',exact:true}).click();
  await dialog.getByText('Compare with current saved version',{exact:true}).click();
  const clips=await dialog.locator('.figure-series-graphic').evaluateAll(nodes=>nodes.map(node=>{
   const id=node.getAttribute('clip-path').match(/^url\(#(.+)\)$/)?.[1],target=id&&document.getElementById(id);
   return {local:target?.ownerSVGElement===node.ownerSVGElement,unique:[...document.querySelectorAll('clipPath')].filter(el=>el.id===id).length};
  }));
  expect(clips.length).toBeGreaterThanOrEqual(3);for(const clip of clips){expect(clip.local).toBe(true);expect(clip.unique).toBe(1);}
  const columns=dialog.locator('.record-revision-columns');await expect(columns.locator('.figure-reading-view').first().locator('.figure-value-tick').first()).toHaveAttribute('font-size','12');
  await expect(columns.locator('>div').last().locator('.figure-reading-view').first().locator('.figure-value-tick').first()).toHaveAttribute('font-size','24');
  expect((await f.workspace.read()).etag).toBe(before.etag);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

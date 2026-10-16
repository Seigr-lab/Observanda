import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {createFigure} from '../../src/web/figure-model.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {buildPublication} from '../../src/publication.js';

test('small measurement differences have distinct visible axes in the reader and exported page',async({page},info)=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-precise-axis-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0],plot=createFigure();
 plot.title='Small timing differences';plot.x.label='Local interval ratio';plot.y.label='Returned interval ratio';plot.x.min=plot.y.min=1;plot.x.max=plot.y.max=1.000000004;
 plot.series[0].points=[{x:1,y:1,error:null},{x:1.000000002,y:1.000000001,error:1e-10},{x:1.000000004,y:1.000000004,error:null}];
 record.figures=[plot];record.sections=[];record.attachments=[];record.relations=[];record.share=true;book.entries=[record];
 const f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences')}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const check=async root=>{
  for(const axis of ['value','coordinate']){
   const labels=await root.locator('.figure-'+axis+'-tick').evaluateAll(nodes=>nodes.map(node=>({text:[...node.querySelectorAll('tspan')].map(s=>s.textContent).join(''),bounds:node.getBoundingClientRect().toJSON(),frame:node.ownerSVGElement.getBoundingClientRect().toJSON()})));
   expect(labels.length).toBeGreaterThanOrEqual(2);expect(new Set(labels.map(l=>l.text)).size).toBe(labels.length);
   for(const label of labels){expect(label.text).not.toContain('…');expect(label.bounds.left).toBeGreaterThanOrEqual(label.frame.left-1);expect(label.bounds.right).toBeLessThanOrEqual(label.frame.right+1);}
  }
 };
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id+'/read',record.id);
  const reader=page.locator('.record-reader');await expect(reader.locator('.figure-value-tick').first()).toBeVisible();await check(reader);
  await reader.locator('svg').first().screenshot({path:info.outputPath('precise-axis-reader.png')});
  await page.setViewportSize({width:390,height:844});await check(reader);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const publication=buildPublication(book),[filename,html]=[...publication.files].find(([name,body])=>name.endsWith('.html')&&String(body).includes('id="record-figure-'+plot.id+'"'));
  // Read the generated SVG as a browser, independently of the app's renderer.
  const output=await page.context().newPage();await output.setContent(String(html),{waitUntil:'domcontentloaded'});
  const figure=output.locator('#record-figure-'+plot.id),source=await figure.locator('img').getAttribute('src'),svg=publication.files.get(path.posix.normalize(path.posix.join(path.posix.dirname(filename),source)));
  expect(svg).toBeDefined();await output.setContent(String(svg));await check(output.locator('svg'));await output.close();
  expect((await f.workspace.read()).book.entries[0].figures).toEqual([plot]);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

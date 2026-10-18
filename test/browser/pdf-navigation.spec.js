import {test,expect} from '@playwright/test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {PdfDocuments} from '../../src/pdf-documents.js';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {installPdfRenderer} from '../../src/pdf-render-service.js';
import {measurePdfPreflight} from '../../src/pdf-preflight.js';
import {navigate} from './preferences-helper.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function painted(canvases,count){
 await expect(canvases).toHaveCount(count);
 await expect.poll(()=>canvases.evaluateAll(nodes=>nodes.every(canvas=>{
  if(canvas.width<2||canvas.height<2||canvas.width>224||canvas.height>316)return false;
  const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>0&&Math.min(pixels[i],pixels[i+1],pixels[i+2])<180)return true;
  return false;
 }))).toBe(true);
}

test('PDF outline navigation and movement retain history while bounded thumbnails follow the current rendered edition',async({page,browser})=>{
 test.setTimeout(150000);page.setDefaultTimeout(15000);
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-pdf-navigation-ui-')),fixture=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'}),errors=[],rendered=[];
 const releaseWorker=deferred(),workerFinished=deferred();let holdWorker=false,workerHeld=false;
 const removeRenderer=installPdfRenderer(async input=>{
  const view=await browser.newPage();try{
   await view.route('**/*',route=>route.abort());await view.setContent(input.html);await view.evaluate(()=>document.fonts.ready);
   rendered.push(await view.locator('body').innerText());
   const preflight=await view.evaluate(measurePdfPreflight),bytes=await view.pdf({preferCSSPageSize:true,printBackground:true});
   return {bytes,preflight,sha256:createHash('sha256').update(bytes).digest('hex'),renderer:{engine:'chromium',electron:'test',chromium:browser.version(),recipeVersion:1}};
  }finally{await view.close();}
 });
 const app=await startServer({root:fixture.workspace.root,port:0,headless:true,deviceStore:fixture.deviceStore}),documents=new PdfDocuments(fixture.workspace,(await fixture.workspace.outline()).metadata.id);
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/vendor/pdfjs/pdf.worker.js',async route=>{
  if(!holdWorker){await route.continue();return;}holdWorker=false;workerHeld=true;
  await releaseWorker.promise;try{await route.continue();}catch{}finally{workerFinished.resolve();}
 });
 try{
  const id=randomUUID(),sections=Array.from({length:25},(_,index)=>({id:randomUUID(),title:'Section '+String(index+1).padStart(2,'0'),content:'Retained observation '+(index+1)+'.',layout:null,start:'page'}));
  const change=(expectedRevision,operation)=>documents.change({id,commandId:randomUUID(),expectedRevision,operation});
  let saved=await change(null,{type:'create',header:{version:1,id,name:'Navigation workbook',language:'en',direction:'ltr',layout:pdfLayoutPreset()},section:sections[0]});
  for(const section of sections.slice(1))saved=await change(saved.revision,{type:'append',section});
  const originalRevision=saved.revision;
  await page.goto(app.url);await navigate(page,'PDF editor');const ui=page.locator('[data-pdf-editor]');await ui.getByRole('button',{name:'Navigation workbook',exact:true}).click();
  const outline=ui.locator('[data-pdf-outline]'),title=ui.getByLabel('Section title',{exact:true}),content=ui.getByRole('textbox',{name:'Content',exact:true});
  await outline.locator('summary').click();await outline.locator('[data-command="outline-search"]').click();await expect(outline.locator('[data-command="outline-open"]')).toHaveCount(20);
  await outline.locator('[data-command="outline-next"]').click();await expect(outline.locator('[data-command="outline-open"]')).toHaveCount(5);await expect(outline.getByRole('button',{name:'25. Section 25',exact:true})).toBeVisible();
  await outline.locator('[data-pdf-outline-query]').fill('Section 25');await outline.locator('[data-command="outline-search"]').click();await expect(outline.locator('[data-command="outline-open"]')).toHaveCount(1);await outline.getByRole('button',{name:'25. Section 25',exact:true}).click();await expect(title).toHaveValue('Section 25');await expect(content).toHaveText('Retained observation 25.');
  await expect(outline).toHaveAttribute('open','');await outline.locator('[data-pdf-outline-position]').fill('1');await outline.locator('[data-command="outline-move"]').click();await expect(ui.getByRole('navigation',{name:'Sections',exact:true}).getByRole('button').first()).toHaveText('Section 25');
  const moved=await documents.read('open',{id});expect(moved.revision).not.toBe(originalRevision);expect((await documents.read('sections',{id,revision:originalRevision})).items[0].id).toBe(sections[0].id);expect((await documents.read('sections',{id,revision:moved.revision})).items[0].id).toBe(sections[24].id);
  expect((await documents.read('history',{id})).items.some(item=>item.revision===originalRevision)).toBe(true);
  await page.reload();await expect(title).toHaveValue('Section 25');await expect(content).toHaveText('Retained observation 25.');
  await ui.getByRole('button',{name:'Preview PDF',exact:true}).click();const frame=ui.locator('[data-pdf-preview] iframe'),pages=ui.locator('[data-pdf-pages]'),canvases=pages.locator('canvas');
  await expect(frame).toBeVisible();await expect(pages.locator('[data-pdf-page-number]')).toHaveAttribute('max','25');await painted(canvases,6);expect(rendered).toHaveLength(1);
  await pages.locator('[data-command="pdf-page-next"]').click();await expect(canvases.first()).toHaveAttribute('data-pdf-thumbnail','7');await painted(canvases,6);
  await pages.locator('[data-command="pdf-page-previous"]').click();await expect(canvases.first()).toHaveAttribute('data-pdf-thumbnail','1');await painted(canvases,6);
  await pages.locator('[data-pdf-page-number]').fill('25');await pages.locator('[data-command="pdf-page-open"]').click();await expect(frame).toHaveAttribute('src',/#page=25$/);await expect(pages.locator('[data-page="25"]')).toHaveAttribute('aria-current','page');await painted(canvases,1);await expect(ui).toHaveAttribute('aria-busy','false');await expect(frame).toHaveAttribute('src',/#page=25$/);
  await ui.getByRole('button',{name:'Close preview',exact:true}).click();await expect(ui.locator('[data-pdf-preview]')).toHaveCount(0);
  holdWorker=true;await ui.getByRole('button',{name:'Preview PDF',exact:true}).click();await expect.poll(()=>workerHeld).toBe(true);const oldPreview=await frame.getAttribute('src');
  await content.fill('Expanded measurement for the newer edition. '.repeat(260));await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');await expect.poll(()=>frame.getAttribute('src')).not.toBe(oldPreview);
  await expect.poll(async()=>Number(await pages.locator('[data-pdf-page-number]').getAttribute('max'))).toBeGreaterThan(25);const count=Number(await pages.locator('[data-pdf-page-number]').getAttribute('max'));expect(count).toBeLessThanOrEqual(30);await painted(canvases,6);
  const latestPreview=(await frame.getAttribute('src')).split('#')[0];expect(rendered).toHaveLength(2);expect(rendered[1]).toContain('Expanded measurement for the newer edition.');releaseWorker.resolve();await workerFinished.promise;
  await pages.locator('[data-pdf-page-number]').fill(String(count));await pages.locator('[data-command="pdf-page-open"]').click();await expect(frame).toHaveAttribute('src',latestPreview+'#page='+count);await painted(canvases,(count-1)%6+1);await expect(pages.locator('[data-pdf-page-number]')).toHaveAttribute('max',String(count));
  await ui.getByRole('button',{name:'Close preview',exact:true}).click();await expect(ui.locator('[data-pdf-preview]')).toHaveCount(0);await ui.getByRole('button',{name:'Preview PDF',exact:true}).click();await expect(pages.locator('[data-pdf-page-number]')).toHaveAttribute('max',String(count));await painted(canvases,6);expect(rendered).toHaveLength(2);
  await page.screenshot({path:test.info().outputPath('pdf-navigation.png'),fullPage:true});expect(errors).toEqual([]);
 }finally{
  releaseWorker.resolve();await app.close();removeRenderer();clearVault(fixture.vault);
  if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-pdf-navigation-ui-'))throw Error('Unexpected test directory');
  await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});

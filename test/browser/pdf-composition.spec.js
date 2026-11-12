import {test,expect} from './document-editor-fixture.js';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {PdfDocuments} from '../../src/pdf-documents.js';
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
import {installPdfRenderer} from '../../src/pdf-render-service.js';
import {measurePdfPreflight} from '../../src/pdf-preflight.js';
import {navigate} from './preferences-helper.js';
import {getDocument,OPS,Util} from 'pdfjs-dist/legacy/build/pdf.mjs';
const pages=bytes=>(bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)??[]).length;
async function printedGeometry(bytes){
 const task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true});
 try{
  const pdf=await task.promise,page=await pdf.getPage(1),viewport=page.getViewport({scale:1}),ops=await page.getOperatorList(),images=[],stack=[];
  let matrix=viewport.transform;
  for(let n=0;n<ops.fnArray.length;n++){
   const op=ops.fnArray[n],args=ops.argsArray[n];
   if(op===OPS.save||op===OPS.paintFormXObjectBegin)stack.push(matrix);
   if(op===OPS.transform)matrix=Util.transform(matrix,args);
   if(op===OPS.paintFormXObjectBegin&&args[0])matrix=Util.transform(matrix,args[0]);
   if(op===OPS.restore||op===OPS.paintFormXObjectEnd)matrix=stack.pop();
   if(op===OPS.paintImageXObject||op===OPS.paintInlineImageXObject)images.push(matrix.slice());
  }
  const text=new Map((await page.getTextContent()).items.filter(item=>item.str?.trim()).map(item=>[item.str,Util.transform(viewport.transform,item.transform)]));
  return {width:viewport.width,height:viewport.height,text,images,links:(await page.getAnnotations()).map(link=>link.url)};
 }finally{await task.destroy();}
}
const mm=72/25.4;
function compareProof(proof,edition){
 const close=(actual,expected)=>expect(Math.abs(actual-expected)/mm).toBeLessThanOrEqual(.5);
 close(proof.width,170*mm);close(proof.height,256.9*mm);expect(proof.links).toHaveLength(0);expect(edition.links.some(link=>link?.includes('pdf-layout.invalid'))).toBe(false);
 function compare(a,b){expect(a).toBeDefined();expect(b).toBeDefined();for(let i=0;i<4;i++)close(a[i],b[i]);close(a[4]+20*mm,b[4]);close(a[5]+20*mm,b[5]);}
 for(const line of ['Field guide cover','First logical block.','Second logical block.','Cover view'])compare(proof.text.get(line),edition.text.get(line));
 close(proof.text.get('First logical block.')[4],25*mm);expect(proof.images).toHaveLength(1);expect(edition.images).toHaveLength(1);compare(proof.images[0],edition.images[0]);
}

test('positioned PDF pages retain numeric, keyboard and drag geometry, preserve reading order and report stale or overflowing content',async({page,browser})=>{
 test.setTimeout(150000);page.setDefaultTimeout(15000);await page.setViewportSize({width:1440,height:1100});
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-pdf-composition-')),f=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'}),documents=new PdfDocuments(f.workspace,(await f.workspace.outline()).metadata.id),rendered=[],errors=[];
 const removeRenderer=installPdfRenderer(async input=>{const view=await browser.newPage();try{
  await view.route('**/*',route=>route.abort());await view.setContent(input.html);await view.evaluate(()=>document.fonts.ready);const preflight=await view.evaluate(measurePdfPreflight),observed=await view.evaluate(()=>({keys:[...document.querySelectorAll('[data-pdf-composition-key]')].map(node=>node.dataset.pdfCompositionKey),text:document.querySelector('.pdf-composition-page')?.textContent??'',hidden:[...document.querySelectorAll('[data-pdf-composition-key]')].some(node=>['hidden','clip'].includes(getComputedStyle(node).overflow)),images:[...document.images].map(image=>({alt:image.alt,width:image.getBoundingClientRect().width,height:image.getBoundingClientRect().height}))})),bytes=await view.pdf({preferCSSPageSize:true,printBackground:true});rendered.push({...observed,preflight,pages:pages(bytes)});return {bytes,preflight,sha256:createHash('sha256').update(bytes).digest('hex'),renderer:{engine:'chromium',electron:'test',chromium:browser.version(),recipeVersion:1}};
 }finally{await view.close();}});
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const read=Response.prototype.blob;
  Response.prototype.blob=async function(){
   const blob=await read.call(this);
   if(this.ok&&this.url.endsWith('/api/pdf/composition-proof'))window.renderedCompositionProof=blob;
   return blob;
  };
 });
 try{
  await page.goto(app.url);await navigate(page,'PDF editor');const ui=page.locator('[data-pdf-editor]');await ui.getByRole('button',{name:'New document',exact:true}).click();await expect(page).toHaveURL(/#\/modules\/pdf-editor\/[a-f0-9-]{36}$/);const id=new URL(page.url()).hash.split('/').at(-1),sectionId=(await documents.read('sections',{id})).items[0].id,panel=ui.locator('[data-pdf-composition-editor]'),saved=()=>expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');
  const advanced=ui.locator('[data-disclosure="pdf-section-options"]');
  const openOptions=async()=>{if(!await advanced.evaluate(el=>el.open))await advanced.locator(':scope > summary').click();};
  await openOptions();await panel.locator(':scope > summary').click();await panel.getByRole('combobox',{name:'Layout mode',exact:true}).selectOption('page');await saved();expect((await documents.read('section',{id,sectionId})).section.composition.blockCount).toBe(1);
  await ui.getByRole('button',{name:'Preview PDF',exact:true}).click();await expect(ui.getByTitle('PDF preview',{exact:true})).toBeVisible();await expect.poll(()=>rendered.length).toBeGreaterThan(0);expect(rendered[0].pages).toBe(1);expect(rendered[0].keys).toEqual(['block:0']);expect(rendered[0].hidden).toBe(false);await ui.getByRole('button',{name:'Close preview',exact:true}).click();
  await ui.getByLabel('Section title',{exact:true}).fill('Field guide cover');const content=ui.getByRole('textbox',{name:'Content',exact:true});await content.fill('First logical block.');await content.press('End');await content.press('Enter');await content.pressSequentially('Second logical block.');await saved();await expect(panel.locator('[data-pdf-composition-status]')).toContainText('Content has changed');
  const stale=(await documents.read('section',{id,sectionId})).section;expect(stale.composition.blockCount).toBe(1);await assert.rejects(compilePdfDocument((await documents.read('open',{id})).header,[stale]),{code:'PDF_PLACEMENT_REVIEW'});
  await page.reload();await openOptions();await expect(panel.locator('[data-pdf-composition-status]')).toContainText('Content has changed');await panel.getByRole('button',{name:'Adjust layout to current content',exact:true}).click();await expect(ui).toHaveAttribute('aria-busy','false');await saved();expect((await documents.read('section',{id,sectionId})).section.composition.blockCount).toBe(2);
  const images=ui.locator('[data-pdf-images]');await images.locator(':scope > summary').click();await images.getByLabel('Choose local image',{exact:true}).setInputFiles({name:'selected-cover.png',mimeType:'image/png',buffer:await readFile(new URL('../../src/preview-assets/image.png',import.meta.url))});await images.locator('[data-pdf-image-new="alt"]').fill('Field guide specimen');await images.locator('[data-pdf-image-new="caption"]').fill('Cover view');await images.getByRole('button',{name:'Add image',exact:true}).click();await expect(images.locator('[data-pdf-image]')).toHaveCount(1);await expect(ui).toHaveAttribute('aria-busy','false');await saved();await expect(panel.locator('[data-pdf-composition-status]')).toContainText('Content has changed');await panel.getByRole('button',{name:'Adjust layout to current content',exact:true}).click();await expect(ui).toHaveAttribute('aria-busy','false');await saved();const imageId=(await documents.read('section',{id,sectionId})).section.images[0].id;
  const review=ui.locator('[data-pdf-placement-review]');
  await expect(review).toContainText('Field guide specimen');await review.getByRole('button',{name:'Confirm these positions'}).click();await expect(review).toBeHidden();await expect(ui).toHaveAttribute('aria-busy','false');
  const place=async(key,{x,y,width,height})=>{await panel.locator('[data-pdf-composition-select]').selectOption(key);await expect(panel.locator('[data-pdf-composition-field="widthMm"]')).toHaveAttribute('data-pdf-composition-key',key);await panel.locator('[data-pdf-composition-field="widthMm"]').fill(String(width));await panel.locator('[data-pdf-composition-field="heightMm"]').fill(String(height));await panel.locator('[data-pdf-composition-field="xMm"]').fill(String(x));await panel.locator('[data-pdf-composition-field="yMm"]').fill(String(y));await saved();};
  await place('title',{x:10,y:5,width:140,height:20});await place('block:0',{x:10,y:35,width:130,height:20});await place('block:1',{x:10,y:70,width:130,height:20});await place('image:'+imageId,{x:105,y:110,width:50,height:45});
  const grid=panel.getByLabel('Grid spacing (mm)',{exact:true});await grid.evaluate(node=>{window.compositionGrid=node;});await grid.fill('12.5');await saved();expect(await grid.evaluate(node=>node===window.compositionGrid)).toBe(true);await expect(grid).toBeFocused();await grid.fill('5');await saved();
  let handle=panel.locator('[data-pdf-composition-handle="block:0"]');await handle.focus();await handle.press('ArrowRight');await saved();let stored=(await documents.read('section',{id,sectionId})).section;expect(stored.composition.boxes.find(box=>box.target.kind==='block'&&box.target.index===0).xMm).toBe(15);
  handle=panel.locator('[data-pdf-composition-handle="block:0"]');await handle.scrollIntoViewIfNeeded();const box=await handle.boundingBox(),canvas=await panel.locator('[data-pdf-composition-canvas]').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+canvas.width*10/170,box.y+box.height/2+canvas.height*5/256.9,{steps:5});await page.mouse.up();await saved();stored=(await documents.read('section',{id,sectionId})).section;expect(stored.composition.boxes.find(box=>box.target.kind==='block'&&box.target.index===0)).toMatchObject({xMm:25,yMm:40});let resize=panel.locator('[data-pdf-composition-resize="block:0"]');
  await resize.focus();await resize.press('ArrowLeft');await saved();
  await expect(panel.getByLabel('Box width (mm)',{exact:true})).toHaveValue('125');
  await ui.getByRole('button',{name:'Undo document change',exact:true}).click();await saved();
  await expect(panel.getByLabel('Box width (mm)',{exact:true})).toHaveValue('130');
  await ui.getByRole('button',{name:'Redo document change',exact:true}).click();await saved();
  await expect(panel.getByLabel('Box width (mm)',{exact:true})).toHaveValue('125');
  resize=panel.locator('[data-pdf-composition-resize="block:0"]');await resize.scrollIntoViewIfNeeded();
  const corner=await resize.boundingBox();await page.mouse.move(corner.x+corner.width/2,corner.y+corner.height/2);await page.mouse.down();
  await page.mouse.move(corner.x+corner.width/2+canvas.width*5/170,corner.y+corner.height/2+canvas.height*10/256.9,{steps:4});await page.mouse.up();await saved();
  await expect(panel.getByLabel('Box width (mm)',{exact:true})).toHaveValue('130');
  await expect(panel.getByLabel('Box height (mm)',{exact:true})).toHaveValue('30');
  const retained=(await documents.read('section',{id,sectionId})).section.composition;
  await page.reload();await openOptions();await expect(panel.locator('[data-pdf-composition-handle="block:0"]')).toBeVisible();expect((await documents.read('section',{id,sectionId})).section.composition).toEqual(retained);await panel.locator('[data-pdf-composition-select]').selectOption('block:0');await expect(panel.getByLabel('Left position (mm)',{exact:true})).toHaveValue('25');await expect(panel.getByLabel('Top position (mm)',{exact:true})).toHaveValue('40');
  await place('block:1',{x:25,y:40,width:130,height:20});await expect(panel.locator('[data-pdf-composition-status]')).toContainText('overlap');await ui.getByRole('button',{name:'Check PDF layout',exact:true}).click();await expect(ui.locator('[data-pdf-preflight]')).toBeVisible();expect(rendered.at(-1).preflight.findings.some(finding=>finding.code==='PDF_COMPOSITION_OVERLAP')).toBe(true);expect(rendered.at(-1).hidden).toBe(false);
  await panel.locator('[data-pdf-composition-select]').selectOption('block:0');await panel.getByLabel('Box height (mm)',{exact:true}).fill('0.5');await saved();await ui.getByRole('button',{name:'Check PDF layout',exact:true}).click();await expect(ui).toHaveAttribute('aria-busy','false');expect(rendered.at(-1).preflight.findings.some(finding=>finding.code==='PDF_COMPOSITION_OVERFLOW')).toBe(true);await expect(panel.locator('[data-pdf-selected-finding]')).toContainText("Content extends beyond its assigned box");
  await place('block:0',{x:25,y:40,width:130,height:20});await place('block:1',{x:10,y:70,width:130,height:20});await expect(panel.locator('[data-pdf-proof-status]')).toHaveText(/Saved PDF content area/,{timeout:30000});
  const artifact=panel.locator('[data-pdf-composition-proof]');await expect(artifact).toBeVisible();
  expect(await artifact.evaluate(canvas=>canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.some((channel,n)=>n%4!==3&&channel<160))).toBe(true);
  const persisted=(await documents.read('section',{id,sectionId})).section.composition.boxes;
  expect(persisted.map(({target,xMm,yMm,widthMm,heightMm})=>[target.kind,target.index,xMm,yMm,widthMm,heightMm])).toEqual([
   ['title',undefined,10,5,140,20],['image',undefined,105,110,50,45],['block',0,25,40,130,20],['block',1,10,70,130,20]
  ]);
  const proof=Buffer.from(await page.evaluate(async()=>Array.from(new Uint8Array(await window.renderedCompositionProof.arrayBuffer()))));
  expect(proof.subarray(0,5).toString()).toBe('%PDF-');
  const downloadEvent=page.waitForEvent('download',{timeout:45000});await ui.getByRole('button',{name:'Download PDF',exact:true}).click();const download=await downloadEvent,bytes=await readFile(await download.path());expect(pages(bytes)).toBe(1);expect(rendered.at(-1).pages).toBe(1);expect(rendered.at(-1).keys).toEqual(['title','image:'+imageId,'block:0','block:1']);expect(rendered.at(-1).text).toContain('First logical block.');expect(rendered.at(-1).text).toContain('Second logical block.');expect(rendered.at(-1).images[0]).toMatchObject({alt:'Field guide specimen'});expect(rendered.at(-1).images[0].width).toBeGreaterThan(180);expect(rendered.at(-1).images[0].height).toBeGreaterThan(100);expect(rendered.at(-1).preflight.findings.filter(finding=>['PDF_COMPOSITION_OVERFLOW','PDF_COMPOSITION_OVERLAP'].includes(finding.code))).toEqual([]);compareProof(await printedGeometry(proof),await printedGeometry(bytes));await download.saveAs(test.info().outputPath('positioned-cover.pdf'));expect(errors).toEqual([]);
  // Arrange two physical boxes as one without changing either paragraph's
  // reading position. Complete the edit through the same rich editor used by
  // the section, then independently read its newly exported edition.
  await panel.getByText('Arrange page objects',{exact:true}).click();
  const multi=panel.getByRole('listbox',{name:'Selected objects',exact:true});await multi.selectOption(['block:0','block:1']);
  await panel.getByRole('combobox',{name:'Alignment or spacing'}).selectOption('horizontal-start');
  await panel.getByRole('button',{name:'Apply arrangement'}).click();await saved();
  handle=panel.locator('[data-pdf-composition-handle="block:1"]');await handle.focus();await handle.press('ArrowRight');await saved();
  const arranged=(await documents.read('section',{id,sectionId})).section;
  expect(arranged.composition.boxes.filter(b=>b.target.kind==='block').map(b=>b.xMm)).toEqual([15,15]);
  await handle.press('Enter');const dialog=ui.getByRole('dialog');await expect(dialog).toBeVisible();
  const blockEditor=dialog.getByRole('textbox',{name:'Content',exact:true});await expect(blockEditor).toBeFocused();
  expect(await blockEditor.evaluate(node=>getSelection().anchorNode.parentElement.closest('p').textContent)).toBe('Second logical block.');
  await blockEditor.press('End');await blockEditor.pressSequentially(' Corrected.');await saved();
  await dialog.getByRole('button',{name:'Return to page design'}).click();await expect(handle).toBeFocused();
  await review.getByRole('button',{name:'Confirm these positions'}).click();await expect(review).toBeHidden();
  await panel.locator('[data-pdf-composition-handle="image:'+imageId+'"]').dblclick();await expect(dialog).toBeVisible();
  await dialog.locator('[data-pdf-image-field="caption"]').fill('Final specimen caption');await saved();
  await dialog.getByRole('button',{name:'Return to page design'}).click();
  await page.reload();await ui.getByRole('button',{name:'Page composition',exact:true}).click();
  await expect(panel.locator('[data-pdf-proof-status]')).toHaveText(/Saved PDF content area/,{timeout:30000});
  const finalDownload=page.waitForEvent('download',{timeout:45000});await ui.getByRole('button',{name:'Download PDF',exact:true}).click();
  const final=await printedGeometry(await readFile(await (await finalDownload).path()));
  expect(final.text.has('Second logical block. Corrected.')).toBe(true);expect(final.text.has('Final specimen caption')).toBe(true);
  expect(Math.abs(final.text.get('First logical block.')[4]-final.text.get('Second logical block. Corrected.')[4])/mm).toBeLessThanOrEqual(.5);
  await panel.locator('[data-pdf-composition-handle="title"]').dblclick();
  await dialog.getByRole('textbox',{name:'Section title'}).fill('Field guide 文');await saved();
  await dialog.getByRole('button',{name:'Return to page design'}).click();
  if(await review.isVisible())await review.getByRole('button',{name:'Confirm these positions'}).click();
  await expect(panel.locator('[data-pdf-proof-status]')).toContainText('cannot display',{timeout:30000});
  await expect(panel.locator('[data-pdf-selected-finding]')).toContainText('cannot display');
  await panel.locator('[data-pdf-composition-select]').selectOption('block:1');
  await expect(panel.locator('[data-pdf-selected-finding]')).toHaveText('');
  await ui.getByRole('button',{name:'Check PDF layout',exact:true}).click();
  await expect(ui.locator('[data-pdf-preflight]')).toContainText('cannot display');
  expect(errors).toEqual([]);
 }finally{await app.close();removeRenderer();await clearVault(f.vault);if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-pdf-composition-'))throw Error('Unexpected test directory');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

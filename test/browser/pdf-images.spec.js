import {createHash} from 'node:crypto';
import {measurePdfPreflight} from '../../src/pdf-preflight.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {PdfDocuments} from '../../src/pdf-documents.js';
import {PdfDocumentImages} from '../../src/pdf-document-images.js';
import {installPdfRenderer} from '../../src/pdf-render-service.js';
import {navigate} from './preferences-helper.js';

test('PDF image authoring retains selected pixels, text, physical crop and placement through reopen and PDF download',async({page,browser})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-pdf-images-ui-')),fixture=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'}),errors=[],rendered=[];
 const removeRenderer=installPdfRenderer(async input=>{
  const view=await browser.newPage();try{
   await view.route('**/*',route=>route.abort());await view.setContent(input.html);await view.evaluate(()=>document.fonts.ready);
   rendered.push(await view.locator('img[src^="data:image/png;"]').evaluateAll(images=>images.map(image=>({alt:image.alt,caption:image.closest('figure')?.querySelector('figcaption')?.textContent??'',fit:getComputedStyle(image).objectFit,position:getComputedStyle(image).objectPosition,width:image.getBoundingClientRect().width,height:image.getBoundingClientRect().height,previous:!![...document.querySelectorAll('p')].find(p=>p.textContent==='Before the selected image.'&&(p.compareDocumentPosition(image)&Node.DOCUMENT_POSITION_FOLLOWING)),following:!![...document.querySelectorAll('p')].find(p=>p.textContent==='After the selected image.'&&(image.compareDocumentPosition(p)&Node.DOCUMENT_POSITION_FOLLOWING))}))));
   const preflight=await view.evaluate(measurePdfPreflight),bytes=await view.pdf({preferCSSPageSize:true,printBackground:true});return {bytes,preflight,sha256:createHash('sha256').update(bytes).digest('hex'),renderer:{engine:'chromium',electron:'test',chromium:browser.version(),recipeVersion:1}};
  }finally{await view.close();}
 });
 const app=await startServer({root:fixture.workspace.root,port:0,headless:true,deviceStore:fixture.deviceStore}),workspaceId=(await fixture.workspace.outline()).metadata.id,documents=new PdfDocuments(fixture.workspace,workspaceId);page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await navigate(page,'PDF editor');const ui=page.locator('[data-pdf-editor]');await ui.getByRole('button',{name:'New document',exact:true}).click();await expect(page).toHaveURL(/#\/modules\/pdf-editor\/[a-f0-9-]{36}$/);const id=new URL(page.url()).hash.split('/').at(-1);
  const content=ui.getByRole('textbox',{name:'Content',exact:true});await content.fill('Before the selected image.');await content.press('End');await content.press('Enter');await content.pressSequentially('After the selected image.');await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');
  const sectionId=(await documents.read('sections',{id})).items[0].id;
  await ui.locator('[data-pdf-images] summary').click();await ui.locator('[data-pdf-image-file]').setInputFiles({name:'synthetic-specimen.png',mimeType:'image/png',buffer:await readFile(new URL('../../src/preview-assets/image.png',import.meta.url))});
  await expect(ui.getByRole('button',{name:'Add image',exact:true})).toBeVisible();await ui.getByRole('button',{name:'Add image',exact:true}).click();await expect(page.locator('#notice')).toContainText('Describe the image before adding it.');expect((await documents.read('section',{id,sectionId})).section.images).toBeUndefined();
  await ui.locator('[data-pdf-image-new="alt"]').fill('Synthetic specimen with scale');await ui.locator('[data-pdf-image-new="caption"]').fill('Selected observation, retained pixels.');await ui.getByRole('button',{name:'Add image',exact:true}).click();
  const image=ui.locator('[data-pdf-image]');await expect(image).toHaveCount(1);
  for(const [name,value] of [['widthMm','70'],['heightMm','45'],['x','25'],['y','75'],['block','1']])await image.locator('[data-pdf-image-field="'+name+'"]').fill(value);
  await image.locator('[data-pdf-image-field="fit"]').selectOption('cover');await image.locator('[data-pdf-image-field="align"]').selectOption('right');await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');
  const stored=(await documents.read('section',{id,sectionId})).section.images[0];expect(stored).toMatchObject({alt:'Synthetic specimen with scale',caption:'Selected observation, retained pixels.',widthMm:70,heightMm:45,fit:'cover',crop:{x:25,y:75},position:{block:1,align:'right'}});
  const asset=await documents.domains.run(['pdf'],get=>new PdfDocumentImages(get('pdf'),id).read(stored.asset));expect(asset.mime).toBe('image/png');expect(Object.keys(asset).sort()).toEqual(['asset','content','height','mime','size','width']);
  await page.reload();await expect(ui.locator('[data-pdf-image]')).toHaveCount(1);await expect(ui.locator('[data-pdf-image-field="alt"]')).toHaveValue(stored.alt);await expect(ui.locator('[data-pdf-image-field="widthMm"]')).toHaveValue('70');
  await ui.getByRole('button',{name:'Preview image',exact:true}).click();await expect(ui.locator('[data-pdf-image] img')).toBeVisible();
  await ui.getByRole('button',{name:'Preview PDF',exact:true}).click();await expect(ui.getByTitle('PDF preview',{exact:true})).toBeVisible();await expect.poll(()=>rendered.at(-1)?.length??0).toBe(1);
  expect(rendered.at(-1)[0]).toMatchObject({alt:stored.alt,caption:stored.caption,fit:'cover',position:'25% 75%',previous:true,following:true});expect(rendered.at(-1)[0].width).toBeCloseTo(70*96/25.4,0);expect(rendered.at(-1)[0].height).toBeCloseTo(45*96/25.4,0);
  const downloadEvent=page.waitForEvent('download');await ui.getByRole('button',{name:'Download PDF',exact:true}).click();const download=await downloadEvent;await download.saveAs(test.info().outputPath('selected-image.pdf'));expect((await readFile(await download.path())).subarray(0,5).toString()).toBe('%PDF-');
  expect(errors).toEqual([]);
 }finally{await app.close();removeRenderer();clearVault(fixture.vault);if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-pdf-images-ui-'))throw Error('Unexpected test directory');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

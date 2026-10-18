import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {PdfDocuments} from '../../src/pdf-documents.js';
import {installPdfRenderer} from '../../src/pdf-render-service.js';
import {measurePdfPreflight} from '../../src/pdf-preflight.js';
import {navigate} from './preferences-helper.js';

test('authored PDF captions and generated lists preserve source content, retain exact links and invalidate public review after settings change',async({page,browser})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-pdf-captions-ui-')),fixture=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'}),errors=[],rendered=[];
 const removeRenderer=installPdfRenderer(async input=>{
  const view=await browser.newPage();try{
   await view.route('**/*',route=>route.abort());await view.setContent(input.html);await view.evaluate(()=>document.fonts.ready);
   rendered.push(await view.evaluate(()=>{
    const links=[...document.querySelectorAll('.pdf-caption-list a')],ids=[...document.querySelectorAll('[id]')].map(node=>node.id);
    return {figures:[...document.querySelectorAll('figure figcaption')].map(node=>node.textContent),tables:[...document.querySelectorAll('table caption')].map(node=>node.textContent),figureList:[...document.querySelectorAll('.pdf-figures-list li')].map(node=>node.textContent),tableList:[...document.querySelectorAll('.pdf-tables-list li')].map(node=>node.textContent),targets:links.map(link=>({text:link.textContent,anchor:link.hash.slice(1),exists:!!document.getElementById(link.hash.slice(1))})),uniqueIds:new Set(ids).size===ids.length,images:document.querySelectorAll('img[src^="data:image/png;"]').length};
   }));
   const preflight=await view.evaluate(measurePdfPreflight),bytes=await view.pdf({preferCSSPageSize:true,printBackground:true});
   return {bytes,preflight,sha256:createHash('sha256').update(bytes).digest('hex'),renderer:{engine:'chromium',electron:'test',chromium:browser.version(),recipeVersion:1}};
  }finally{await view.close();}
 });
 const app=await startServer({root:fixture.workspace.root,port:0,headless:true,deviceStore:fixture.deviceStore}),documents=new PdfDocuments(fixture.workspace,(await fixture.workspace.outline()).metadata.id);
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await navigate(page,'PDF editor');const ui=page.locator('[data-pdf-editor]');await ui.getByRole('button',{name:'New document',exact:true}).click();await expect(page).toHaveURL(/#\/modules\/pdf-editor\/[a-f0-9-]{36}$/);const id=new URL(page.url()).hash.split('/').at(-1),saved=ui.locator('[data-pdf-status]'),content=ui.getByRole('textbox',{name:'Content',exact:true});
  await ui.getByLabel('Section title',{exact:true}).fill('Captioned observations');await content.fill('Exact observed value 9007199254740993.');await content.press('End');await content.press('Enter');
  await ui.locator('.document-field').getByRole('button',{name:'Book content',exact:true}).click();const table=page.getByRole('dialog',{name:'Book content',exact:true});await table.getByLabel('Title / caption',{exact:true}).fill('Exact readings');await table.getByLabel('Column headings 1',{exact:true}).fill('Observation');await table.getByLabel('Column headings 2',{exact:true}).fill('Value');await table.getByLabel('Row 1, 1',{exact:true}).fill('Trial A');await table.getByLabel('Row 1, 2',{exact:true}).fill('9007199254740993');await table.getByRole('button',{name:'Apply content',exact:true}).click();await expect(saved).toHaveText('Saved');
  await ui.locator('[data-pdf-images] summary').click();await ui.locator('[data-pdf-image-file]').setInputFiles({name:'caption-specimen.png',mimeType:'image/png',buffer:await readFile(new URL('../../src/preview-assets/image.png',import.meta.url))});await ui.locator('[data-pdf-image-new="alt"]').fill('Synthetic optical specimen');await ui.locator('[data-pdf-image-new="caption"]').fill('Optical view');await ui.getByRole('button',{name:'Add image',exact:true}).click();await expect(ui.locator('[data-pdf-image]')).toHaveCount(1);await expect(saved).toHaveText('Saved');
  const sectionId=(await documents.read('sections',{id})).items[0].id,original=(await documents.read('section',{id,sectionId})).section,originalTable=original.content.content.find(node=>node.type==='book_table');expect(originalTable.attrs.title).toBe('Exact readings');expect(original.images[0].caption).toBe('Optical view');
  await ui.locator('summary').filter({hasText:/^Captions and lists$/}).click();for(const name of ['Number figure captions','Number table captions','Include list of figures','Include list of tables'])await ui.getByRole('checkbox',{name,exact:true}).check();
  await ui.getByLabel('Figure label',{exact:true}).fill('Plate');await ui.getByLabel('Table label',{exact:true}).fill('Dataset');await ui.getByLabel('Figure list title',{exact:true}).fill('Optical figures');await ui.getByLabel('Table list title',{exact:true}).fill('Measured tables');await expect(saved).toHaveText('Saved');
  await ui.getByRole('combobox',{name:'Edition audience',exact:true}).selectOption('public');await expect(saved).toHaveText('Saved');const publication=ui.locator('[data-pdf-publication]');await expect(publication).toContainText('Public review required');await publication.getByRole('button',{name:'Mark reviewed for public use',exact:true}).click();await expect(publication).toContainText('Reviewed for public use');await expect(saved).toHaveText('Saved');
  const reviewed=await documents.read('open',{id}),downloadEvent=page.waitForEvent('download',{timeout:45000});await ui.getByRole('button',{name:'Download PDF',exact:true}).click();const download=await downloadEvent,bytes=await readFile(await download.path());expect(bytes.subarray(0,5).toString()).toBe('%PDF-');await download.saveAs(test.info().outputPath('captioned-observations.pdf'));
  expect(rendered).toHaveLength(1);expect(rendered[0]).toMatchObject({figures:['Plate 1. Optical view'],tables:['Dataset 1. Exact readings'],figureList:['Plate 1. Optical view'],tableList:['Dataset 1. Exact readings'],uniqueIds:true,images:1});expect(rendered[0].targets).toHaveLength(2);expect(rendered[0].targets.every(target=>target.exists)).toBe(true);expect(rendered[0].targets[0].anchor).toContain(original.images[0].id);expect(rendered[0].targets[1].anchor).toContain(originalTable.attrs.id);
  const pdf=await page.evaluate(async data=>{
   const library=await import('/vendor/pdfjs/pdf.js');library.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.js';const task=library.getDocument({data:Uint8Array.from(data),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,useWasm:false,useWorkerFetch:false,isOffscreenCanvasSupported:false}),document=await task.promise,pages=[],links=[];
   try{for(let index=1;index<=document.numPages;index++){const page=await document.getPage(index),text=await page.getTextContent();pages.push(text.items.map(item=>item.str??'').join(' ').replace(/\s+/g,' ').trim());for(const link of await page.getAnnotations())if(link.subtype==='Link'&&link.dest){const destination=typeof link.dest==='string'?await document.getDestination(link.dest):link.dest;links.push({from:index,to:Number.isInteger(destination?.[0])?destination[0]+1:await document.getPageIndex(destination[0])+1});}page.cleanup();}return {pages,links};}finally{await task.destroy();}
  },[...bytes]);
  expect(pdf.pages.length).toBeGreaterThanOrEqual(3);expect(pdf.pages[0]).toContain('Optical figures');expect(pdf.pages[0]).toContain('Plate 1. Optical view');expect(pdf.pages[1]).toContain('Measured tables');expect(pdf.pages[1]).toContain('Dataset 1. Exact readings');expect(pdf.pages.slice(2).join(' ')).toContain('Plate 1. Optical view');expect(pdf.pages.slice(2).join(' ')).toContain('Dataset 1. Exact readings');expect(pdf.pages.join(' ')).toContain('9007199254740993');expect(pdf.links).toEqual([{from:1,to:3},{from:2,to:3}]);
  const retained=(await documents.read('section',{id,sectionId,revision:reviewed.revision})).section;expect(retained.content).toEqual(original.content);expect(retained.images).toEqual(original.images);
  await page.reload();await expect(ui.getByLabel('Section title',{exact:true})).toHaveValue('Captioned observations');await expect(publication).toContainText('Reviewed for public use');await ui.locator('summary').filter({hasText:/^Captions and lists$/}).click();for(const name of ['Number figure captions','Number table captions','Include list of figures','Include list of tables'])await expect(ui.getByRole('checkbox',{name,exact:true})).toBeChecked();await expect(ui.getByLabel('Figure label',{exact:true})).toHaveValue('Plate');await expect(ui.getByLabel('Table label',{exact:true})).toHaveValue('Dataset');
  const reopened=(await documents.read('section',{id,sectionId})).section;expect(reopened.content).toEqual(original.content);expect(reopened.images).toEqual(original.images);await ui.getByLabel('Figure label',{exact:true}).fill('Panel');await expect(saved).toHaveText('Saved');await expect(publication).toContainText('Content or document settings changed. Review again.');
  await ui.getByRole('button',{name:'Download PDF',exact:true}).click();const failed=ui.locator('[data-pdf-export]').filter({has:page.locator('[data-export-state]',{hasText:'Could not finish'})});await expect(failed).toHaveCount(1);await expect(failed.locator('[data-export-error]')).toContainText('Review or omit each section');expect(rendered).toHaveLength(1);expect((await documents.read('section',{id,sectionId,revision:reviewed.revision})).section).toEqual(retained);expect(errors).toEqual([]);
 }finally{await app.close();removeRenderer();clearVault(fixture.vault);if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-pdf-captions-ui-'))throw Error('Unexpected test directory');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

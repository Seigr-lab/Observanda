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
import {PdfDocumentImages} from '../../src/pdf-document-images.js';
import {installPdfRenderer} from '../../src/pdf-render-service.js';
import {measurePdfPreflight} from '../../src/pdf-preflight.js';
import {navigate} from './preferences-helper.js';

test('PDF archive and restore preserve authored editions, image assets and retained exports while independent creation stays available',async({page,browser})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-pdf-archive-ui-')),fixture=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'}),errors=[],rendered=[];
 const removeRenderer=installPdfRenderer(async input=>{
  const view=await browser.newPage();try{
   await view.route('**/*',route=>route.abort());await view.setContent(input.html);await view.evaluate(()=>document.fonts.ready);
   rendered.push({text:await view.locator('body').innerText(),images:await view.locator('img[src^="data:image/png;"]').count()});
   const preflight=await view.evaluate(measurePdfPreflight),bytes=await view.pdf({preferCSSPageSize:true,printBackground:true});
   return {bytes,preflight,sha256:createHash('sha256').update(bytes).digest('hex'),renderer:{engine:'chromium',electron:'test',chromium:browser.version(),recipeVersion:1}};
  }finally{await view.close();}
 });
 const app=await startServer({root:fixture.workspace.root,port:0,headless:true,deviceStore:fixture.deviceStore}),documents=new PdfDocuments(fixture.workspace,(await fixture.workspace.outline()).metadata.id);
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await navigate(page,'PDF editor');const ui=page.locator('[data-pdf-editor]');await ui.getByRole('button',{name:'New document',exact:true}).click();await expect(page).toHaveURL(/#\/modules\/pdf-editor\/[a-f0-9-]{36}$/);const id=new URL(page.url()).hash.split('/').at(-1);
  const content=ui.getByRole('textbox',{name:'Content',exact:true}),saved=ui.locator('[data-pdf-status]');
  await ui.locator('summary').filter({hasText:/^Document$/}).click();await ui.getByLabel('Document name',{exact:true}).fill('Retained observation report');await ui.getByLabel('Section title',{exact:true}).fill('Measured observation');await content.fill('FIRST EDITION 9007199254740993.');await expect(saved).toHaveText('Saved');
  await ui.locator('[data-pdf-images] summary').click();await ui.locator('[data-pdf-image-file]').setInputFiles({name:'archive-specimen.png',mimeType:'image/png',buffer:await readFile(new URL('../../src/preview-assets/image.png',import.meta.url))});
  await ui.locator('[data-pdf-image-new="alt"]').fill('Synthetic observation image');await ui.locator('[data-pdf-image-new="caption"]').fill('Retained image caption.');await ui.getByRole('button',{name:'Add image',exact:true}).click();await expect(ui.locator('[data-pdf-image]')).toHaveCount(1);await expect(saved).toHaveText('Saved');
  const firstEdition=await documents.read('open',{id}),sectionId=(await documents.read('sections',{id})).items[0].id,firstSection=(await documents.read('section',{id,sectionId})).section,asset=firstSection.images[0].asset;
  const originalImage=await documents.domains.run(['pdf'],get=>new PdfDocumentImages(get('pdf'),id).read(asset));
  await content.fill('SECOND EDITION 9007199254740995.');await expect(saved).toHaveText('Saved');const latestEdition=await documents.read('open',{id}),latestSection=(await documents.read('section',{id,sectionId})).section;expect(latestEdition.revision).not.toBe(firstEdition.revision);
  const downloadEvent=page.waitForEvent('download',{timeout:45000});await ui.getByRole('button',{name:'Download PDF',exact:true}).click();const firstDownload=await downloadEvent,exportBytes=await readFile(await firstDownload.path());expect(exportBytes.subarray(0,5).toString()).toBe('%PDF-');await firstDownload.saveAs(test.info().outputPath('retained-observation.pdf'));
  const completedRows=ui.locator('[data-pdf-export]').filter({has:page.locator('[data-command="export-download"]:visible')});await expect(completedRows).toHaveCount(1);const jobId=await completedRows.first().getAttribute('data-pdf-export');expect(rendered).toHaveLength(1);expect(rendered[0]).toMatchObject({images:1});expect(rendered[0].text).toContain('SECOND EDITION 9007199254740995.');
  await ui.getByRole('button',{name:'Close exports',exact:true}).click();await ui.getByRole('button',{name:'Archive document',exact:true}).click();await expect(ui.getByRole('heading',{name:'PDF documents',exact:true})).toBeVisible();await expect(ui.locator('.pdf-document-list').getByRole('button',{name:'Retained observation report',exact:true})).toHaveCount(0);expect((await documents.read('list')).items).toHaveLength(0);
  await ui.getByRole('button',{name:'PDF exports',exact:true}).click();const archivedDownload=page.waitForEvent('download');await ui.locator('[data-pdf-export="'+jobId+'"]').getByRole('button',{name:'Download retained PDF',exact:true}).click();expect(await readFile(await (await archivedDownload).path())).toEqual(exportBytes);await ui.getByRole('button',{name:'Close exports',exact:true}).click();
  await ui.getByRole('button',{name:'Archived documents',exact:true}).click();await expect(ui.getByRole('heading',{name:'Archived documents',exact:true})).toBeVisible();await expect(ui.getByRole('button',{name:'Retained observation report - Restore document',exact:true})).toBeVisible();expect((await documents.read('archive')).items.map(item=>item.id)).toEqual([id]);
  await ui.getByRole('button',{name:'New document',exact:true}).click();await expect(ui.getByRole('heading',{name:'New document',exact:true})).toBeVisible();const otherId=new URL(page.url()).hash.split('/').at(-1);expect(otherId).not.toBe(id);
  await ui.locator('summary').filter({hasText:/^Document$/}).click();await ui.getByLabel('Document name',{exact:true}).fill('Independent field notes');await content.fill('Independent document content.');await expect(saved).toHaveText('Saved');await ui.getByRole('button',{name:'Documents',exact:true}).click();await expect(ui.getByRole('heading',{name:'PDF documents',exact:true})).toBeVisible();await expect(ui.locator('.pdf-document-list').getByRole('button',{name:'Independent field notes',exact:true})).toBeVisible();await expect(ui.locator('.pdf-document-list').getByRole('button',{name:'Retained observation report',exact:true})).toHaveCount(0);
  await ui.getByRole('button',{name:'Archived documents',exact:true}).click();await ui.getByRole('button',{name:'Retained observation report - Restore document',exact:true}).click();await expect(ui).toContainText('No archived documents.');await ui.getByRole('button',{name:'Active documents',exact:true}).click();await ui.getByRole('button',{name:'Retained observation report',exact:true}).click();await expect(content).toHaveText('SECOND EDITION 9007199254740995.');await expect(ui.locator('[data-pdf-image-field="caption"]')).toHaveValue('Retained image caption.');
  expect((await documents.read('section',{id,sectionId})).section).toEqual(latestSection);expect((await documents.read('section',{id,sectionId,revision:firstEdition.revision})).section).toEqual(firstSection);expect((await documents.read('open',{id,revision:firstEdition.revision})).header).toEqual(firstEdition.header);
  const restoredImage=await documents.domains.run(['pdf'],get=>new PdfDocumentImages(get('pdf'),id).read(asset));expect(restoredImage).toEqual(originalImage);await ui.getByRole('button',{name:'Preview image',exact:true}).click();await expect(ui.locator('[data-pdf-image] img')).toBeVisible();
  await ui.getByRole('button',{name:'History',exact:true}).click();await ui.locator('[data-command="restore"][data-revision="'+firstEdition.revision+'"]').click();await expect(content).toHaveText('FIRST EDITION 9007199254740993.');expect((await documents.read('section',{id,sectionId})).section).toEqual(firstSection);
  await page.reload();await expect(content).toHaveText('FIRST EDITION 9007199254740993.');await ui.getByRole('button',{name:'PDF exports',exact:true}).click();const restoredDownload=page.waitForEvent('download');await ui.locator('[data-pdf-export="'+jobId+'"]').getByRole('button',{name:'Download retained PDF',exact:true}).click();expect(await readFile(await (await restoredDownload).path())).toEqual(exportBytes);expect(rendered).toHaveLength(1);expect((await documents.read('list')).items.map(item=>item.id).sort()).toEqual([id,otherId].sort());expect(errors).toEqual([]);
 }finally{await app.close();removeRenderer();clearVault(fixture.vault);if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-pdf-archive-ui-'))throw Error('Unexpected test directory');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

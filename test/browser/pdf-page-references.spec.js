import {test,expect} from '@playwright/test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {PdfDocuments} from '../../src/pdf-documents.js';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {pdfStructureDefaults} from '../../src/web/pdf-structure-model.js';
import {installPdfRenderer} from '../../src/pdf-render-service.js';
import {measurePdfPreflight} from '../../src/pdf-preflight.js';
import {pdfPageReferenceMeasurementScript,pdfPageReferenceApplyScript,extractPdfPageReferences} from '../../src/pdf-page-references.js';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {navigate} from './preferences-helper.js';

test('contents page-number choice saves, reopens and reaches retained PDF exports',async({page,browser})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-pdf-pages-ui-')),fixture=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'}),errors=[];
 const removeRenderer=installPdfRenderer(async input=>{const view=await browser.newPage();try{await view.route('**/*',route=>route.abort());await view.emulateMedia({media:'print'});await view.setContent(input.html);await view.evaluate(()=>document.fonts.ready);const refs=input.pageReferences??[];if(refs.length){await view.evaluate(pdfPageReferenceMeasurementScript(refs));const measurement=await extractPdfPageReferences(await view.pdf({preferCSSPageSize:true,printBackground:true}),refs);await view.evaluate(pdfPageReferenceApplyScript(refs,measurement));}const preflight=await view.evaluate(measurePdfPreflight),bytes=await view.pdf({preferCSSPageSize:true,printBackground:true});return {bytes,preflight,sha256:createHash('sha256').update(bytes).digest('hex'),renderer:{engine:'chromium',electron:'test',chromium:browser.version(),recipeVersion:1}};}finally{await view.close();}});
 const app=await startServer({root:fixture.workspace.root,port:0,headless:true,deviceStore:fixture.deviceStore}),documents=new PdfDocuments(fixture.workspace,(await fixture.workspace.outline()).metadata.id);page.on('pageerror',error=>errors.push(error.message));
 try{
  const id=randomUUID(),first={id:randomUUID(),title:'Methods',content:'Measured results.',layout:null,start:null},second={id:randomUUID(),title:'Discussion',content:'Interpretation.',layout:null,start:'page'},header={version:1,id,name:'Contents report',language:'en',direction:'ltr',layout:pdfLayoutPreset(),structure:{...pdfStructureDefaults(),contents:true}};
  let saved=await documents.change({id,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header,section:first}});saved=await documents.change({id,commandId:randomUUID(),expectedRevision:saved.revision,operation:{type:'append',section:second}});const oldRevision=saved.revision;
  await page.goto(app.url);await navigate(page,'PDF editor');const ui=page.locator('[data-pdf-editor]');await ui.getByRole('button',{name:'Contents report',exact:true}).click();await ui.getByText('Contents and references',{exact:true}).click();await ui.getByLabel('Show page numbers in contents and lists',{exact:true}).check();await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');expect((await documents.read('open',{id})).header.structure.pageReferences).toBe(true);expect((await documents.read('open',{id,revision:oldRevision})).header.structure.pageReferences).toBeUndefined();
  await page.reload();await expect(ui.getByLabel('Section title',{exact:true})).toHaveValue('Methods');await ui.getByText('Contents and references',{exact:true}).click();await expect(ui.getByLabel('Show page numbers in contents and lists',{exact:true})).toBeChecked();
  const downloaded=page.waitForEvent('download',{timeout:45000});await ui.getByRole('button',{name:'Download PDF',exact:true}).click();const download=await downloaded,bytes=await readFile(await download.path()),task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false});try{const document=await task.promise;expect(document.numPages).toBe(3);const contents=await document.getPage(1),text=(await contents.getTextContent()).items.map(item=>item.str??'').join(' ').replace(/\s+/g,' ');expect(text).toContain('Methods 2');expect(text).toContain('Discussion 3');expect(text).not.toContain('Marker');}finally{await task.destroy();}expect(errors).toEqual([]);
 }finally{await app.close();removeRenderer();clearVault(fixture.vault);if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-pdf-pages-ui-'))throw Error('Unexpected test directory');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

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
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {navigate} from './preferences-helper.js';

const option='Print QR codes and readable URLs after each section';
test('printed link codes opt in, retain exact revisions and export readable URLs with external links disabled',async({page,browser})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-pdf-link-codes-ui-')),fixture=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'}),errors=[],rendered=[];
 const removeRenderer=installPdfRenderer(async input=>{
  const view=await browser.newPage();
  try{
   await view.route('**/*',route=>route.abort());await view.emulateMedia({media:'print'});await view.setContent(input.html);await view.evaluate(()=>document.fonts.ready);await view.locator('img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
   const images=await view.locator('.pdf-link-code svg[role="img"]').evaluateAll(images=>images.map(image=>({alt:image.getAttribute('aria-label'),width:image.getBoundingClientRect().width,height:image.getBoundingClientRect().height,paths:image.querySelectorAll('path').length}))),links=await view.locator('a[href]').evaluateAll(links=>links.map(link=>link.getAttribute('href'))),preflight=await view.evaluate(measurePdfPreflight),bytes=await view.pdf({preferCSSPageSize:true,printBackground:true});rendered.push({images,links});
   return {bytes,preflight,sha256:createHash('sha256').update(bytes).digest('hex'),renderer:{engine:'chromium',electron:'test',chromium:browser.version(),recipeVersion:1}};
  }finally{await view.close();}
 });
 const app=await startServer({root:fixture.workspace.root,port:0,headless:true,deviceStore:fixture.deviceStore}),documents=new PdfDocuments(fixture.workspace,(await fixture.workspace.outline()).metadata.id);page.on('pageerror',error=>errors.push(error.message));
 try{
  const id=randomUUID(),url='https://example.org/research/42',section={id:randomUUID(),title:'Methods',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Observed results',marks:[{type:'link',attrs:{href:url,title:'',target:'_self',nofollow:false}}]}]}]},layout:null,start:null},header={version:1,id,name:'Printed research links',language:'en',direction:'ltr',layout:pdfLayoutPreset(),structure:{...pdfStructureDefaults(),externalLinks:false}};
  const initial=await documents.change({id,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header,section}}),oldRevision=initial.revision;
  await page.goto(app.url);await navigate(page,'PDF editor');const ui=page.locator('[data-pdf-editor]');await ui.getByRole('button',{name:header.name,exact:true}).click();await ui.getByText('Contents and references',{exact:true}).click();const checkbox=ui.getByLabel(option,{exact:true});await expect(checkbox).not.toBeChecked();await expect(ui.getByLabel('Enable external links',{exact:true})).not.toBeChecked();
  await checkbox.check();await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');const enabled=await documents.read('open',{id});expect(enabled.header.structure.printQrCodes).toBe(true);expect(enabled.header.structure.externalLinks).toBe(false);expect(enabled.header.structure.printUrls).toBe(false);expect((await documents.read('open',{id,revision:oldRevision})).header).toEqual(header);
  await page.reload();await expect(ui.getByLabel('Section title',{exact:true})).toHaveValue(section.title);await ui.getByText('Contents and references',{exact:true}).click();await expect(checkbox).toBeChecked();await expect(ui.getByLabel('Enable external links',{exact:true})).not.toBeChecked();
  const downloaded=page.waitForEvent('download',{timeout:45000});await ui.getByRole('button',{name:'Download PDF',exact:true}).click();const download=await downloaded,bytes=await readFile(await download.path()),task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false});
  try{
   const document=await task.promise,text=[],external=[];expect(document.numPages).toBeGreaterThan(0);
   for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++){const pdfPage=await document.getPage(pageNumber);text.push((await pdfPage.getTextContent()).items.map(item=>item.str??'').join(' '));external.push(...(await pdfPage.getAnnotations()).filter(item=>item.subtype==='Link'&&item.url));}
   expect(text.join(' ').replace(/\s+/g,' ')).toContain(url);expect(text.join(' ')).toContain('Observed results');expect(external).toEqual([]);
  }finally{await task.destroy();}
  expect(rendered).toHaveLength(1);expect(rendered[0].links.filter(href=>/^https?:/.test(href))).toEqual([]);expect(rendered[0].images).toHaveLength(1);expect(rendered[0].images[0].alt).toContain(url);expect(rendered[0].images[0].paths).toBeGreaterThan(0);expect(rendered[0].images[0].width).toBeGreaterThan(0);expect(rendered[0].images[0].height).toBeGreaterThan(0);
  await expect(ui).toHaveAttribute('aria-busy','false');await checkbox.uncheck();await expect(ui.locator('[data-pdf-status]')).toHaveText('Saved');const disabled=await documents.read('open',{id});expect(disabled.header).toEqual({...enabled.header,structure:{...enabled.header.structure,printQrCodes:false}});expect((await documents.read('open',{id,revision:enabled.revision})).header.structure.printQrCodes).toBe(true);expect((await documents.read('open',{id,revision:oldRevision})).header.structure.printQrCodes).toBeUndefined();expect((await documents.read('section',{id,sectionId:section.id})).section).toEqual(section);
  // The chosen QR size must not silently shrink to fit a narrow column. The
  // compiler returns an actionable finding without performing another export.
  const narrowHeader={...disabled.header,layout:{...disabled.header.layout,widthMm:60,margins:{top:20,right:20,bottom:20,left:20}},structure:{...disabled.header.structure,printQrCodes:true}},narrow=await documents.change({id,commandId:randomUUID(),expectedRevision:disabled.revision,operation:{type:'header',header:narrowHeader}});
  await page.reload();await expect(ui.getByLabel('Section title',{exact:true})).toHaveValue(section.title);const checked=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/pdf/preflight'&&response.request().method()==='POST');await ui.getByRole('button',{name:'Check PDF layout',exact:true}).click();const report=await(await checked).json();expect(report).toMatchObject({revision:narrow.revision,status:'fatal',findings:[{code:'PDF_LINK_CODE_LAYOUT',sectionId:section.id}]});
  const findings=ui.locator('[data-pdf-preflight]');await expect(findings).toContainText('A QR code cannot fit at a readable size.');await findings.locator('[data-command="finding"][data-finding="0"]').click();await expect(ui.getByLabel('Section title',{exact:true})).toHaveValue(section.title);await expect(ui.getByLabel('Section title',{exact:true})).toBeFocused();await expect(ui.getByLabel('Section title',{exact:true})).toHaveAttribute('data-pdf-finding-target','');expect(rendered).toHaveLength(1);expect((await documents.read('open',{id})).revision).toBe(narrow.revision);expect(errors).toEqual([]);
 }finally{await app.close();removeRenderer();clearVault(fixture.vault);if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-pdf-link-codes-ui-'))throw Error('Unexpected test directory');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

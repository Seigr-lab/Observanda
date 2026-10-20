import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {PdfDocuments} from '../../src/pdf-documents.js';
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
import {embedPdfFonts} from '../../src/pdf-font-assets.js';
import {pdfFootnoteFlowScript} from '../../src/pdf-footnote-flow.js';
import {pdfPageReferenceMeasurementScript,pdfPageReferenceApplyScript,extractPdfPageReferences} from '../../src/pdf-page-references.js';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {pdfStructureDefaults,pdfCaptionDefaults} from '../../src/web/pdf-structure-model.js';
import {appendPdfCrossReference} from '../../src/web/pdf-cross-reference-model.js';
import {researchReference} from '../../src/web/research-reference.js';
import {createFigure} from '../../src/web/figure-model.js';
import {navigate} from './preferences-helper.js';

test('PDF saved presets, section reset and alignment grids retain exact layout choices after reopening',async({page},info)=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-pdf-controls-')),f=await encryptedFixture(directory,sampleNotebook()),documents=new PdfDocuments(f.workspace,(await f.workspace.outline()).metadata.id),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await navigate(page,'PDF editor');const ui=page.locator('[data-pdf-editor]');await ui.locator('[data-command="new"]').click();await expect(page).toHaveURL(/#\/modules\/pdf-editor\/[a-f0-9-]{36}$/);
  const open=async label=>{const summary=ui.getByText(label,{exact:true});if(!await summary.evaluate(node=>node.parentElement.open))await summary.click();};
  const id=new URL(page.url()).hash.split('/').at(-1),sectionId=(await documents.read('sections',{id})).items[0].id,saved=()=>expect(ui.locator('[data-pdf-status]')).toHaveText('Saved'),read=()=>documents.read('section',{id,sectionId}),header=()=>documents.read('open',{id}),field=(owner,key)=>ui.locator('[data-pdf-layout="'+owner+'"][data-key="'+key+'"]');
  await open('Document layout');await field('document','width').fill('185');await saved();await expect.poll(async()=>(await header()).header.layout.widthMm).toBe(185);
  const library=ui.locator('[data-pdf-library]');await open('Saved layouts');await library.locator('[data-pdf-layout-name]').fill('Field report');await library.locator('[data-command="layout-save-document"]').click();await expect(library.locator('[data-pdf-preset] option:checked')).toHaveText('Field report');
  await open('Document layout');await field('document','width').fill('190');await saved();await open('Saved layouts');await library.locator('[data-command="layout-apply-document"]').click();await saved();await expect.poll(async()=>(await header()).header.layout.widthMm).toBe(185);
  await open('Section layout');await ui.locator('[data-pdf-custom]').check();await open('Section layout');await field('section','width').fill('170');await saved();await expect.poll(async()=>(await read()).section.layout?.widthMm).toBe(170);const overridden=(await header()).revision;
  await open('Document layout');await field('document','width').fill('195');await saved();expect((await read()).section.layout.widthMm).toBe(170);
  await ui.locator('[data-pdf-custom]').uncheck();await saved();await expect.poll(async()=>(await read()).section.layout).toBeNull();
  await page.reload();await expect(ui.getByLabel('Section title',{exact:true})).toBeVisible();await open('Section layout');await expect(ui.locator('[data-pdf-custom]')).not.toBeChecked();await expect(ui.getByText('Use document layout',{exact:true})).toBeVisible();expect((await header()).header.layout.widthMm).toBe(195);expect((await documents.read('section',{id,sectionId,revision:overridden})).section.layout.widthMm).toBe(170);
  await open('Saved layouts');await library.locator('[data-pdf-preset]').selectOption({label:'Field report'});await library.locator('[data-command="layout-apply-section"]').click();await saved();await expect.poll(async()=>(await read()).section.layout?.widthMm).toBe(185);await open('Section layout');await ui.locator('[data-pdf-custom]').uncheck();await saved();
  const composition=ui.locator('[data-pdf-composition-editor]');await composition.locator(':scope > summary').click();await composition.locator('[data-pdf-composition-mode]').selectOption('page');await saved();
  await composition.locator('[data-pdf-composition-field="widthMm"]').fill('100');await composition.locator('[data-pdf-composition-field="xMm"]').fill('10');await composition.locator('[data-pdf-composition-grid]').fill('10');await saved();await expect(composition.locator('[data-pdf-composition-snap]')).toBeChecked();
  let handle=composition.locator('[data-pdf-composition-handle="block:0"]');await handle.focus();await handle.press('ArrowRight');await saved();await expect.poll(async()=>(await read()).section.composition.boxes[0].xMm).toBe(20);
  await composition.locator('[data-pdf-composition-snap]').uncheck();await saved();handle=composition.locator('[data-pdf-composition-handle="block:0"]');await handle.focus();await handle.press('ArrowRight');await saved();await expect.poll(async()=>(await read()).section.composition.boxes[0].xMm).toBe(21);
  await page.reload();await expect(composition.locator('[data-pdf-composition-grid]')).toHaveValue('10');await expect(composition.locator('[data-pdf-composition-snap]')).not.toBeChecked();await expect(composition.locator('[data-pdf-composition-field="xMm"]')).toHaveValue('21');expect(await composition.locator('[data-pdf-composition-canvas]').evaluate(node=>getComputedStyle(node).backgroundImage)).toContain('linear-gradient');
  const geometry=await composition.locator('[data-pdf-composition-handle="block:0"]').evaluate(node=>{const item=node.getBoundingClientRect(),canvas=node.closest('[data-pdf-composition-canvas]').getBoundingClientRect();return {x:(item.left-canvas.left)/canvas.width*155,width:item.width/canvas.width*155};});expect(geometry.x).toBeCloseTo(21,1);expect(geometry.width).toBeCloseTo(100,1);
  await composition.locator('[data-pdf-composition-grid]').fill('0');await saved();expect(await composition.locator('[data-pdf-composition-canvas]').evaluate(node=>getComputedStyle(node).backgroundImage)).toBe('none');await composition.locator('[data-pdf-composition-grid]').fill('10');await saved();
  const retained=(await read()).section,compiled=await compilePdfDocument((await header()).header,[retained]);expect(compiled.html).toContain('left:21mm');expect(compiled.html).not.toContain('linear-gradient');expect((await documents.read('layouts')).items.find(item=>item.name==='Field report').layout.widthMm).toBe(185);
  await composition.scrollIntoViewIfNeeded();await composition.screenshot({path:info.outputPath('alignment-grid.png')});expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-pdf-controls-'))throw Error('Unexpected test directory');await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

const link=(text,href)=>({type:'paragraph',content:[{type:'text',text,marks:[{type:'link',attrs:{href,title:'',target:'_self',nofollow:false}}]}]});
function linkedReport(){
 const header={version:1,id:randomUUID(),name:'Link policy report',language:'en',direction:'ltr',layout:pdfLayoutPreset(),structure:{...pdfStructureDefaults(),contents:true,numberSections:true,pageReferences:true,printUrls:true,printQrCodes:true,caption:{...pdfCaptionDefaults(),numberFigures:true,numberTables:true,listFigures:true,listTables:true}}},source={workspaceId:randomUUID(),recordId:randomUUID(),snapshotId:'a'.repeat(64),recordRevision:'b'.repeat(64)},sections=[],urls=['HTTPS://example.org/method','http://example.org/result','mailto:research@example.org','tel:+12025550123','https://example.org/citation'];
 for(const collection of ['body','sections','figures']){const id=randomUUID(),itemId=randomUUID(),title='Retained '+collection,content='Exact retained '+collection,research={version:1,...source,collection,itemId,title,content,figures:[]};sections.push({id,title,content,layout:null,start:null,research});}
 const figure=createFigure();figure.series[0].points=[{x:1,y:2,error:null},{x:2,y:3,error:null}];const tableId=randomUUID(),placement=randomUUID(),target={id:randomUUID(),title:'Data',layout:null,start:null,figures:[figure],content:{type:'doc',content:[{type:'book_table',attrs:{version:1,id:tableId,title:'Exact readings',headers:['Value'],rows:[['9007199254740993']]}},{type:'book_figure',attrs:{version:1,id:placement,figureId:figure.id,alternative:'Measured trace'}}]}};
 const origin={id:randomUUID(),title:'References',layout:{...pdfLayoutPreset(),fontSizePt:10},start:null,content:{type:'doc',content:[...urls.slice(0,4).map((href,index)=>link('External '+index,href)),{type:'book_citation',attrs:{version:1,id:randomUUID(),title:'Cited observation',authors:'An author',issued:'2026',locator:'p. 4',url:urls[4]}},...sections.map(section=>link('Research '+section.research.collection,researchReference({workspaceId:source.workspaceId,kind:'record',id:source.recordId,revision:source.recordRevision,...(section.research.collection==='body'?{}:{selector:{version:1,kind:section.research.collection==='figures'?'figure':'section',id:section.research.itemId}})})))]},notes:['footnote','page-footnote','endnote'].map((kind,index)=>({id:randomUUID(),kind,block:index+1,content:{type:'doc',content:[link('Readable '+kind,urls[0])]}}))};
 for(const [kind,blockId] of [['section',null],['table',tableId],['figure',placement]])origin.content=appendPdfCrossReference(origin.content,{documentId:header.id,sectionId:target.id,kind,blockId},'Outdated reference');
 return {header,sections:[origin,...sections,target],urls};
}

test('all disabled PDF link categories produce no link annotations while printed URLs, labels and QR choices survive',async({browser},info)=>{
 test.setTimeout(120000);const fixture=linkedReport(),original=structuredClone(fixture),view=await browser.newPage();
 try{
  await view.route('**/*',route=>route.abort());await view.emulateMedia({media:'print'});
  for(const mode of ['enabled','document-disabled','categories-disabled','disabled-without-codes']){
   const header=structuredClone(fixture.header);if(mode==='document-disabled'||mode==='disabled-without-codes')header.layout.links='disabled';if(mode==='categories-disabled'){header.structure.internalLinks=false;header.structure.externalLinks=false;}if(mode==='disabled-without-codes'){header.structure.printQrCodes=false;header.structure.printUrls=false;}
   const compiled=await embedPdfFonts(await compilePdfDocument(header,fixture.sections));await view.setContent(compiled.html);await view.evaluate(()=>document.fonts.ready);const flow=await view.evaluate(pdfFootnoteFlowScript(compiled.footnoteFlow));expect(flow.preflight?.status).not.toBe('fatal');expect(flow.footnotes).toBe(1);
   const refs=compiled.pageReferences;await view.evaluate(pdfPageReferenceMeasurementScript(refs));const measurement=await extractPdfPageReferences(await view.pdf({preferCSSPageSize:true,printBackground:true}),refs);await view.evaluate(pdfPageReferenceApplyScript(refs,measurement));
   const anchors=await view.locator('a[href]').count(),codes=await view.locator('.pdf-link-code').count();if(mode==='enabled')expect(anchors).toBeGreaterThan(15);else expect(anchors).toBe(0);expect(codes).toBe(mode==='disabled-without-codes'?0:5);
   const bytes=await view.pdf({preferCSSPageSize:true,printBackground:true}),task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false});let text='',annotations=[];
   try{const pdf=await task.promise;for(let number=1;number<=pdf.numPages;number++){const page=await pdf.getPage(number);text+=(await page.getTextContent()).items.map(item=>item.str??'').join(' ')+' ';annotations.push(...(await page.getAnnotations()).filter(item=>item.subtype==='Link'));}}finally{await task.destroy();}
   if(mode==='enabled')expect(annotations.length).toBeGreaterThan(15);else expect(annotations).toEqual([]);
   for(const value of ['External 0','Cited observation','Research body','Research sections','Research figures','Readable footnote','Readable page-footnote','Readable endnote','Table 1','Figure 1','9007199254740993'])expect(text).toContain(value);
   for(const url of fixture.urls)if(mode==='disabled-without-codes')expect(text).not.toContain(url);else expect(text.replace(/\s+/g,'')).toContain(url);
   expect(text).not.toContain('Outdated reference');expect(text).not.toContain('Marker');if(mode==='document-disabled')await view.screenshot({path:info.outputPath('links-disabled.png'),fullPage:true});
  }
  expect(fixture).toEqual(original);
 }finally{await view.close();}
});

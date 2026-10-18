import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {PDFDocument} from '@cantoo/pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {pdfPressDefaults} from '../../src/web/pdf-press-model.js';
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
const mm=n=>n*72/25.4;
test('hidden desktop renderer applies press boxes only to final output with working tags, links and final digest',async({},info)=>{
 const parent=path.resolve(os.tmpdir()),profile=await mkdtemp(path.join(parent,'observanda-pdf-press-')),env={...process.env,OBSERVANDA_PDF_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;let app;
 try{
  const layout=pdfLayoutPreset(),landscape={...structuredClone(layout),widthMm:297,heightMm:210},header={version:1,id:randomUUID(),name:'Physical press geometry',language:'en',direction:'ltr',layout,press:pdfPressDefaults()},sections=[{id:randomUUID(),title:'Portrait trim',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Retained external link',marks:[{type:'link',attrs:{href:'https://example.org/retained',title:'',target:'_self',nofollow:false}}]}]}]},layout:null,start:null},{id:randomUUID(),title:'Landscape trim',content:'Second retained page.',layout:landscape,start:'page'}],input=await compilePdfDocument(header,sections);expect(input.press).toEqual(header.press);
  app=await electron.launch({args:[path.resolve('test/fixtures/pdf-renderer-app.cjs')],env});await app.evaluate(({app})=>{globalThis.pressShown=0;app.on('browser-window-created',(_event,win)=>win.on('show',()=>globalThis.pressShown++));});
  const output=await app.evaluate(async({BrowserWindow},input)=>{const {renderPdfDocument}=await globalThis.pdfService,result=await renderPdfDocument(input);return {pdf:result.bytes?.toString('base64'),sha256:result.sha256,preflight:result.preflight,conformance:result.conformance,shown:globalThis.pressShown,windows:BrowserWindow.getAllWindows().length};},input);
  expect(output.preflight.status).not.toBe('fatal');expect(output.shown).toBe(0);expect(output.windows).toBe(0);expect(output.conformance).toEqual([]);const bytes=Buffer.from(output.pdf,'base64');expect(output.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));const pdf=await PDFDocument.load(bytes,{updateMetadata:false});expect(pdf.getPageCount()).toBe(2);
  for(const [index,page] of pdf.getPages().entries()){const width=index?297:210,height=index?210:297,trim=page.getTrimBox(),media=page.getMediaBox();expect(trim.width).toBeCloseTo(mm(width),0);expect(trim.height).toBeCloseTo(mm(height),0);expect(media.x).toBeCloseTo(-mm(8),7);expect(media.width-trim.width).toBeCloseTo(mm(16),7);expect(page.getBleedBox().width-trim.width).toBeCloseTo(mm(6),7);}
  const task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false});try{const document=await task.promise;expect((await document.getOutline()).map(row=>row.title)).toEqual(['Portrait trim','Landscape trim']);const page=await document.getPage(1);expect(await page.getStructTree()).toBeTruthy();expect((await page.getAnnotations()).some(row=>row.url==='https://example.org/retained')).toBe(true);}finally{await task.destroy();}await writeFile(info.outputPath('hidden-press-geometry.pdf'),bytes);
 }finally{await app?.close();if(path.dirname(profile)!==parent||!path.basename(profile).startsWith('observanda-pdf-press-'))throw Error('Unexpected profile');await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

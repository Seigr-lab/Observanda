import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {pdfPageMasterDefaults} from '../../src/web/pdf-page-master-model.js';
import {pdfStructureDefaults,pdfCaptionDefaults} from '../../src/web/pdf-structure-model.js';
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
import {embedPdfFonts} from '../../src/pdf-font-assets.js';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';

test('desktop contents and table lists use actual destination pages with mixed layouts and no leaked measurement pages',async({},info)=>{
 const parent=path.resolve(os.tmpdir()),profile=await mkdtemp(path.join(parent,'observanda-pdf-references-desktop-')),env={...process.env,OBSERVANDA_PDF_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;let app;
 try{
  app=await electron.launch({args:[path.resolve('test/fixtures/pdf-renderer-app.cjs')],env});await app.evaluate(({app})=>{globalThis.pdfShown=0;app.on('browser-window-created',(_event,win)=>win.on('show',()=>globalThis.pdfShown++));});
  const layout=pdfLayoutPreset('print');layout.pageMaster={...pdfPageMasterDefaults(layout),numberStyle:'lower-roman',numberStart:5};
  const h={version:1,id:randomUUID(),name:'Measured page references',language:'en',direction:'ltr',layout,structure:{...pdfStructureDefaults(),contents:true,pageReferences:true,caption:{...pdfCaptionDefaults(),numberTables:true,listTables:true}}};
  const a={id:randomUUID(),title:'Methods',content:'Measured observations.',layout:null,start:null},b={id:randomUUID(),title:'Measurements',content:{type:'doc',content:[{type:'book_table',attrs:{version:1,id:randomUUID(),title:'Exact readings',headers:['Reading','Value'],rows:[['First','9007199254740993']]}}]},layout:{...layout,widthMm:297,heightMm:210,pageMaster:{...layout.pageMaster,numberStyle:'upper-roman'}},start:'page'};
  const input=await embedPdfFonts(await compilePdfDocument(h,[a,b]));expect(input.pageReferences).toHaveLength(3);
  const render=async payload=>app.evaluate(async({BrowserWindow},input)=>{try{const result=await(await globalThis.pdfService).renderPdfDocument(input);return {pdf:result.bytes?.toString('base64')??null,preflight:result.preflight,windows:BrowserWindow.getAllWindows().length,shown:globalThis.pdfShown};}catch(error){return {code:error.code,windows:BrowserWindow.getAllWindows().length};}},payload);
  const check=await render({...input,preflightOnly:true});expect(check.pdf).toBeNull();expect(check.preflight.status).not.toBe('fatal');expect(check.windows).toBe(0);
  const result=await render(input);expect(result.preflight.status).not.toBe('fatal');expect(result.windows).toBe(0);expect(result.shown).toBe(0);const bytes=Buffer.from(result.pdf,'base64'),task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,useWasm:false,useWorkerFetch:false});
  try{const document=await task.promise;expect(document.numPages).toBe(4);const text=[],annotations=[],sizes=[];for(let index=1;index<=document.numPages;index++){const page=await document.getPage(index);text.push((await page.getTextContent()).items.map(item=>item.str??'').join(' ').replace(/\s+/g,' '));annotations.push(...await page.getAnnotations());sizes.push(page.view);page.cleanup();}
   expect(text[0]).toMatch(/Methods vii/);expect(text[0]).toMatch(/Measurements VIII/);expect(text[1]).toMatch(/Table 1. Exact readings VIII/);expect(text[2]).toContain('Measured observations.');expect(text[3]).toContain('9007199254740993');expect(text.join(' ')).not.toMatch(/Marker|Destination|pdf-reference/);expect(annotations).toHaveLength(0);expect(sizes[3][2]).toBeGreaterThan(sizes[3][3]);expect(sizes[0][2]).toBeLessThan(sizes[0][3]);
  }finally{await task.destroy();}
  await writeFile(info.outputPath('measured-contents.pdf'),bytes);
  const invalid={...input,pageReferences:[{...input.pageReferences[0],target:'missing-target'}]},failed=await render(invalid);expect(failed.code).toBe('PDF_PAGE_REFERENCES');expect(failed.windows).toBe(0);
 }finally{await app?.close();if(path.dirname(profile)!==parent||!path.basename(profile).startsWith('observanda-pdf-references-desktop-'))throw Error('Unexpected profile');await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

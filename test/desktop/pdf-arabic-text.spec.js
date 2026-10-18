import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
const run=promisify(execFile),python=process.env.OBSERVANDA_PDF_PYTHON||'python';
const extract="import sys,json,pymupdf; d=pymupdf.open(sys.argv[1]); print(json.dumps([p.get_text(flags=pymupdf.TEXTFLAGS_TEXT|pymupdf.TEXT_INHIBIT_SPACES) for p in d])); d.close()";
async function exactText(file){return JSON.parse((await run(python,['-c',extract,file],{windowsHide:true,maxBuffer:4*1024*1024})).stdout).join('\n');}
async function inspectorAvailable(){try{await run(python,['-c','import pymupdf'],{windowsHide:true});return true;}catch{return false;}}
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
import {embedPdfFonts} from '../../src/pdf-font-assets.js';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';

test('explicit noncolor Arabic typography retains exact Unicode for ActualText-aware readers',async({},info)=>{
 test.skip(!await inspectorAvailable(),'Exact ActualText inspection requires Python with PyMuPDF; set OBSERVANDA_PDF_PYTHON if needed.');
 const parent=path.resolve(os.tmpdir()),profile=await mkdtemp(path.join(parent,'observanda-pdf-arabic-')),env={...process.env,OBSERVANDA_PDF_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;let app,task;
 const arabic='\u0645\u0631\u062d\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645';
 try{
  const header={version:1,id:randomUUID(),name:'Arabic Unicode qualification',language:'ar',direction:'rtl',layout:{...pdfLayoutPreset(),font:'aref-ruqaa'}},section={id:randomUUID(),title:'Arabic exercise',layout:null,start:null,content:arabic+' - WORKBOOK EXERCISE 9007199254740993.'},input=await embedPdfFonts(await compilePdfDocument(header,[section]));
  app=await electron.launch({args:[path.resolve('test/fixtures/pdf-renderer-app.cjs')],env});const result=await app.evaluate(async({app,BrowserWindow},input)=>{await app.whenReady();const renderer=await globalThis.pdfService,result=await renderer.renderPdfDocument(input);return {bytes:result.bytes?.toString('base64'),preflight:result.preflight,visible:BrowserWindow.getAllWindows().some(window=>window.isVisible())};},input);
  expect(result.visible).toBe(false);expect(result.preflight.status).not.toBe('fatal');const bytes=Buffer.from(result.bytes,'base64');await writeFile(info.outputPath('arabic-unicode.pdf'),bytes);
  task=getDocument({data:new Uint8Array(bytes),useSystemFonts:false,isEvalSupported:false,disableFontFace:true});const pdf=await task.promise,page=await pdf.getPage(1),text=await page.getTextContent(),metadata=await pdf.getMetadata(),items=text.items.filter(item=>typeof item.str==='string');
  expect(metadata.info.Language).toBe('ar');expect(items.some(item=>item.dir==='rtl')).toBe(true);expect(await page.getStructTree()).toBeTruthy();
  // PDF.js does not consume Chromium's ActualText spans for decomposed Arabic
  // glyphs. Inspect those spans with an independent reader; suppress only its
  // inferred whitespace, retaining every authored character and space.
  const exact=await exactText(info.outputPath('arabic-unicode.pdf'));expect(exact).toContain(arabic);expect(exact).not.toContain('\u0000');
  await writeFile(info.outputPath('arabic-unicode-inspection.json'),JSON.stringify({metadata:metadata.info,pdfjsItems:items,exact},null,2)+'\n');
 }finally{try{await task?.destroy();}finally{try{await app?.close();}finally{if(path.dirname(profile)!==parent||!path.basename(profile).startsWith('observanda-pdf-arabic-'))throw Error('Unexpected test directory');await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}}}
});

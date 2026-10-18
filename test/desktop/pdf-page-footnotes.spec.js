import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {pdfStructureDefaults} from '../../src/web/pdf-structure-model.js';
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
import {embedPdfFonts} from '../../src/pdf-font-assets.js';
import {pdfCompositionDefaults} from '../../src/web/pdf-composition-model.js';
import {validPdfPreflight} from '../../src/pdf-preflight.js';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
const paragraph=text=>({type:'paragraph',content:[{type:'text',text}]});

test('desktop page notes keep their calls, continue without losing text and coexist with measured contents',async({},info)=>{
 const parent=path.resolve(os.tmpdir()),profile=await mkdtemp(path.join(parent,'observanda-pdf-footnotes-desktop-')),env={...process.env,OBSERVANDA_PDF_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;let app;
 try{
  app=await electron.launch({args:[path.resolve('test/fixtures/pdf-renderer-app.cjs')],env});await app.evaluate(({app})=>{globalThis.pdfShown=0;app.on('browser-window-created',(_event,win)=>win.on('show',()=>globalThis.pdfShown++));});
  const layout={...pdfLayoutPreset(),widthMm:120,heightMm:140,margins:{top:10,right:10,bottom:10,left:10},fontSizePt:10,lineHeight:1.4},header={version:1,id:randomUUID(),name:'Page footnote qualification',language:'en',direction:'ltr',layout,structure:{...pdfStructureDefaults(),contents:true,pageReferences:true}};
  const body=Array.from({length:24},(_,index)=>'Body paragraph '+String(index+1).padStart(2,'0')+'. Exact observation remains unchanged.'),notes=Array.from({length:18},(_,index)=>'Note segment '+String(index+1).padStart(2,'0')+'. Supporting information.'),section={id:randomUUID(),title:'Methods',content:{type:'doc',content:body.map(paragraph)},layout:null,start:null,notes:[{id:randomUUID(),kind:'page-footnote',block:4,content:{type:'doc',content:notes.map(paragraph)}},{id:randomUUID(),kind:'page-footnote',block:4,content:'Companion explanation.'}]};
  const input=await embedPdfFonts(await compilePdfDocument(header,[section])),output=await app.evaluate(async({BrowserWindow},input)=>{try{const result=await(await globalThis.pdfService).renderPdfDocument(input);return {pdf:result.bytes?.toString('base64'),preflight:result.preflight,windows:BrowserWindow.getAllWindows().length,shown:globalThis.pdfShown};}catch(error){return {error:error.code,message:error.message};}},input);
  expect(output.error).toBeUndefined();expect(output.preflight.status).not.toBe('fatal');expect(output.shown).toBe(0);expect(output.windows).toBe(0);const bytes=Buffer.from(output.pdf,'base64'),task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,useWasm:false,useWorkerFetch:false});
  try{
   const document=await task.promise,text=[],items=[],annotations=[];expect(document.numPages).toBeGreaterThan(3);
   for(let index=1;index<=document.numPages;index++){const page=await document.getPage(index),content=await page.getTextContent();items.push(content.items);text.push(content.items.map(item=>item.str??'').join(' ').replace(/\s+/g,' '));annotations.push(await page.getAnnotations());page.cleanup();}
   expect(text[0]).toContain('Methods 2');const all=text.join(' ');for(const value of [...body,...notes,'Companion explanation.'])expect(all.split(value)).toHaveLength(2);
   const callPage=text.findIndex(value=>value.includes('Body paragraph 04.')),notePage=text.findIndex(value=>value.includes('Note segment 01.'));expect(notePage).toBe(callPage);expect(text[notePage]).toContain('Companion explanation.');expect(text.findIndex(value=>value.includes('Note segment 18.'))).toBeGreaterThan(notePage);
   const y=word=>items[notePage].find(item=>item.str?.includes(word))?.transform[5];expect(y('Note segment 01.')).toBeLessThan(y('Body paragraph 04.'));
   expect(all).not.toMatch(/Marker|Destination|pdf-reference/);expect(annotations.flat().some(value=>value.dest)).toBe(true);
  }finally{await task.destroy();}
  await writeFile(info.outputPath('continued-page-footnotes.pdf'),bytes);
  const mixedHeader={...header,layout:{...layout,widthMm:150,heightMm:160,columns:2},structure:{...header.structure,contents:false,pageReferences:false}},columnText=Array.from({length:32},(_,index)=>'Column observation '+String(index+1).padStart(2,'0')+'. Meaningful retained text.');
  const columns={id:randomUUID(),title:'Two columns',layout:null,start:null,content:{type:'doc',content:columnText.map(paragraph)},notes:[{id:randomUUID(),kind:'page-footnote',block:4,content:'Shared full-width note.'}]};
  const positioned={id:randomUUID(),title:'Positioned page',layout:{...mixedHeader.layout,columns:1},start:'page',content:'Positioned observation.',notes:[{id:randomUUID(),kind:'page-footnote',block:1,content:'Positioned page note.'}]};positioned.composition=pdfCompositionDefaults(positioned,positioned.layout);positioned.composition.boxes=positioned.composition.boxes.map(box=>({...box,yMm:box.target.kind==='title'?0:24,heightMm:box.target.kind==='title'?14:40}));
  let mixedInput=await embedPdfFonts(await compilePdfDocument(mixedHeader,[columns,positioned]));
  const mixed=await app.evaluate(async(_electron,input)=>{const result=await(await globalThis.pdfService).renderPdfDocument(input);return {pdf:result.bytes?.toString('base64'),preflight:result.preflight};},mixedInput);expect(mixed.preflight.status,JSON.stringify(mixed.preflight)).toBe('ok');expect(mixed.pdf).toBeTruthy();
  const mixedBytes=Buffer.from(mixed.pdf,'base64'),mixedTask=getDocument({data:new Uint8Array(mixedBytes),isEvalSupported:false});try{const pdf=await mixedTask.promise,pages=[];for(let index=1;index<=pdf.numPages;index++)pages.push((await(await pdf.getPage(index)).getTextContent()).items.map(item=>item.str??'').join(' ').replace(/\s+/g,' '));const all=pages.join(' ');for(const value of [...columnText,'Shared full-width note.','Positioned observation.','Positioned page note.'])expect(all.split(value)).toHaveLength(2);expect(pages.find(value=>value.includes('Column observation 04.'))).toContain('Shared full-width note.');expect(pages.find(value=>value.includes('Positioned observation.'))).toContain('Positioned page note.');}finally{await mixedTask.destroy();}
  await writeFile(info.outputPath('mixed-page-footnotes.pdf'),mixedBytes);
  positioned.composition.boxes=positioned.composition.boxes.map(box=>({...box,yMm:0,heightMm:139.9}));mixedInput=await embedPdfFonts(await compilePdfDocument(mixedHeader,[positioned]));
  const refused=await app.evaluate(async(_electron,input)=>{const result=await(await globalThis.pdfService).renderPdfDocument(input);return {empty:result.bytes===null,preflight:result.preflight};},mixedInput);expect(refused.empty).toBe(true);expect(validPdfPreflight(refused.preflight)).toBe(true);expect(refused.preflight.findings).toContainEqual(expect.objectContaining({code:'PDF_FOOTNOTE_OVERFLOW',severity:'fatal',sectionId:positioned.id,blockId:expect.stringContaining(positioned.notes[0].id)}));
 }finally{await app?.close();if(path.dirname(profile)!==parent||!path.basename(profile).startsWith('observanda-pdf-footnotes-desktop-'))throw Error('Unexpected profile');await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

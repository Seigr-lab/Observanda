import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {PDFDocument} from '@cantoo/pdf-lib';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
import {embedPdfFonts} from '../../src/pdf-font-assets.js';
import {pdfArchivalAvailable} from '../../src/pdf-archival.js';
import {validPdfArchivalReceipt} from '../../src/web/pdf-archival-model.js';
test('archival desktop export validates the final press PDF and returns its exact receipt through IPC',async({},info)=>{
 test.skip(!await pdfArchivalAvailable(),'Prepared offline PDF validation runtime required');
 const parent=path.resolve(os.tmpdir()),profile=await mkdtemp(path.join(parent,'observanda-pdf-archival-desktop-')),env={...process.env,OBSERVANDA_PDF_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;let app;
 try{
  const header={version:1,id:randomUUID(),name:'Validated archival edition',language:'en',direction:'ltr',layout:pdfLayoutPreset(),outputProfile:'pdfa-2u',press:{version:1,bleedMm:3,cropMarks:true}},sections=[{id:randomUUID(),title:'Archival report',content:'Retained Unicode and embedded fonts.',layout:null,start:null}];const input=await embedPdfFonts(await compilePdfDocument(header,sections));expect(input.outputProfile).toBe('pdfa-2u');
  app=await electron.launch({args:[path.resolve('test/fixtures/pdf-renderer-app.cjs')],env});
  const result=await app.evaluate(async({app,BrowserWindow},input)=>{const [{attachPdfService},{pdfRenderBridge},{EventEmitter}]=await globalThis.pdfBridgeModules,host=new EventEmitter(),service=new EventEmitter();host.connected=service.connected=true;host.send=value=>queueMicrotask(()=>service.emit('message',structuredClone(value)));service.send=value=>queueMicrotask(()=>host.emit('message',structuredClone(value)));const detach=attachPdfService(host),bridge=pdfRenderBridge(service);let shown=0;app.on('browser-window-created',(_event,win)=>win.on('show',()=>shown++));try{const capabilities=await bridge.capabilities(),result=await bridge.render(input),preflight=await bridge.render({...input,preflightOnly:true});return {capabilities,pdf:result.bytes.toString('base64'),validation:result.validation,sha256:result.sha256,conformance:result.conformance,preflightOnly:preflight.bytes===null&&preflight.validation===undefined,shown,windows:BrowserWindow.getAllWindows().length};}finally{bridge.close();detach();}},input);
  expect(result.capabilities).toEqual({archival:true});expect(result.conformance).toEqual(['pdfa-2u']);expect(result.preflightOnly).toBe(true);expect(result.shown).toBe(0);expect(result.windows).toBe(0);const bytes=Buffer.from(result.pdf,'base64'),hash=createHash('sha256').update(bytes).digest('hex');expect(result.sha256).toBe(hash);expect(validPdfArchivalReceipt(result.validation)).toBe(true);expect(result.validation.sha256).toBe(hash);expect(result.validation.passedRules).toBeGreaterThan(100);const pdf=await PDFDocument.load(bytes,{updateMetadata:false});expect(pdf.getPageCount()).toBe(1);expect(pdf.getPage(0).getTrimBox().width).toBeCloseTo(210*72/25.4,0);expect(pdf.getPage(0).getMediaBox().width).toBeGreaterThan(pdf.getPage(0).getTrimBox().width);await writeFile(info.outputPath('validated-archival-press.pdf'),bytes);
 }finally{await app?.close();if(path.dirname(profile)!==parent||!path.basename(profile).startsWith('observanda-pdf-archival-desktop-'))throw Error('Unexpected profile');await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

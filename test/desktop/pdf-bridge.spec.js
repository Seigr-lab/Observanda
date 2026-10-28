import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
import {embedPdfFonts} from '../../src/pdf-font-assets.js';

test('desktop PDF bridge returns real bytes and aborts the renderer without opening a visible window',async()=>{
 const profile=await mkdtemp(path.join(os.tmpdir(),'observanda-pdf-bridge-')),env={...process.env,OBSERVANDA_PDF_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;let app;
 try{
  app=await electron.launch({args:[path.resolve('test/fixtures/pdf-renderer-app.cjs')],env});
  const input=await embedPdfFonts(await compilePdfDocument({version:1,id:randomUUID(),name:'Document',language:'en',direction:'ltr',layout:pdfLayoutPreset()},[{id:randomUUID(),title:'Report',content:'Retained content',layout:null,start:null}]));
  const result=await app.evaluate(async({BrowserWindow},input)=>{
   const [{attachPdfService},{pdfRenderBridge},{EventEmitter},{NativeResourceBudget}]=await globalThis.pdfBridgeModules;
   const service=new EventEmitter(),host=new EventEmitter();service.connected=host.connected=true;
   service.send=value=>queueMicrotask(()=>host.emit('message',JSON.parse(JSON.stringify(value))));host.send=value=>queueMicrotask(()=>service.emit('message',JSON.parse(JSON.stringify(value))));
   // Production sender and renderer have separate processes and budgets.
   const budget=new NativeResourceBudget(),detach=attachPdfService(host),bridge=pdfRenderBridge(service,{budget});
   try{
    const available=budget.available;let pressured;budget.available=()=>0;
    try{await bridge.render(input);}catch(error){pressured=error.code;}finally{budget.available=available;}
    const first=await bridge.render(input),controller=new AbortController(),pending=bridge.render(input,{signal:controller.signal});let busy;
    try{await bridge.render(input);}catch(error){busy=error.code;}controller.abort();let cancelled;try{await pending;}catch(error){cancelled=error.name;}
    await new Promise(resolve=>setTimeout(resolve,100));return {header:first.bytes.subarray(0,5).toString(),hash:first.sha256,renderer:first.renderer,pressured,reserved:budget.stats().reservedBytes,busy,cancelled,visible:BrowserWindow.getAllWindows().some(win=>win.isVisible())};
   }finally{bridge.close();detach();}
  },input);
  expect(result.header).toBe('%PDF-');expect(result.hash).toMatch(/^[a-f0-9]{64}$/);expect(result.renderer.engine).toBe('chromium');expect(result.pressured).toBe('WORKLOAD_BUSY');expect(result.reserved).toBe(0);expect(result.busy).toBe('PDF_BUSY');expect(result.cancelled).toBe('AbortError');expect(result.visible).toBe(false);
 }finally{await app?.close();await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {createCanvas} from '@napi-rs/canvas';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import jsQR from 'jsqr';
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
import {embedPdfFonts} from '../../src/pdf-font-assets.js';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {pdfStructureDefaults} from '../../src/web/pdf-structure-model.js';
import {pdfArchivalAvailable} from '../../src/pdf-archival.js';
import {validPdfAccessibilityReceipt} from '../../src/web/pdf-output-validation-model.js';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function inspect(bytes,info,label){
 const task=getDocument({data:Uint8Array.from(bytes),isEvalSupported:false,useSystemFonts:false}),codes=[],text=[],actions=[];
 try{
  const document=await task.promise;expect(document.numPages).toBe(1);
  for(let number=1;number<=document.numPages;number++){
   const page=await document.getPage(number),viewport=page.getViewport({scale:3}),canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height)),context=canvas.getContext('2d');
   await page.render({canvasContext:context,viewport}).promise;const pixels=context.getImageData(0,0,canvas.width,canvas.height),decoded=jsQR(pixels.data,canvas.width,canvas.height,{inversionAttempts:'dontInvert'});if(decoded)codes.push(decoded.data);
   text.push(...(await page.getTextContent()).items.filter(row=>typeof row.str==='string').map(row=>row.str));actions.push(...(await page.getAnnotations()).filter(row=>row.url||row.unsafeUrl||row.action));
   await writeFile(info.outputPath(label+'-'+number+'.png'),canvas.toBuffer('image/png'));
  }
  await writeFile(info.outputPath(label+'.pdf'),bytes);return {codes,text:text.join(''),actions};
 }finally{await task.destroy();}
}
test('printed QR codes decode from actual PDF pixels without enabling interactive links',async({},info)=>{
 const parent=path.resolve(os.tmpdir()),profile=await mkdtemp(path.join(parent,'observanda-pdf-link-codes-')),env={...process.env,OBSERVANDA_PDF_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;let app;
 try{
  const url='https://example.org/observations/run-42?value=0.123400&unit=mV#methods',header={version:1,id:randomUUID(),name:'Printed observation link',language:'en',direction:'ltr',layout:pdfLayoutPreset(),structure:{...pdfStructureDefaults(),externalLinks:false,printUrls:false,printQrCodes:true}},section={id:randomUUID(),title:'Measured observation',layout:null,start:null,content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Open the measured observation',marks:[{type:'link',attrs:{href:url,title:'Original observation',target:'_self',nofollow:false}}]}]}]}},original=JSON.stringify(section);
  app=await electron.launch({args:[path.resolve('test/fixtures/pdf-renderer-app.cjs')],env});await app.evaluate(({app})=>{globalThis.qrShown=0;app.on('browser-window-created',(_event,window)=>window.on('show',()=>globalThis.qrShown++));});
  const render=async selected=>{const input=await embedPdfFonts(await compilePdfDocument(selected,[section])),result=await app.evaluate(async({BrowserWindow},input)=>{const value=await(await globalThis.pdfService).renderPdfDocument(input);return {bytes:value.bytes?.toString('base64'),sha256:value.sha256,validation:value.validation,preflight:value.preflight,shown:globalThis.qrShown,windows:BrowserWindow.getAllWindows().length};},input);expect(result.preflight.status).not.toBe('fatal');expect(result.bytes).toBeTruthy();expect(result.shown).toBe(0);expect(result.windows).toBe(0);const bytes=Buffer.from(result.bytes,'base64');expect(result.sha256).toBe(sha(bytes));return {...result,bytes};};
  const generated=await render(header),printed=await inspect(generated.bytes,info,'printed-link-code');expect(printed.codes).toEqual([url]);expect(printed.text).toContain(url);expect(printed.text).toContain('Open the measured observation');expect(printed.actions).toEqual([]);expect(JSON.stringify(section)).toBe(original);
  const disabled=await render({...header,structure:{...header.structure,printQrCodes:false}}),without=await inspect(disabled.bytes,info,'printed-link-without-code');expect(without.codes).toEqual([]);expect(without.text).not.toContain(url);expect(without.text).toContain('Open the measured observation');expect(without.actions).toEqual([]);
  if(await pdfArchivalAvailable()){
   const checked=await render({...header,outputProfile:'pdfua-1'}),accessible=await inspect(checked.bytes,info,'printed-link-code-ua1');expect(accessible.codes).toEqual([url]);expect(accessible.text).toContain(url);expect(accessible.actions).toEqual([]);expect(validPdfAccessibilityReceipt(checked.validation)).toBe(true);expect(checked.validation.sha256).toBe(sha(checked.bytes));expect(checked.validation.automatedOnly).toBe(true);
  }
 }finally{await app?.close();if(path.dirname(profile)!==parent||!path.basename(profile).startsWith('observanda-pdf-link-codes-'))throw Error('Unexpected profile');await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

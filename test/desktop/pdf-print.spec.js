import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {PDFDocument,PDFName,PDFArray,PDFDict,decodePDFRawStream} from '@cantoo/pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
import {embedPdfFonts} from '../../src/pdf-font-assets.js';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {pdfArchivalAvailable} from '../../src/pdf-archival.js';
import {validPdfAccessibilityReceipt} from '../../src/web/pdf-output-validation-model.js';
import {makePdfPrinterProfile} from '../fixtures/pdf-icc.js';
import {bleedPicture} from '../fixtures/pdf-bleed-image.js';
import {preparePdfBleedImage} from '../../src/pdf-bleed-artwork.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),name=PDFName.of;
async function inspect(bytes,icc){
 const pdf=await PDFDocument.load(bytes,{updateMetadata:false}),intents=pdf.catalog.lookup(name('OutputIntents'),PDFArray);expect(intents.size()).toBe(1);const intent=pdf.context.lookup(intents.get(0));expect(String(intent.get(name('S')))).toBe('/GTS_PDFX');expect(Buffer.from(decodePDFRawStream(pdf.context.lookup(intent.get(name('DestOutputProfile')))).decode()).equals(icc)).toBe(true);expect(bytes.toString('latin1')).not.toMatch(/GTS_PDFXVersion|pdfxid/);
 const page=pdf.getPage(0),objects=page.node.Resources().lookup(name('XObject'),PDFDict),artwork=pdf.context.lookup(objects.get(name('ObservandaBleedArtwork')));expect(artwork.dict.lookup(name('Width')).asNumber()).toBe(300);expect(artwork.dict.lookup(name('Height')).asNumber()).toBe(100);expect(String(artwork.dict.lookup(name('ColorSpace'),PDFArray).get(0))).toBe('/ICCBased');const contents=page.node.Contents(),rows=contents instanceof PDFArray?contents.asArray():[contents],streams=rows.map(ref=>Buffer.from(decodePDFRawStream(pdf.context.lookup(ref)).decode()).toString('latin1')).join('\n');expect(streams).toContain('/ObservandaBleedArtwork Do');expect(streams).toContain('0 1 0 rg');
 const loading=getDocument({data:Uint8Array.from(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true});try{const parsed=await loading.promise,rows=[];for(let n=1;n<=parsed.numPages;n++)rows.push(...(await(await parsed.getPage(n)).getTextContent()).items.map(x=>x.str));expect(rows.join(' ')).toContain('Exact measured value 0.123400');}finally{await loading.destroy();}return pdf;
}
test('compiled printer-profile output retains its ICC and supports final-byte UA automated checks without a PDF/X claim',async({},info)=>{
 const parent=path.resolve(os.tmpdir()),profile=await mkdtemp(path.join(parent,'observanda-pdf-print-')),env={...process.env,OBSERVANDA_PDF_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;let app;
 try{
  const picture=bleedPicture(),icc=makePdfPrinterProfile({colorSpace:'CMYK'}),asset='a'.repeat(64),imageBytes=await readFile(new URL('../../src/preview-assets/image.png',import.meta.url)),header={version:1,id:randomUUID(),name:'Printer condition observation',language:'en',direction:'ltr',layout:{...pdfLayoutPreset(),color:'#174070'},press:{version:2,bleedMm:3,cropMarks:true,artwork:{background:'#00ff00',image:{asset:picture.asset,crop:{x:0,y:50}},pages:'all'}},printCondition:{version:1,profile:{sha256:hash(icc),revision:'b'.repeat(64)},label:'Synthetic plumbing condition',renderingIntent:'relative-colorimetric'}},section={id:randomUUID(),title:'Measured colours',layout:null,start:null,content:'Exact measured value 0.123400',images:[{id:randomUUID(),asset,alt:'Synthetic specimen colour patch.',caption:'Retained colour patch',widthMm:30,heightMm:30,fit:'contain',crop:{x:50,y:50},position:{block:0,align:'center'}}]};
  const input=await embedPdfFonts(await compilePdfDocument(header,[section],{readImage:async()=>({asset,mime:'image/png',content:imageBytes,width:300,height:300})}));input.printCondition=structuredClone(header.printCondition);input.iccProfile=icc.toString('base64');input.bleedImage=await preparePdfBleedImage(header.press,async asset=>{expect(asset).toBe(picture.asset);return picture;});
  app=await electron.launch({args:[path.resolve('test/fixtures/pdf-renderer-app.cjs')],env});await app.evaluate(({app})=>{globalThis.printShown=0;app.on('browser-window-created',(_event,win)=>win.on('show',()=>globalThis.printShown++));});
  const render=payload=>app.evaluate(async({BrowserWindow},input)=>{const result=await(await globalThis.pdfService).renderPdfDocument(input);return {pdf:result.bytes?.toString('base64'),sha256:result.sha256,validation:result.validation,conformance:result.conformance,preflight:result.preflight,renderer:result.renderer,shown:globalThis.printShown,windows:BrowserWindow.getAllWindows().length};},payload);
  const ordinary=await render(input);expect(ordinary.preflight.status).not.toBe('fatal');expect(ordinary.conformance).toEqual([]);expect(ordinary.validation).toBeUndefined();expect(ordinary.shown).toBe(0);expect(ordinary.windows).toBe(0);expect(ordinary.renderer.recipeVersion).toBe(3);const bytes=Buffer.from(ordinary.pdf,'base64'),pdf=await inspect(bytes,icc);expect(ordinary.sha256).toBe(hash(bytes));expect(pdf.getPage(0).getTrimBox().width).toBeCloseTo(210*72/25.4,0);await writeFile(info.outputPath('colour-managed-print.pdf'),bytes);
  if(await pdfArchivalAvailable()){
   const checked=await render({...input,outputProfile:'pdfua-1'}),finalBytes=Buffer.from(checked.pdf,'base64');await inspect(finalBytes,icc);expect(validPdfAccessibilityReceipt(checked.validation)).toBe(true);expect(checked.validation.sha256).toBe(hash(finalBytes));expect(checked.validation.automatedOnly).toBe(true);expect(checked.conformance).toEqual([]);expect(checked.shown).toBe(0);expect(checked.windows).toBe(0);await writeFile(info.outputPath('colour-managed-ua1-checked.pdf'),finalBytes);
  }
 }finally{await app?.close();if(path.dirname(profile)!==parent||!path.basename(profile).startsWith('observanda-pdf-print-'))throw Error('Unexpected profile');await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

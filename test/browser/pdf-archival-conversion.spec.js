import {test,expect} from '@playwright/test';
import {PDFDocument,StandardFonts} from '@cantoo/pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {createHash,randomUUID} from 'node:crypto';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {lstat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
import {embedPdfFonts} from '../../src/pdf-font-assets.js';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {applyPdfPressGeometry} from '../../src/pdf-press-geometry.js';
import {applyPdfArchival,resolvePdfValidationRuntime} from '../../src/pdf-archival.js';
import {validPdfArchivalReceipt} from '../../src/web/pdf-archival-model.js';
async function inspect(bytes){const task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false});try{const doc=await task.promise,pages=[];for(let at=1;at<=doc.numPages;at++){const page=await doc.getPage(at),text=await page.getTextContent();pages.push({view:page.view,text:text.items.map(item=>({...item,...(item.fontName?{fontName:item.fontName.replace(/^g_d[0-9]+_/,'')}: {})})),structure:await page.getStructTree(),annotations:await page.getAnnotations()});}return {pages,outline:await doc.getOutline(),destinations:await doc.getDestinations(),metadata:Object.fromEntries((await doc.getMetadata()).metadata??[])};}finally{await task.destroy();}}
test('real archival conversion validates Unicode with veraPDF and preserves mixed tagged pages, links, notes and press geometry',async({page},info)=>{
 test.setTimeout(60000);
 const runtime=await resolvePdfValidationRuntime({directory:path.resolve('.local/pdf-validation')}),layout=pdfLayoutPreset(),header={version:1,id:randomUUID(),name:'Validated archival record',language:'en',direction:'ltr',layout},link={type:'link',attrs:{href:'https://example.org/retained',title:'',target:'_self',nofollow:false}},paragraph=n=>({type:'paragraph',content:[{type:'text',text:'Measured observation '+n+': 9007199254740993 and Norwegian \u00f8 remain searchable. '},{type:'text',text:'Retained reference',marks:[link]}]}),sections=[{id:randomUUID(),title:'Retained observations',content:{type:'doc',content:Array.from({length:45},(_,n)=>paragraph(n+1))},layout:null,start:null,notes:[{id:randomUUID(),kind:'footnote',block:2,content:'Section note: measured under repeatable conditions.'},{id:randomUUID(),kind:'endnote',block:3,content:'Endnote: retain the original evidence.'}]},{id:randomUUID(),title:'Further observations',content:{type:'doc',content:Array.from({length:15},(_,n)=>paragraph(n+46))},layout:null,start:'page'}];
 const input=await embedPdfFonts(await compilePdfDocument(header,sections));await page.setContent(input.html);await page.emulateMedia({media:'print'});await page.evaluate(()=>document.fonts.ready);const printed=await page.pdf({preferCSSPageSize:true,printBackground:true,tagged:true,outline:true}),before=await applyPdfPressGeometry(printed,{version:1,bleedMm:3,cropMarks:true}),original=Buffer.from(before),output=await applyPdfArchival(before,{runtime});
 expect(before.equals(original)).toBe(true);expect(output.bytes.subarray(0,before.length).equals(before)).toBe(true);expect(validPdfArchivalReceipt(output.validation)).toBe(true);expect(output.validation.sha256).toBe(createHash('sha256').update(output.bytes).digest('hex'));expect(output.validation.passedRules).toBeGreaterThan(100);expect(output.validation.passedChecks).toBeGreaterThan(1000);
 const a=await inspect(before),b=await inspect(output.bytes);expect(a.pages.length).toBeGreaterThan(2);expect(a.pages[0].structure).toBeTruthy();expect(a.pages[0].annotations.length).toBeGreaterThan(0);expect(b.pages).toEqual(a.pages);expect(b.outline).toEqual(a.outline);expect(b.destinations).toEqual(a.destinations);expect(b.metadata['pdfaid:part']).toBe('2');expect(b.metadata['pdfaid:conformance']).toBe('U');expect(b.pages.flatMap(row=>row.text).map(row=>row.str).join(' ')).toContain('Norwegian \u00f8');
 const plain=await PDFDocument.create(),font=await plain.embedFont(StandardFonts.Helvetica);plain.addPage().drawText('A non-embedded standard font is not PDF/A-2u.',{font});await expect(applyPdfArchival(await plain.save({useObjectStreams:false}),{runtime})).rejects.toMatchObject({code:'PDF_ARCHIVAL_FAILED'});
 // Abort only after the real validator subprocess starts, then prove its
 // temporary input is removed and a later independent validation can succeed.
 const controller=new AbortController(),spawn=childProcess.spawn;let reached=false,cancelledDirectory;childProcess.spawn=function(file,args,options){const child=spawn.call(this,file,args,options);if(args.includes('--flavour')){reached=true;cancelledDirectory=path.dirname(args.at(-1));child.once('spawn',()=>controller.abort(new Error('Stop active validator')));}return child;};syncBuiltinESMExports();
 try{await expect(applyPdfArchival(before,{runtime,signal:controller.signal})).rejects.toThrow('Stop active validator');}finally{childProcess.spawn=spawn;syncBuiltinESMExports();}
 expect(reached).toBe(true);await expect(lstat(cancelledDirectory)).rejects.toMatchObject({code:'ENOENT'});expect(validPdfArchivalReceipt((await applyPdfArchival(printed,{runtime})).validation)).toBe(true);
 await writeFile(info.outputPath('validated-pdfa-2u.pdf'),output.bytes);await writeFile(info.outputPath('validation-receipt.json'),JSON.stringify(output.validation,null,2));
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
import {PDFDocument,PDFName,PDFDict,PDFArray,PDFHexString,StandardFonts,decodePDFRawStream} from '@cantoo/pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {applyPdfPrintOutput} from '../src/pdf-print-output.js';
import {inspectPdfIcc} from '../src/pdf-print-icc.js';
import {makePdfPrinterProfile} from './fixtures/pdf-icc.js';
const name=PDFName.of,hash=v=>createHash('sha256').update(v).digest('hex');
const condition=icc=>({version:1,profile:{sha256:hash(icc),revision:'a'.repeat(64)},label:'Supplied printer condition',renderingIntent:'relative-colorimetric'});
async function fixture(extra='',glyphContent='500 0 0 0 500 700 d1 0 0 50 70 re f'){
 const pdf=await PDFDocument.create(),c=pdf.context,page=pdf.addPage([240,240]),font=await pdf.embedFont(StandardFonts.Helvetica);
 pdf.setTitle('Exact authored colour');pdf.setLanguage('en');
 const mask=c.register(c.flateStream(Uint8Array.from([128]),{Type:'XObject',Subtype:'Image',Width:1,Height:1,ColorSpace:'DeviceGray',BitsPerComponent:8}));
 const image=c.register(c.flateStream(Uint8Array.from([220,80,20]),{Type:'XObject',Subtype:'Image',Width:1,Height:1,ColorSpace:'DeviceRGB',BitsPerComponent:8,SMask:mask}));
 const form=c.register(c.flateStream('0.2 0.6 0.4 rg 0 0 20 20 re f',{Type:'XObject',Subtype:'Form',BBox:[0,0,20,20],Resources:{},Group:{S:'Transparency',CS:'DeviceRGB',I:true,K:false}}));
 const glyph=c.register(c.flateStream(glyphContent)),type3=c.register(c.obj({Type:'Font',Subtype:'Type3',FontBBox:[0,0,500,700],FontMatrix:[0.001,0,0,0.001,0,0],CharProcs:{A:glyph},Encoding:{Type:'Encoding',Differences:[65,'A']},FirstChar:65,LastChar:65,Widths:[500]}));
 page.node.set(name('Resources'),c.obj({Font:{F1:font.ref,F3:type3},XObject:{Im:image,Fm:form}}));
 page.node.set(name('Contents'),c.register(c.flateStream('q /Perceptual ri 0.4 g 10 10 20 20 re f 0.1 0.2 0.3 RG 10 50 m 50 50 l S Q\nBT /F1 12 Tf 20 200 Td (Exact authored colour) Tj ET\nq 30 0 0 30 20 120 cm /Im Do Q\nq 1 0 0 1 100 100 cm /Fm Do Q\nBT /F3 12 Tf 120 100 Td (A) Tj ET\n'+extra)));
 return Buffer.from(await pdf.save({useObjectStreams:false}));
}
function content(pdf){const raw=pdf.getPage(0).node.Contents(),values=raw instanceof PDFArray?raw.asArray():[raw];return values.map(v=>Buffer.from(decodePDFRawStream(pdf.context.lookup(v)).decode()).toString('latin1')).join('\n');}
async function text(bytes){const job=getDocument({data:Uint8Array.from(bytes),useSystemFonts:false,isEvalSupported:false,disableFontFace:true});try{const pdf=await job.promise,result=[];for(let n=1;n<=pdf.numPages;n++)result.push((await(await pdf.getPage(n)).getTextContent()).items.map(x=>x.str).join(' '));return result;}finally{await job.destroy();}}
test('print output retains exact target ICC and source text while characterizing RGB resources and transparency',async()=>{
 const icc=makePdfPrinterProfile(),source=await fixture();assert.equal(inspectPdfIcc(icc).colorSpace,'RGB');
 const result=await applyPdfPrintOutput(source,{printCondition:condition(icc),iccProfile:icc}),pdf=await PDFDocument.load(result.bytes,{updateMetadata:false}),c=pdf.context,page=pdf.getPage(0),resources=page.node.Resources(),spaces=resources.lookup(name('ColorSpace'),PDFDict),intent=c.lookup(pdf.catalog.lookup(name('OutputIntents'),PDFArray).get(0));
 assert.ok(result.bytes.subarray(0,source.length).equals(source));assert.deepEqual(await text(result.bytes),await text(source));assert.deepEqual(page.getSize(),{width:240,height:240});assert.equal(result.print.profile,'colour-managed-print');assert.equal(result.print.sha256,hash(result.bytes));assert.equal(result.print.iccSha256,hash(icc));assert.equal(result.print.checks.images,2);assert.equal(result.print.checks.transparencyGroups,2);
 assert.equal(String(spaces.lookup(name('DefaultRGB'),PDFArray).get(0)),'/ICCBased');assert.equal(String(page.node.lookup(name('Group'),PDFDict).lookup(name('CS'),PDFArray).get(0)),'/ICCBased');assert.equal(intent.lookup(name('Info')).decodeText(),'Supplied printer condition');assert.ok(Buffer.from(decodePDFRawStream(c.lookup(intent.get(name('DestOutputProfile')))).decode()).equals(icc));
 const objects=resources.lookup(name('XObject'),PDFDict),image=c.lookup(objects.get(name('Im'))),mask=c.lookup(image.dict.get(name('SMask'))),form=c.lookup(objects.get(name('Fm')));assert.equal(String(image.dict.lookup(name('ColorSpace'),PDFArray).get(0)),'/ICCBased');assert.equal(String(mask.dict.get(name('ColorSpace'))),'/DeviceGray');assert.equal(String(form.dict.lookup(name('Group'),PDFDict).get(name('I'))),'true');
 const type3=resources.lookup(name('Font'),PDFDict).lookup(name('F3'),PDFDict),glyph=c.lookup(type3.lookup(name('CharProcs'),PDFDict).get(name('A')));assert.match(Buffer.from(decodePDFRawStream(glyph).decode()).toString(),/^500 0 0 0 500 700 d1/);assert.match(content(pdf),/0.4 0.4 0.4 rg/);assert.doesNotMatch(content(pdf),/\/Perceptual ri/);assert.doesNotMatch(result.bytes.toString('latin1'),/GTS_PDFXVersion|pdfxid/);
});
test('unsupported colour and conflicting output conditions fail without returning nominal print output',async()=>{
 const icc=makePdfPrinterProfile(),options={printCondition:condition(icc),iccProfile:icc},source=await fixture();
 await assert.rejects(applyPdfPrintOutput(source,{...options,printCondition:{...options.printCondition,profile:{...options.printCondition.profile,sha256:'b'.repeat(64)}}}),{code:'PDF_PRINT_PROFILE'});
 await assert.rejects(applyPdfPrintOutput(await fixture('BI /W 1 /H 1 /CS /RGB /BPC 8 ID abc EI'),options),{code:'PDF_PRINT_COLOR'});
 await assert.rejects(applyPdfPrintOutput(await fixture('0 0 0 1 k'),options),{code:'PDF_PRINT_COLOR'});
 for(const command of ['/DeviceGray cs 0.5 sc','/DeviceCMYK CS 0 0 0 1 SC'])await assert.rejects(applyPdfPrintOutput(await fixture(command),options),{code:'PDF_PRINT_COLOR'});
 await assert.rejects(applyPdfPrintOutput(await fixture('', '500 0 d0 /Missing Do'),options),{code:'PDF_PRINT_COLOR'});
 const pdf=await PDFDocument.load(source),c=pdf.context;pdf.catalog.set(name('OutputIntents'),c.obj([{S:'GTS_PDFA1',Info:PDFHexString.fromText('Existing archive condition')}]));await assert.rejects(applyPdfPrintOutput(await pdf.save(),options),{code:'PDF_PRINT_COLOR'});
 await assert.rejects(applyPdfPrintOutput(source,{...options,maxBytes:source.length-1}),{code:'PDF_CAPACITY'});const controller=new AbortController();controller.abort(new Error('Stopped before print'));await assert.rejects(applyPdfPrintOutput(source,{...options,signal:controller.signal}),/Stopped before print/);
});
test('hidden Chromium output keeps exact text and RGB images through the independently reopened print pass',async()=>{
 const browser=await chromium.launch({headless:true});let source;try{const page=await browser.newPage();await page.setContent('<!doctype html><html lang="en"><head><title>Colour observation</title><style>@page{size:160mm 180mm;margin:16mm}body{font:14px sans-serif;color:#123456}.layer{background:rgba(220,20,50,.4);width:120px;height:80px}</style></head><body><h1>Colour observation</h1><p>Exact measured values 0.123400 and 42.</p><div class="layer"><span style="opacity:.7">Transparent text</span></div><img alt="Colour patch" width="40" height="40"></body></html>');await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=2;const context=canvas.getContext('2d');context.fillStyle='rgb(20,170,230)';context.fillRect(0,0,2,2);document.querySelector('img').src=canvas.toDataURL('image/png');});await page.locator('img').evaluate(img=>img.decode());source=await page.pdf({printBackground:true,preferCSSPageSize:true,tagged:true});}finally{await browser.close();}
 const icc=makePdfPrinterProfile({colorSpace:'CMYK'}),result=await applyPdfPrintOutput(source,{printCondition:condition(icc),iccProfile:icc}),before=await PDFDocument.load(source),after=await PDFDocument.load(result.bytes);
 assert.deepEqual(await text(result.bytes),await text(source));assert.equal(after.getPageCount(),before.getPageCount());assert.deepEqual(after.getPage(0).getSize(),before.getPage(0).getSize());assert.ok(result.print.checks.images>0);assert.ok(result.print.checks.resources>0);assert.ok(result.bytes.subarray(0,source.length).equals(source));assert.doesNotMatch(result.bytes.toString('latin1'),/GTS_PDFXVersion|pdfxid/);
});


function replaceTags(input,replacements){
 const rows=[];for(let i=0;i<input.readUInt32BE(128);i++){const at=132+12*i,key=input.toString('ascii',at,at+4);if(!Object.hasOwn(replacements,key))rows.push([key,input.subarray(input.readUInt32BE(at+4),input.readUInt32BE(at+4)+input.readUInt32BE(at+8))]);}
 rows.push(...Object.entries(replacements));let size=132+12*rows.length;for(const [,value]of rows)size=(size+value.length+3)&~3;const result=Buffer.alloc(size);input.copy(result,0,0,128);result.writeUInt32BE(size);result.writeUInt32BE(rows.length,128);let offset=132+12*rows.length;rows.forEach(([key,value],i)=>{result.write(key,132+12*i);result.writeUInt32BE(offset,136+12*i);result.writeUInt32BE(value.length,140+12*i);value.copy(result,offset);offset=(offset+value.length+3)&~3;});return result;
}
test('ICC admission checks complete parametric and multi-stage curve data rather than offsets alone',()=>{
 const original=makePdfPrinterProfile(),curves=Buffer.alloc(32+3*40);curves.write('mAB ');curves[8]=curves[9]=3;curves.writeUInt32BE(32,12);for(let i=0;i<3;i++){const at=32+40*i;curves.write('para',at);curves.writeUInt16BE(4,at+8);[1,1,0,1,0,0,0].forEach((v,n)=>curves.writeInt32BE(v*65536,at+12+4*n));}
 const valid=replaceTags(original,{A2B0:curves});assert.equal(inspectPdfIcc(valid).colorSpace,'RGB');

 const cases=[curves.subarray(0,-4)];for(const mutate of [b=>b.writeUInt16BE(5,40),b=>b[42]=1,b=>b.writeUInt32BE(32,16),b=>b.writeUInt32BE(32,24),b=>b[8]=4,b=>b.writeUInt32BE(148,12)]){const b=Buffer.from(curves);mutate(b);cases.push(b);}
 for(const value of cases)assert.throws(()=>inspectPdfIcc(replaceTags(original,{A2B0:value})),{code:'PDF_PRINT_PROFILE'});
 assert.throws(()=>inspectPdfIcc(replaceTags(original,{A2B1:curves.subarray(0,-4)})),{code:'PDF_PRINT_PROFILE'});
 const reverse=Buffer.from(curves);reverse.write('mBA ');assert.equal(inspectPdfIcc(replaceTags(original,{B2A0:reverse})).colorSpace,'RGB');assert.throws(()=>inspectPdfIcc(replaceTags(original,{B2A0:reverse.subarray(0,44)})),{code:'PDF_PRINT_PROFILE'});
});


test('Form inheritance and shared glyphs retain only proved colour and resource contexts',async()=>{
 const icc=makePdfPrinterProfile({colorSpace:'CMYK'}),options={printCondition:condition(icc),iccProfile:icc};
 for(const parentGray of [false,true]){const pdf=await PDFDocument.load(await fixture()),c=pdf.context,page=pdf.getPage(0),objects=page.node.Resources().lookup(name('XObject'),PDFDict),form=c.lookup(objects.get(name('Fm')));form.dict.lookup(name('Group'),PDFDict).delete(name('CS'));if(parentGray)page.node.set(name('Group'),c.obj({Type:'Group',S:'Transparency',CS:'DeviceGray'}));const bytes=await pdf.save({useObjectStreams:false});if(parentGray)await assert.rejects(applyPdfPrintOutput(bytes,options),{code:'PDF_PRINT_COLOR'});else{const result=await applyPdfPrintOutput(bytes,options),reopened=await PDFDocument.load(result.bytes),actual=reopened.context.lookup(reopened.getPage(0).node.Resources().lookup(name('XObject'),PDFDict).get(name('Fm')));assert.equal(String(actual.dict.lookup(name('Group'),PDFDict).lookup(name('CS'),PDFArray).get(0)),'/ICCBased');}}
 const shared=await PDFDocument.load(await fixture()),sharedContext=shared.context,firstPage=shared.getPage(0),sharedResources=firstPage.node.Resources(),sharedForm=sharedContext.lookup(sharedResources.lookup(name('XObject'),PDFDict).get(name('Fm')));sharedForm.dict.lookup(name('Group'),PDFDict).delete(name('CS'));const otherPage=shared.addPage([240,240]);otherPage.node.set(name('Resources'),sharedResources.clone(sharedContext));otherPage.node.set(name('Group'),sharedContext.obj({Type:'Group',S:'Transparency',CS:'DeviceGray'}));otherPage.node.set(name('Contents'),sharedContext.register(sharedContext.flateStream('/Fm Do')));await assert.rejects(applyPdfPrintOutput(await shared.save({useObjectStreams:false}),options),{code:'PDF_PRINT_COLOR'});
 const pdf=await PDFDocument.load(await fixture('', '500 0 d0 /Im Do')),c=pdf.context,r=pdf.getPage(0).node.Resources(),fonts=r.lookup(name('Font'),PDFDict),first=fonts.lookup(name('F3'),PDFDict),second=first.clone(c);second.set(name('CharProcs'),first.lookup(name('CharProcs'),PDFDict).clone(c));first.set(name('Resources'),c.obj({XObject:{Im:r.lookup(name('XObject'),PDFDict).get(name('Im'))}}));fonts.set(name('F4'),c.register(second));await assert.rejects(applyPdfPrintOutput(await pdf.save({useObjectStreams:false}),options),{code:'PDF_PRINT_COLOR'});
});

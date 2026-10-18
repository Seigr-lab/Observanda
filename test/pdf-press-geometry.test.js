import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName,degrees} from '@cantoo/pdf-lib';
import {validPdfPress,pdfPressDefaults,pdfPressGeometry} from '../src/web/pdf-press-model.js';
import {pdfPressFields,changePdfPress} from '../src/web/pdf-press-fields.js';
import {applyPdfPressGeometry} from '../src/pdf-press-geometry.js';
const mm=n=>n*72/25.4;
async function sample({rotate=false,cropped=false}={}){const document=await PDFDocument.create({updateMetadata:false}),page=document.addPage([300,400]);if(rotate)page.setRotation(degrees(90));if(cropped)page.setCropBox(10,10,280,380);page.drawText('Retained page');return Buffer.from(await document.save({useObjectStreams:false}));}

test('press geometry uses physical trim and optional blank bleed without scaling or moving content',()=>{
 const press=pdfPressDefaults(),trim={x:10,y:20,width:300,height:400},geometry=pdfPressGeometry(trim,press);assert.equal(validPdfPress(press),true);assert.equal(validPdfPress(null),false);assert.equal(validPdfPress(undefined),false);assert.deepEqual(geometry.trim,trim);assert.deepEqual(geometry.crop,geometry.media);assert.equal(geometry.media.width,trim.width+mm(16));assert.equal(geometry.bleed.x,trim.x-mm(3));assert.equal(geometry.marks.length,8);assert.equal(geometry.strokePt,.25);
 for(const mark of geometry.marks){for(let i=0;i<4;i+=2){assert.ok(mark[i]>=geometry.media.x&&mark[i]<=geometry.media.x+geometry.media.width);assert.ok(mark[i+1]>=geometry.media.y&&mark[i+1]<=geometry.media.y+geometry.media.height);}assert.ok(mark[0]<geometry.bleed.x||mark[0]>geometry.bleed.x+geometry.bleed.width||mark[1]<geometry.bleed.y||mark[1]>geometry.bleed.y+geometry.bleed.height);}
 assert.deepEqual(pdfPressGeometry(trim,{version:1,bleedMm:0,cropMarks:false}).media,trim);assert.equal(pdfPressGeometry(trim,{version:1,bleedMm:3,cropMarks:false}).marks.length,0);
 for(const patch of [{version:2},{bleedMm:-1},{bleedMm:21},{bleedMm:Infinity},{bleedMm:'3'},{cropMarks:1},{extra:true}])assert.equal(validPdfPress({...press,...patch}),false);assert.throws(()=>pdfPressGeometry({...trim,width:0},press),{code:'PDF_PRESS'});
});

test('press controls change selected options without replacing controls or changing finished layout',()=>{
 const header={layout:{widthMm:210,heightMm:297}},layout=structuredClone(header.layout);assert.match(pdfPressFields(header,{esc:String}),/data-pdf-press-controls disabled/);assert.equal(changePdfPress(header,{dataset:{pdfPress:'enabled'},checked:true}),true);assert.deepEqual(header.press,pdfPressDefaults());assert.equal(changePdfPress(header,{dataset:{pdfPress:'bleedMm'},value:'4.5'}),true);assert.equal(header.press.bleedMm,4.5);changePdfPress(header,{dataset:{pdfPress:'cropMarks'},checked:false});assert.equal(header.press.cropMarks,false);changePdfPress(header,{dataset:{pdfPress:'bleedMm'},value:''});assert.equal(header.press.bleedMm,4.5);assert.deepEqual(header.layout,layout);changePdfPress(header,{dataset:{pdfPress:'enabled'},checked:false});assert.equal(Object.hasOwn(header,'press'),false);assert.equal(changePdfPress(header,{dataset:{pdfPress:'unknown'}}),false);
});

test('worker expands exact boxes incrementally, preserving the caller bytes and optional no-op',async()=>{
 const bytes=await sample(),original=Buffer.from(bytes);assert.equal(await applyPdfPressGeometry(bytes,undefined),bytes);const output=await applyPdfPressGeometry(bytes,{version:1,bleedMm:2,cropMarks:false});assert.deepEqual(bytes,original);assert.deepEqual(output.subarray(0,bytes.length),bytes);const parsed=await PDFDocument.load(output,{updateMetadata:false}),page=parsed.getPage(0);assert.deepEqual(page.getTrimBox(),{x:0,y:0,width:300,height:400});assert.equal(page.getMediaBox().x,-mm(2));assert.deepEqual(page.getBleedBox(),page.getMediaBox());assert.equal(page.node.get(PDFName.Contents).toString(),(await PDFDocument.load(bytes,{updateMetadata:false})).getPage(0).node.get(PDFName.Contents).toString());
});

test('worker rejects foreign geometry and malformed input and enforces output budget',async()=>{
 for(const options of [{rotate:true},{cropped:true}])await assert.rejects(applyPdfPressGeometry(await sample(options),pdfPressDefaults()),{code:'PDF_PRESS_FAILED'});
 await assert.rejects(applyPdfPressGeometry(Buffer.from('%PDF-not-a-document'),pdfPressDefaults()),{code:'PDF_PRESS_FAILED'});const bytes=await sample();await assert.rejects(applyPdfPressGeometry(bytes,pdfPressDefaults(),{maxBytes:bytes.length}),{code:'PDF_CAPACITY'});await assert.rejects(applyPdfPressGeometry(bytes,{version:1,bleedMm:NaN,cropMarks:true}),{code:'PDF_PRESS'});
});

test('worker cancellation and deadline settle without changing or detaching caller bytes',async()=>{
 const bytes=await sample(),original=Buffer.from(bytes),pre=new AbortController();pre.abort(new Error('Stopped before parse'));await assert.rejects(applyPdfPressGeometry(bytes,pdfPressDefaults(),{signal:pre.signal}),/Stopped before parse/);
 const controller=new AbortController(),pending=applyPdfPressGeometry(bytes,pdfPressDefaults(),{signal:controller.signal});controller.abort(new Error('Stopped during worker'));await assert.rejects(pending,/Stopped during worker/);await assert.rejects(applyPdfPressGeometry(bytes,pdfPressDefaults(),{timeoutMs:1}),{code:'PDF_PRESS_FAILED'});assert.deepEqual(bytes,original);assert.ok((await applyPdfPressGeometry(bytes,pdfPressDefaults())).length>bytes.length);
});

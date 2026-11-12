import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {PDFDocument,PDFString} from '@cantoo/pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {extractPdfCompositionProof,pdfCompositionProof} from '../src/pdf-composition-proof.js';
import {pdfCompositionReportName} from '../src/web/pdf-composition-diagnostics.js';

const area={widthMm:100,heightMm:120},points=72/25.4;
async function printFixture(proof,{width=100,copies=1,text='Selected section'}={}){
 const doc=await PDFDocument.create();
 const section=doc.addPage([520,680]);section.drawText('Earlier section');
 const middle=doc.addPage([520,680]);middle.drawText(text,{x:50,y:320});
 for(let i=0;i<copies;i++){
  const annotation=doc.context.obj({Type:'Annot',Subtype:'Link',Rect:[40,50,40+width*points,50+area.heightMm*points],A:{Type:'Action',S:'URI',URI:PDFString.of(proof.url)}});
  middle.node.addAnnot(doc.context.register(annotation));
 }
 doc.addPage([520,680]).drawText('Later section');
 return doc.save();
}
test('composition proof returns only the measured content of its physical page and omits the measuring link',async()=>{
 const proof=pdfCompositionProof(randomUUID()),finding={code:'PDF_COMPOSITION_OVERFLOW',sectionId:proof.sectionId,blockId:'composition-block:0',blockIndex:0};
 const measurement=await printFixture(proof,{text:'Measurement pass'});
 const bytes=await extractPdfCompositionProof(await printFixture(proof,{copies:0}),proof,area,{measurement,findings:[finding,{...finding,sectionId:randomUUID(),blockId:'irrelevant'}]});
 const reader=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,standardFontDataUrl:fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url)).replaceAll('\\','/')});
 try{
  const doc=await reader.promise,page=await doc.getPage(1);assert.equal(doc.numPages,1);
  const view=page.getViewport({scale:1});assert.ok(Math.abs(view.width-area.widthMm*points)<.01);assert.ok(Math.abs(view.height-area.heightMm*points)<.01);
  const items=(await page.getTextContent()).items;assert.deepEqual(items.map(item=>item.str),['Selected section']);
  assert.ok(Math.abs(items[0].transform[4]-10)<.01);assert.ok(Math.abs(items[0].transform[5]-270)<.01);
  assert.equal((await page.getAnnotations()).length,0);
  const report=await doc.getAttachmentContent(pdfCompositionReportName);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(report)),[{code:'PDF_COMPOSITION_OVERFLOW',blockId:'composition-block:0',blockIndex:0}]);
 }finally{await reader.destroy();}
});
test('missing, repeated and incorrectly sized measurements cannot claim a saved page proof',async()=>{
 const proof=pdfCompositionProof(randomUUID());
 for(const options of [{copies:0},{copies:2},{width:102}])await assert.rejects(extractPdfCompositionProof(await printFixture(proof,options),proof,area),{code:'PDF_OUTPUT'});
});

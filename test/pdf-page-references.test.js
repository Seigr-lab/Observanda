import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {validPdfPageReferences,formatPdfPageReference,pdfPageReferenceMeasurementScript,pdfPageReferenceApplyScript,pdfPageReferenceCleanupScript,extractPdfPageReferences} from '../src/pdf-page-references.js';
const reference=(id='field-first',target='pdf-section-first',style='decimal',start=1)=>({id,target,style,start});

test('page-reference requests admit exact stable fields and shared targets, not executable selectors or ambiguous identities',()=>{
 assert.equal(validPdfPageReferences([]),true);assert.equal(validPdfPageReferences([reference(),reference('field-second')]),true);
 for(const refs of [null,{},[null],[{...reference(),other:true}],[{...reference(),start:0}],[{...reference(),start:10000}],[{...reference(),style:'roman'}],[{...reference(),id:'x" onclick="bad'}],[{...reference(),target:'#target'}],[reference(),reference()],[reference('same','same')],Array.from({length:12001},(_,index)=>reference('field-'+index))]){assert.equal(validPdfPageReferences(refs),false);assert.throws(()=>pdfPageReferenceMeasurementScript(refs),{code:'PDF_PAGE_REFERENCES'});}
 assert.equal(validPdfPageReferences([reference('x'.repeat(256))]),true);assert.equal(validPdfPageReferences([reference('x'.repeat(257))]),false);
 assert.throws(()=>pdfPageReferenceApplyScript([reference()],{pages:1,labels:[{...reference(),pageIndex:0,label:'2'}]}),{code:'PDF_PAGE_REFERENCES'});
});

test('measured page labels use exact counter start and CSS Roman range without invented numbering',()=>{
 assert.equal(formatPdfPageReference(0,'decimal',5),'5');assert.equal(formatPdfPageReference(7,'lower-roman',1),'viii');assert.equal(formatPdfPageReference(8,'upper-roman',1),'IX');assert.equal(formatPdfPageReference(3887,'upper-roman',1),'MMMDCCCLXXXVIII');assert.equal(formatPdfPageReference(3998,'lower-roman',1),'mmmcmxcix');assert.equal(formatPdfPageReference(3999,'upper-roman',1),'4000');assert.equal(formatPdfPageReference(100000,'decimal',9999),'109999');
 for(const args of [[-1,'decimal',1],[1.5,'decimal',1],[0,'upper-roman',0],[0,'unknown',1],[Number.MAX_SAFE_INTEGER,'decimal',1]])assert.throws(()=>formatPdfPageReference(...args),{code:'PDF_PAGE_REFERENCES'});
});

test('page-reference extraction refuses over-budget, malformed and cancelled inputs before parsing',async()=>{
 await assert.rejects(extractPdfPageReferences(Buffer.from('%PDF-fake'),[],{maxBytes:5}),{code:'PDF_CAPACITY'});await assert.rejects(extractPdfPageReferences(Buffer.from('%PDF-fake'),[],{maxBytes:64*1024*1024+1}),{code:'PDF_PAGE_REFERENCES'});await assert.rejects(extractPdfPageReferences(Buffer.from('not a PDF'),[]),{code:'PDF_PAGE_REFERENCES'});
 const controller=new AbortController();controller.abort();await assert.rejects(extractPdfPageReferences(Buffer.from('%PDF-fake'),[reference()],{signal:controller.signal}),{name:'AbortError'});
});

test('actual PDF annotation measurements produce exact second-pass page labels without temporary links, page changes or ambiguous pairing',{timeout:60000},async()=>{
 const primary=[reference('field-decimal','pdf-section-second','decimal',5),reference('field-lower','pdf-section-third','lower-roman',5),reference('field-upper','pdf-section-third','upper-roman',5),reference('field-first','pdf-section-first')],refs=[...primary,...Array.from({length:60},(_,index)=>reference('extra-'+index,'pdf-section-second','decimal',5))],html='<!doctype html><html><head><style>@page{size:A5;margin:10mm}body{margin:0;font:12pt sans-serif}.page{break-after:page}.page:last-child{break-after:auto}.page-field{display:inline-block;width:16ch;height:1.4em;line-height:1.4em;white-space:nowrap;font:12pt monospace}</style></head><body><section class="page" id="pdf-section-first"><h1>Contents</h1>'+primary.map(ref=>'<p>'+ref.id+' <span class="page-field" id="'+ref.id+'">0</span></p>').join('')+'<div style="font:2pt monospace">'+refs.slice(primary.length).map(ref=>'<span class="page-field" style="font:2pt monospace" id="'+ref.id+'">0</span>').join('')+'</div></section><section class="page" id="pdf-section-second"><h1>Measured table</h1><table><caption>Dataset caption</caption><tbody><tr><td>9007199254740993</td></tr></tbody></table></section><section class="page" id="pdf-section-third"><h1>Optical figure</h1><figure><figcaption>Retained caption</figcaption></figure></section></body></html>';
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();await page.route('**/*',route=>route.abort());await page.emulateMedia({media:'print'});await page.setContent(html);await page.evaluate(()=>document.fonts.ready);assert.deepEqual(await page.evaluate(pdfPageReferenceMeasurementScript(refs)),{references:refs.length});
  const first=await page.pdf({preferCSSPageSize:true,printBackground:true,tagged:true,outline:true}),original=Buffer.from(first),measurement=await extractPdfPageReferences(first,refs);assert.deepEqual(first,original);assert.deepEqual(measurement,{pages:3,labels:[{id:'field-decimal',target:'pdf-section-second',pageIndex:1,label:'6'},{id:'field-lower',target:'pdf-section-third',pageIndex:2,label:'vii'},{id:'field-upper',target:'pdf-section-third',pageIndex:2,label:'VII'},{id:'field-first',target:'pdf-section-first',pageIndex:0,label:'1'},...refs.slice(primary.length).map(ref=>({id:ref.id,target:ref.target,pageIndex:1,label:'6'}))]});
  const library=await import('pdfjs-dist/legacy/build/pdf.mjs'),firstTask=library.getDocument({data:new Uint8Array(first),isEvalSupported:false});try{assert.equal((await firstTask.promise).numPages,5);}finally{await firstTask.destroy();}
  assert.deepEqual(await page.evaluate(pdfPageReferenceApplyScript(refs,measurement)),{references:refs.length});assert.equal(await page.locator('#pdf-reference-measurement,#pdf-reference-measurement-style').count(),0);assert.deepEqual(await page.locator('.page-field').allTextContents(),['6','vii','VII','1',...refs.slice(primary.length).map(()=> '6')]);assert.equal(await page.locator('a').count(),0);
  const second=await page.pdf({preferCSSPageSize:true,printBackground:true,tagged:true,outline:true}),task=library.getDocument({data:new Uint8Array(second),isEvalSupported:false,disableFontFace:true,useSystemFonts:false,useWasm:false,useWorkerFetch:false,isOffscreenCanvasSupported:false}),document=await task.promise;
  try{
   assert.equal(document.numPages,measurement.pages);const text=[],annotations=[];for(let index=1;index<=document.numPages;index++){const actual=await document.getPage(index),content=await actual.getTextContent();text.push(content.items.map(item=>item.str??'').join(' ').replace(/\s+/g,' '));annotations.push(...await actual.getAnnotations());actual.cleanup();}
   assert.match(text[0],/field-decimal 6/);assert.match(text[0],/field-lower vii/);assert.match(text[0],/field-upper VII/);assert.match(text[0],/field-first 1/);assert.match(text[1],/9007199254740993/);assert.match(text[2],/Retained caption/);assert.doesNotMatch(text.join(' '),/Marker|Destination|pdf-reference/);assert.equal(annotations.length,0);
  }finally{await task.destroy();}
  assert.deepEqual(await extractPdfPageReferences(second,[]),{pages:3,labels:[]});
  // A duplicate same-row destination must not be guessed from array order.
  await page.setContent(html);await page.evaluate(pdfPageReferenceMeasurementScript(refs));await page.evaluate(()=>{const row=document.querySelector('#pdf-reference-measurement>div');row.append(row.lastElementChild.cloneNode(true));});const ambiguous=await page.pdf({preferCSSPageSize:true,printBackground:true});await assert.rejects(extractPdfPageReferences(ambiguous,refs),{code:'PDF_PAGE_REFERENCES'});await page.evaluate(pdfPageReferenceCleanupScript);assert.equal(await page.locator('#pdf-reference-measurement,#pdf-reference-measurement-style').count(),0);assert.deepEqual(await page.locator('.page-field').allTextContents(),Array(refs.length).fill('0'));
  await page.setContent(html.replace('id="pdf-section-third"','id="missing-target"'));await assert.rejects(page.evaluate(pdfPageReferenceMeasurementScript(refs)),/PDF_PAGE_REFERENCES/);assert.equal(await page.locator('#pdf-reference-measurement').count(),0);
  await page.setContent(html);assert.deepEqual(await page.evaluate(pdfPageReferenceMeasurementScript([])),{references:0});assert.equal(await page.locator('#pdf-reference-measurement').count(),0);
 }finally{await browser.close();}
});

import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {getDocument,version as readerVersion} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {PDFDocument,PDFName,PDFArray,PDFDict,PDFRawStream,decodePDFRawStream} from '@cantoo/pdf-lib';
import {compilePdfDocument} from '../../src/pdf-document-renderer.js';
import {embedPdfFonts} from '../../src/pdf-font-assets.js';
import {createFont} from '../../src/font-parser.js';
import {pdfArchivalAvailable} from '../../src/pdf-archival.js';
import {validPdfOutputValidation} from '../../src/web/pdf-output-validation-model.js';
import {PDF_COMPOSITION_TOLERANCE_MM} from '../../src/pdf-composition-proof.js';
import {referenceHash,referenceProfiles,referencePublication} from '../fixtures/pdf-reference-publication.js';

function embeddedFonts(html){
 const fonts=new Map();
 for(const match of html.matchAll(/url\(["']?data:font\/[\w+-]+;base64,([A-Za-z0-9+/=]+)["']?\)/g)){
  const bytes=Buffer.from(match[1],'base64'),sha256=referenceHash(bytes);
  if(!fonts.has(sha256)){
   const font=createFont(bytes);
   fonts.set(sha256,{face:font.postscriptName,version:font.version,sha256});
  }
 }
 return [...fonts.values()];
}
async function independentlyRead(bytes,source){
 const task=getDocument({data:Uint8Array.from(bytes),isEvalSupported:false,useSystemFonts:false});
 try{
  const doc=await task.promise,pages=[],roles=new Set(),alternatives=new Set(),numeric=[];let hasRtl=false;
  for(let number=1;number<=doc.numPages;number++){
   const page=await doc.getPage(number),items=(await page.getTextContent()).items;
   if(items.some(item=>item.dir==='rtl'))hasRtl=true;
   const text=items.map(item=>item.str??'').join(' ').replace(/\s+/g,' ').trim();
   const pending=[await page.getStructTree()];
   while(pending.length){const node=pending.pop();if(!node)continue;if(node.role)roles.add(node.role);if(node.alt)alternatives.add(node.alt);pending.push(...(node.children??[]));}
   const trials=[...text.matchAll(/TRIAL-\d{3}/g)].map(item=>item[0]);
   if(trials.length){expect(text).toContain('Trial identifier');expect(text).toContain('Exact reading');}
   numeric.push(...text.match(/9007199254740993\.\d{3}/g)??[]);
   pages.push({number,trials,text,links:(await page.getAnnotations()).filter(link=>link.subtype==='Link').map(link=>link.dest)});
   page.cleanup();
  }
  const all=pages.map(page=>page.text).join(' ');
  expect(pages.filter(page=>page.trials.length).length).toBeGreaterThan(1);
  expect(pages.flatMap(page=>page.trials)).toEqual(source.rows.map(row=>row[0]));
  expect(numeric).toEqual(source.rows.map(row=>row[2]));
  expect(all).toContain('reading := sample(channel, time)');expect(all).toContain('Change in instrument reading');
  expect(all).toContain('The reference instrument was checked before the first reading.');
  expect(all).toContain('Måling');expect(hasRtl).toBe(true);
  expect(all).toContain(source.sections[0].content.content[2].content[1].text);
  expect(alternatives).toContain(source.sections[0].images[0].alt);
  expect(alternatives).toContain('Change in instrument reading. r = b - a');
  expect([...roles]).toEqual(expect.arrayContaining(['Figure','Table','TH','TD']));
  const links=pages.flatMap(page=>page.links).filter(id=>typeof id==='string');
  const target=links.find(id=>id.includes(source.sections[1].content.content[1].attrs.id));
  expect(target).toBeTruthy();const destination=await doc.getDestination(target);
  expect(pages[await doc.getPageIndex(destination[0])].trials.length).toBeGreaterThan(0);
  return {reader:'PDF.js',readerVersion,pages:pages.length,tablePages:pages.filter(p=>p.trials.length).map(p=>p.number),exactRows:numeric.length,hasRtl,roles:[...roles].sort(),alternatives:[...alternatives]};
 }finally{await task.destroy();}
}

const cases=referenceProfiles.map(profile=>({profile,decomposedArabic:false}));
cases.push(...['pdfa-2u','pdfua-1'].map(profile=>({profile,decomposedArabic:true})));
cases.push(...['pdfa-2u','pdfua-1'].map(profile=>({profile,arabicFont:'scheherazade-new'})));
for(const {profile,decomposedArabic,arabicFont} of cases)test('reference publication through '+profile+(decomposedArabic?' explains an unmapped component glyph':arabicFont?' retains exact Arabic in the selected alternate face':''),async({},info)=>{
 test.setTimeout(150000);
 if(profile.startsWith('pdf'))test.skip(!await pdfArchivalAvailable(),'The pinned offline validator is required for this profile.');
 const source=referencePublication(profile,{decomposedArabic,arabicFont}),{header,sections,pixels,icc}=source;
 const compiled=await compilePdfDocument(header,sections,{readImage:async asset=>{expect(asset).toBe(pixels.asset);return pixels;}});
 const input=await embedPdfFonts(compiled);
 if(icc){input.printCondition=header.printCondition;input.iccProfile=icc.toString('base64');}
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-reference-pdf-')),env={...process.env,OBSERVANDA_PDF_TEST_PROFILE:directory};
 delete env.ELECTRON_RUN_AS_NODE;let app;
 try{
  app=await electron.launch({args:[path.resolve('test/fixtures/pdf-renderer-app.cjs')],env});
  const rendered=app.evaluate(async(_,input)=>{
   const result=await(await globalThis.pdfService).renderPdfDocument(input);
   return {...result,bytes:result.bytes?.toString('base64')??null};
  },input);
  if(decomposedArabic){
   await expect(rendered).rejects.toThrow('PDF_UNMAPPED_GLYPH');
   return;
  }
  const output=await rendered;
  expect(output.preflight.status).not.toBe('fatal');const bytes=Buffer.from(output.bytes,'base64');
  expect(referenceHash(bytes)).toBe(output.sha256);
  if(profile.startsWith('pdf')){expect(validPdfOutputValidation(output.validation)).toBe(true);expect(output.validation.profile).toBe(profile);expect(output.validation.sha256).toBe(output.sha256);}
  else expect(output.validation).toBeUndefined();
  const structure=await independentlyRead(bytes,source);
  const pdf=await PDFDocument.load(bytes,{updateMetadata:false});
  const colourImage=pdf.context.enumerateIndirectObjects().map(([,value])=>value).find(value=>value instanceof PDFRawStream&&value.dict.has(PDFName.of('SMask')));
  expect(colourImage).toBeTruthy();
  const mask=colourImage.dict.lookup(PDFName.of('SMask'),PDFRawStream),opacity=decodePDFRawStream(mask).decode();
  expect(opacity).toHaveLength(pixels.width*pixels.height);expect(opacity[0]).toBe(0);expect(opacity.at(-1)).toBe(255);
  expect(opacity[pixels.width*50]).toBeGreaterThan(100);expect(opacity[pixels.width*50]).toBeLessThan(155);
  if(icc){
   const name=PDFName.of,intents=pdf.catalog.lookup(name('OutputIntents'),PDFArray),intent=pdf.context.lookup(intents.get(0),PDFDict);
   expect(referenceHash(decodePDFRawStream(pdf.context.lookup(intent.get(name('DestOutputProfile')))).decode())).toBe(header.printCondition.profile.sha256);
   for(const page of pdf.getPages()){
    const trim=page.getTrimBox();expect(page.getMediaBox().width).toBeGreaterThan(trim.width);
    for(const [actual,expected] of [[trim.width,header.layout.widthMm],[trim.height,header.layout.heightMm]])expect(Math.abs(actual*25.4/72-expected)).toBeLessThanOrEqual(PDF_COMPOSITION_TOLERANCE_MM);
   }
  }
  const manifest={version:1,fixture:'test/fixtures/pdf-reference-publication.js',profile,sourceSha256:referenceHash(JSON.stringify({header,sections})),rendererInputSha256:referenceHash(JSON.stringify(input)),imageSha256:pixels.asset,iccSha256:icc?referenceHash(icc):null,
   fonts:embeddedFonts(input.html),renderer:output.renderer,outputSha256:output.sha256,validation:output.validation??null,preflight:output.preflight,structure,
   imageOpacity:{width:pixels.width,height:pixels.height,sha256:referenceHash(opacity)},geometryToleranceMm:PDF_COMPOSITION_TOLERANCE_MM};
  expect(manifest.fonts.length).toBeGreaterThan(0);
  await writeFile(info.outputPath(profile+'.pdf'),bytes);
  await writeFile(info.outputPath(profile+'.json'),JSON.stringify(manifest,null,2)+'\n');
 }finally{
  await app?.close();if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-reference-pdf-'))throw Error('Unexpected profile');
  await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
});

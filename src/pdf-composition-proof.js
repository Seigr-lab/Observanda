import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {compositionDiagnostics,pdfCompositionReportName} from './web/pdf-composition-diagnostics.js';

const pointsPerMm=72/25.4;
export const PDF_COMPOSITION_TOLERANCE_MM=.5;

export function pdfCompositionProof(sectionId){
 if(!researchId(sectionId))throw new AppError('INVALID');
 const url='https://pdf-layout.invalid/'+randomUUID();
 return {sectionId,url};
}

// A transparent link records the actual print transform, including crop and
// facing-page offsets. Its random address is never fetched or shipped in an edition.
export function pdfCompositionMarker(proof){
 if(!proof)return '';
 if(!/^https:\/\/pdf-layout\.invalid\/[a-f0-9-]{36}$/.test(proof.url))throw new AppError('INVALID');
 return '<a aria-hidden="true" tabindex="-1" href="'+proof.url+'" style="position:absolute;inset:0;display:block;font-size:0;color:transparent;text-decoration:none">&#160;</a>';
}

export async function renderPdfCompositionProof(compiled,proof,area,{render,signal}){
 let measurement,edition=compiled;
 // Conformance validators must see exactly the edition the author downloads.
 // Measure the same layout before finalizing the clean, profiled edition.
 if(compiled.outputProfile||compiled.printCondition){
  const {outputProfile,printCondition,iccProfile,...layout}=compiled;
  const measured=await render(layout);
  if(!measured.bytes||measured.preflight?.status==='fatal')return {bytes:null,preflight:measured.preflight};
  measurement=measured.bytes;edition={...compiled,html:compiled.html.replace(pdfCompositionMarker(proof),'')};
 }
 const {bytes,preflight}=await render(edition);
 if(!bytes||preflight?.status==='fatal')return {bytes:null,preflight};
 return {bytes:await extractPdfCompositionProof(bytes,proof,area,{signal,findings:preflight?.findings,measurement}),preflight};
}

// Return only the one measured content area. Unrelated pages, links and print
// metadata do not belong in the editor proof.
export async function extractPdfCompositionProof(bytes,proof,area,{signal,findings=[],measurement=bytes}={}){
 const invalid=()=>{throw new AppError('PDF_OUTPUT');};
 signal?.throwIfAborted();
 const {PDFArray,PDFDict,PDFDocument,PDFHexString,PDFName,PDFString}=await import('@cantoo/pdf-lib'),name=PDFName.of;
 for(const value of [bytes,measurement])if(!(value instanceof Uint8Array)||value.byteLength>64*1024*1024)throw new AppError('PDF_CAPACITY');
 const source=await PDFDocument.load(measurement,{updateMetadata:false});
 let selected=null,viewport=null;
 for(const page of source.getPages()){
  signal?.throwIfAborted();
  const annotations=page.node.Annots();
  if(!annotations)continue;
  for(let at=0;at<annotations.size();at++){
   const annotation=annotations.lookup(at,PDFDict),action=annotation.lookupMaybe(name('A'),PDFDict);
   if(action?.get(name('S'))!==name('URI'))continue;
   const uri=action.lookup(name('URI'));
   if(!(uri instanceof PDFString||uri instanceof PDFHexString)||uri.decodeText()!==proof.url)continue;
   const rect=annotation.lookupMaybe(name('Rect'),PDFArray)?.asRectangle();
   if(selected||!rect||page.getRotation().angle!==0||!Object.values(rect).every(Number.isFinite)||
    Math.abs(rect.width/pointsPerMm-area.widthMm)>PDF_COMPOSITION_TOLERANCE_MM||Math.abs(rect.height/pointsPerMm-area.heightMm)>PDF_COMPOSITION_TOLERANCE_MM)invalid();
   viewport=rect;selected=page;
  }
 }
 if(!selected)invalid();
 if(measurement!==bytes){
  const printed=await PDFDocument.load(bytes,{updateMetadata:false}),index=source.getPages().indexOf(selected);
  if(printed.getPageCount()!==source.getPageCount())invalid();
  const actual=printed.getPage(index),expected=selected.getMediaBox(),media=actual.getMediaBox();
  if(actual.getRotation().angle!==0||Object.keys(expected).some(key=>Math.abs(media[key]-expected[key])>.01))invalid();
  selected=actual;
 }
 const result=await PDFDocument.create({updateMetadata:false}),{x,y,width,height}=viewport;
 const output=result.addPage([width,height]);
 if(selected.node.Contents()){
  const region=await result.embedPage(selected,{left:x,bottom:y,right:x+width,top:y+height});output.drawPage(region,{x:0,y:0});
 }
 const diagnostics=compositionDiagnostics(findings,proof.sectionId);
 await result.attach(Buffer.from(JSON.stringify(diagnostics)),pdfCompositionReportName,{mimeType:'application/json'});
 signal?.throwIfAborted();
 const outputBytes=await result.save();signal?.throwIfAborted();
 if(outputBytes.byteLength>64*1024*1024)throw new AppError('PDF_CAPACITY');
 return Buffer.from(outputBytes);
}

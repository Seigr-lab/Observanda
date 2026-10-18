import {parentPort,workerData} from 'node:worker_threads';
import {PDFDocument,PDFName,PDFArray} from '@cantoo/pdf-lib';
import {validPdfPress,pdfPressGeometry} from './web/pdf-press-model.js';
const fail=code=>Object.assign(new Error(code),{code});
async function apply(){
 const {bytes,press,maxBytes}=workerData;
 if(!validPdfPress(press)||!(bytes instanceof Uint8Array)||bytes.byteLength>maxBytes)throw fail('PDF_PRESS_FAILED');
 const document=await PDFDocument.load(bytes,{forIncrementalUpdate:true,updateMetadata:false,throwOnInvalidObject:true});
 if(!document.getPageCount())throw fail('PDF_PRESS_FAILED');
 for(const page of document.getPages()){
  const trim=page.getMediaBox(),crop=page.getCropBox(),unit=page.node.lookup(PDFName.of('UserUnit'));
  // This boundary accepts the application's generated, unrotated pages. Do not
  // expose previously cropped content or reinterpret a foreign coordinate unit.
  if(page.getRotation().angle!==0||(unit&&unit.asNumber?.()!==1)||Object.keys(trim).some(key=>trim[key]!==crop[key]))throw fail('PDF_PRESS_FAILED');
  const geometry=pdfPressGeometry(trim,press),set=(method,box)=>page[method](box.x,box.y,box.width,box.height);
  set('setTrimBox',geometry.trim);set('setBleedBox',geometry.bleed);set('setMediaBox',geometry.media);set('setCropBox',geometry.crop);
  if(geometry.marks.length){
   const raw=page.node.get(PDFName.Contents),stored=document.context.lookup(raw),previous=stored instanceof PDFArray?Array.from({length:stored.size()},(_,i)=>stored.get(i)):raw?[raw]:[];
   // Separate wrapper streams preserve every original stream and reset its
   // graphics state. Crop marks are artifacts, outside the logical tag tree.
   const marks='Q\n/Artifact BMC\nq\n0 G '+geometry.strokePt+' w 0 J [] 0 d\n'+geometry.marks.map(([x1,y1,x2,y2])=>x1+' '+y1+' m '+x2+' '+y2+' l S').join('\n')+'\nQ\nEMC\n';
   page.node.set(PDFName.Contents,document.context.obj([document.context.register(document.context.stream('q\n')),...previous,document.context.register(document.context.stream(marks))]));
  }
 }
 const output=await document.save({useObjectStreams:false,addDefaultPage:false,updateFieldAppearances:false});
 if(output.byteLength>maxBytes)throw fail('PDF_CAPACITY');
 // Never silently fall back to a rewritten document if the dependency changes.
 if(output.byteLength<=bytes.byteLength||!Buffer.from(output.buffer,output.byteOffset,bytes.byteLength).equals(Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength)))throw fail('PDF_PRESS_FAILED');
 return output;
}
try{const bytes=await apply();parentPort.postMessage({bytes},[bytes.buffer]);}catch(error){parentPort.postMessage({error:error?.code==='PDF_CAPACITY'?'PDF_CAPACITY':'PDF_PRESS_FAILED'});}

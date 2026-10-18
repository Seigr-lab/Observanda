import {parentPort,workerData} from 'node:worker_threads';
import {PDFDocument,PDFName,PDFArray,PDFDict} from '@cantoo/pdf-lib';
import {validPdfPress,pdfPressGeometry} from './web/pdf-press-model.js';
import {pdfBleedPage,pdfBleedImageBox} from './web/pdf-bleed-model.js';
import {pdfBleedImageBytes} from './pdf-bleed-artwork.js';
const fail=code=>Object.assign(new Error(code),{code});
async function apply(){
 const {bytes,press,maxBytes,bleedImage}=workerData;
 if(!validPdfPress(press)||!(bytes instanceof Uint8Array)||bytes.byteLength>maxBytes)throw fail('PDF_PRESS_FAILED');
 const document=await PDFDocument.load(bytes,{forIncrementalUpdate:true,updateMetadata:false,throwOnInvalidObject:true});
 if(!document.getPageCount())throw fail('PDF_PRESS_FAILED');
 const imageBytes=pdfBleedImageBytes(press,bleedImage),image=imageBytes?await document.embedPng(imageBytes):null;
 for(const [pageIndex,page] of document.getPages().entries()){
  const trim=page.getMediaBox(),crop=page.getCropBox(),unit=page.node.lookup(PDFName.of('UserUnit'));
  // This boundary accepts the application's generated, unrotated pages. Do not
  // expose previously cropped content or reinterpret a foreign coordinate unit.
  if(page.getRotation().angle!==0||(unit&&unit.asNumber?.()!==1)||Object.keys(trim).some(key=>trim[key]!==crop[key]))throw fail('PDF_PRESS_FAILED');
  const geometry=pdfPressGeometry(trim,press),set=(method,box)=>page[method](box.x,box.y,box.width,box.height);
  set('setTrimBox',geometry.trim);set('setBleedBox',geometry.bleed);set('setMediaBox',geometry.media);set('setCropBox',geometry.crop);
  const artwork=press.version===2&&pdfBleedPage(press.artwork,pageIndex)?press.artwork:null;
  if(geometry.marks.length||artwork){
   const raw=page.node.get(PDFName.Contents),stored=document.context.lookup(raw),previous=stored instanceof PDFArray?Array.from({length:stored.size()},(_,i)=>stored.get(i)):raw?[raw]:[],before=[];
   if(artwork){
    const box=geometry.bleed,rgb=[1,3,5].map(at=>parseInt(artwork.background.slice(at,at+2),16)/255);
    let stream='/Artifact BMC\nq\n'+[box.x,box.y,box.width,box.height].join(' ')+' re W n\n'+rgb.join(' ')+' rg\n'+[box.x,box.y,box.width,box.height].join(' ')+' re f\n';
    if(image){
     // Resources may be inherited/shared. Clone both dictionaries so adding a
     // decorative XObject cannot change any other page's resource bindings.
     const resources=page.node.Resources()?.clone(document.context)??document.context.obj({}),old=resources.lookupMaybe(PDFName.of('XObject'),PDFDict),objects=old?.clone(document.context)??document.context.obj({});
     let label='ObservandaBleedArtwork',number=0;while(objects.has(PDFName.of(label)))label='ObservandaBleedArtwork'+(++number);
     const name=PDFName.of(label);objects.set(name,image.ref);resources.set(PDFName.of('XObject'),objects);page.node.set(PDFName.of('Resources'),resources);
     const placed=pdfBleedImageBox(box,bleedImage,artwork.image.crop);stream+=[placed.width,0,0,placed.height,placed.x,placed.y].join(' ')+' cm\n'+name.toString()+' Do\n';
    }
    stream+='Q\nEMC\n';before.push(document.context.register(document.context.stream(stream)));
   }
   const marks=geometry.marks.length?'/Artifact BMC\nq\n0 G '+geometry.strokePt+' w 0 J [] 0 d\n'+geometry.marks.map(([x1,y1,x2,y2])=>x1+' '+y1+' m '+x2+' '+y2+' l S').join('\n')+'\nQ\nEMC\n':'';
   page.node.set(PDFName.Contents,document.context.obj([...before,document.context.register(document.context.stream('q\n')),...previous,document.context.register(document.context.stream('Q\n'+marks))]));
  }
 }
 const output=await document.save({useObjectStreams:false,addDefaultPage:false,updateFieldAppearances:false});
 if(output.byteLength>maxBytes)throw fail('PDF_CAPACITY');
 // Never silently fall back to a rewritten document if the dependency changes.
 if(output.byteLength<=bytes.byteLength||!Buffer.from(output.buffer,output.byteOffset,bytes.byteLength).equals(Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength)))throw fail('PDF_PRESS_FAILED');
 return output;
}
try{const bytes=await apply();parentPort.postMessage({bytes},[bytes.buffer]);}catch(error){parentPort.postMessage({error:error?.code==='PDF_CAPACITY'?'PDF_CAPACITY':'PDF_PRESS_FAILED'});}

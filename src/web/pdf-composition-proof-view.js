import {loadPdfPreview} from './pdf-page-navigator.js';
import {compositionDiagnostics,pdfCompositionReportName} from './pdf-composition-diagnostics.js';

// Keep just the rendered content area for the current saved revision. An edit,
// a withdrawn source or a switch of owner invalidates the pixels immediately.
export function pdfCompositionProofView({request,changed}){
 let identity=null,abort=null,timer=null,task=null,render=null,image=null,error=null,phase='off',findings=[];
 function clear(){
  clearTimeout(timer);timer=null;identity=null;abort?.abort();abort=null;
  render?.cancel();render=null;if(task)void task.destroy().catch(()=>{});task=null;
  if(image){image.hidden=true;image.width=0;image=null;}error=null;phase='off';findings=[];
 }
 function update(pin){
  if(!pin){clear();return;}
  const key=[pin.id,pin.revision,pin.sectionId].join(':');
  if(identity===key)return;clear();identity=key;phase='pending';
  const owner=new AbortController();abort=owner;const {signal}=owner;
  timer=setTimeout(async()=>{
   let localTask;
   try{
    const blob=await request(pin,signal);signal.throwIfAborted();
    localTask=await loadPdfPreview(blob,signal);
    if(signal.aborted){await localTask.destroy();return;}task=localTask;
    const pdf=await localTask.promise;signal.throwIfAborted();if(pdf.numPages!==1)throw Error();
    const report=await pdf.getAttachmentContent(pdfCompositionReportName);
    if(!report||report.length>256*1024)throw Error();
    const diagnostics=JSON.parse(new TextDecoder().decode(report));
    if(!Array.isArray(diagnostics)||diagnostics.length>256)throw Error();
    const page=await pdf.getPage(1);signal.throwIfAborted();
    const base=page.getViewport({scale:1});
    const viewport=page.getViewport({scale:Math.min(2,2048/Math.max(base.width,base.height))});
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    const painting=page.render({canvas,viewport,annotationMode:0});render=painting;
    await painting.promise;signal.throwIfAborted();
    canvas.dataset.pdfCompositionProof='';canvas.setAttribute('aria-hidden','true');image=canvas;findings=diagnostics;phase='ready';
   }catch(reason){if(!signal.aborted){
    phase='failed';error=reason?.message||null;
    if(reason?.code==='PDF_GLYPH'&&Array.isArray(reason.details))findings=compositionDiagnostics(reason.details.filter(row=>row?.code==='PDF_GLYPH'),pin.sectionId);
   }}
   finally{
    if(task===localTask&&task){task=null;await localTask.destroy().catch(()=>{});}
    if(!signal.aborted){render=null;changed();}
   }
  },650);
 }
 function bind(host){
  const canvas=host.querySelector('[data-pdf-composition-proof]');if(!canvas)return;
  if(image&&image!==canvas)canvas.replaceWith(image);
  (image??canvas).hidden=phase!=='ready';
 }
 return {update,bind,clear,state:()=>({phase,error,findings})};
}

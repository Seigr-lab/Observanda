import {renderPdfDocument,pdfOutputCapabilities} from './pdf-renderer.js';
export function attachPdfService(child){
 let active=null;
 const send=value=>{if(child.connected)child.send(value);};
 const receive=async message=>{
  if(message?.type==='pdf-capabilities'&&Number.isSafeInteger(message.id)){let capabilities;try{capabilities=await pdfOutputCapabilities();}catch{capabilities={archival:false};}send({type:'pdf-capabilities-result',id:message.id,...capabilities});return;}
  if(message?.type==='pdf-cancel'){if(active?.id===message.id)active.controller.abort();return;}
  if(message?.type!=='pdf-render'||!Number.isSafeInteger(message.id))return;
  if(active){send({type:'pdf-result',id:message.id,error:'PDF_BUSY'});return;}
  const request={id:message.id,controller:new AbortController()};active=request;
  try{const result=await renderPdfDocument(message.input,{signal:request.controller.signal});send({type:'pdf-result',id:message.id,bytes:result.bytes===null?null:result.bytes.toString('base64'),renderer:result.renderer,sha256:result.sha256,preflight:result.preflight,...(result.validation?{validation:result.validation}:{})});}
  catch(error){send({type:'pdf-result',id:message.id,error:request.controller.signal.aborted?'PDF_CANCELLED':['PDF_BUSY','PDF_TIMEOUT','PDF_CAPACITY','PDF_INPUT','PDF_OUTPUT','PDF_PAGE_REFERENCES','PDF_IMAGE_RESOLUTION_FAILED','PDF_FOOTNOTE_LAYOUT','PDF_FOOTNOTE_OVERFLOW','PDF_PRESS','PDF_PRESS_FAILED','PDF_ARCHIVAL_UNAVAILABLE','PDF_ARCHIVAL_FAILED','PDF_ACCESSIBILITY_FAILED','PDF_ACCESSIBILITY_UNAVAILABLE'].includes(error.code)?error.code:'PDF_OUTPUT'});}
  finally{if(active===request)active=null;}
 };
 const close=()=>{active?.controller.abort();child.off('message',receive);child.off('exit',close);};child.on('message',receive);child.on('exit',close);return close;
}

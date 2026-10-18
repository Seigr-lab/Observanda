import {renderPdfDocument} from './pdf-renderer.js';
export function attachPdfService(child){
 let active=null;
 const send=value=>{if(child.connected)child.send(value);};
 const receive=async message=>{
  if(message?.type==='pdf-cancel'){if(active?.id===message.id)active.controller.abort();return;}
  if(message?.type!=='pdf-render'||!Number.isSafeInteger(message.id))return;
  if(active){send({type:'pdf-result',id:message.id,error:'PDF_BUSY'});return;}
  const request={id:message.id,controller:new AbortController()};active=request;
  try{const result=await renderPdfDocument(message.input,{signal:request.controller.signal});send({type:'pdf-result',id:message.id,bytes:result.bytes.toString('base64'),renderer:result.renderer,sha256:result.sha256});}
  catch(error){send({type:'pdf-result',id:message.id,error:request.controller.signal.aborted?'PDF_CANCELLED':['PDF_BUSY','PDF_TIMEOUT','PDF_CAPACITY','PDF_INPUT','PDF_OUTPUT'].includes(error.code)?error.code:'PDF_OUTPUT'});}
  finally{if(active===request)active=null;}
 };
 const close=()=>{active?.controller.abort();child.off('message',receive);child.off('exit',close);};child.on('message',receive);child.on('exit',close);return close;
}

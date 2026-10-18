import {AppError} from './errors.js';
import {validPdfPreflight} from './pdf-preflight.js';
// The bridge lifetime belongs to the desktop service. Cancellation and service
// shutdown discard the in-memory render; neither process writes a PDF file.
export function pdfRenderBridge(channel){
 const pending=new Map();let next=0,closed=false;
 const send=value=>{if(!closed&&channel.connected)channel.send(value);};
 const receive=message=>{if(message?.type!=='pdf-result')return;const entry=pending.get(message.id);if(!entry)return;entry.finish();
  if(message.error){entry.reject(new AppError(message.error));return;}
  if(!validPdfPreflight(message.preflight)){entry.reject(new AppError('PDF_OUTPUT'));return;}
  if(message.bytes===null){if(message.sha256!==null||!entry.preflightOnly&&message.preflight.status!=='fatal'){entry.reject(new AppError('PDF_OUTPUT'));return;}entry.resolve({bytes:null,renderer:message.renderer,sha256:null,conformance:[],preflight:message.preflight});return;}
  if(message.preflight.status==='fatal'||entry.preflightOnly){entry.reject(new AppError('PDF_OUTPUT'));return;}
  if(typeof message.bytes!=='string'||message.bytes.length>90*1024*1024){entry.reject(new AppError('PDF_OUTPUT'));return;}
  const bytes=Buffer.from(message.bytes,'base64');if(bytes.subarray(0,5).toString()!=='%PDF-'){entry.reject(new AppError('PDF_OUTPUT'));return;}
  entry.resolve({bytes,renderer:message.renderer,sha256:message.sha256,conformance:[],preflight:message.preflight});
 };
 channel.on('message',receive);
 return {render(input,{signal}={}){
  signal?.throwIfAborted();if(closed||!channel.connected)return Promise.reject(new AppError('PDF_DESKTOP'));if(pending.size)return Promise.reject(new AppError('PDF_BUSY'));
  return new Promise((resolve,reject)=>{const id=++next,abort=()=>{send({type:'pdf-cancel',id});finish();reject(signal.reason??new AppError('PDF_CANCELLED'));},timer=setTimeout(()=>{send({type:'pdf-cancel',id});finish();reject(new AppError('PDF_TIMEOUT'));},125000),finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);pending.delete(id);};
   pending.set(id,{resolve,reject,finish,preflightOnly:input.preflightOnly===true});signal?.addEventListener('abort',abort,{once:true});send({type:'pdf-render',id,input});
  });
 },close(){closed=true;channel.off('message',receive);for(const entry of pending.values()){entry.finish();entry.reject(new AppError('PDF_CANCELLED'));}}};
}

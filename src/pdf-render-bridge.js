import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {validPdfPreflight} from './pdf-preflight.js';
import {validPdfOutputValidation} from './web/pdf-output-validation-model.js';
import {nativeResources} from './native-resource-budget.js';
const MiB=1024*1024;
// Account for the remote renderer in the service that also admits databases
// and converters. These are peak-memory estimates, not OS-enforced limits.
const renderBytes=input=>512*MiB+(input?.outputProfile&&!input?.preflightOnly?128*MiB:0)+4*Buffer.byteLength(typeof input?.html==='string'?input.html:'')+2*Buffer.byteLength(typeof input?.iccProfile==='string'?input.iccProfile:'');
// Only a completed render carries bytes. Capability checks do not reserve the
// renderer or interfere with cancellation of a separate render request.
export function pdfRenderBridge(channel,{budget=nativeResources}={}){
 const pending=new Map();let next=0,closed=false;
 const send=value=>{if(!closed&&channel.connected)channel.send(value);};
 const receive=message=>{
  if(!['pdf-result','pdf-capabilities-result'].includes(message?.type))return;
  const entry=pending.get(message.id);if(!entry||message.type!==(entry.kind==='capabilities'?'pdf-capabilities-result':'pdf-result'))return;entry.finish({confirmed:true});
  if(entry.kind==='capabilities'){entry.resolve({archival:message.archival===true});return;}
  if(entry.cancelledError){entry.reject(entry.cancelledError);return;}
  if(message.error){entry.reject(new AppError(message.error));return;}
  const invalid=()=>entry.reject(new AppError('PDF_OUTPUT'));
  if(!validPdfPreflight(message.preflight))return invalid();
  if(message.bytes===null){if(message.sha256!==null||message.validation!==undefined||!entry.preflightOnly&&message.preflight.status!=='fatal')return invalid();entry.resolve({bytes:null,renderer:message.renderer,sha256:null,conformance:[],preflight:message.preflight});return;}
  if(message.preflight.status==='fatal'||entry.preflightOnly||typeof message.bytes!=='string'||message.bytes.length>90*1024*1024)return invalid();
  const bytes=Buffer.from(message.bytes,'base64'),sha256=createHash('sha256').update(bytes).digest('hex');if(bytes.length>64*1024*1024||bytes.toString('base64')!==message.bytes||bytes.subarray(0,5).toString()!=='%PDF-'||message.sha256!==sha256)return invalid();
  if(entry.profile?!validPdfOutputValidation(message.validation)||message.validation.profile!==entry.profile||message.validation.sha256!==sha256:message.validation!==undefined)return invalid();
  entry.resolve({bytes,renderer:message.renderer,sha256,conformance:entry.profile==='pdfa-2u'?['pdfa-2u']:[],preflight:message.preflight,...(entry.profile?{validation:message.validation}:{})});
 };
 channel.on('message',receive);
 function request(kind,input,{signal}={}){
  signal?.throwIfAborted();if(closed||!channel.connected)return Promise.reject(new AppError('PDF_DESKTOP'));
  if(kind==='render'&&[...pending.values()].some(entry=>entry.kind==='render'))return Promise.reject(new AppError('PDF_BUSY'));
  let reservation;
  try{if(kind==='render')reservation=budget.reserve('media',renderBytes(input));}
  catch(error){return Promise.reject(error);}
  return new Promise((resolve,reject)=>{
   const id=++next;let timer;
   const finish=({confirmed=false}={})=>{
    clearTimeout(timer);signal?.removeEventListener('abort',abort);pending.delete(id);
    // Losing IPC does not prove that the renderer or its validator stopped.
    // Retain unknown work in the service budget instead of admitting its place.
    if(confirmed)reservation?.release();else reservation?.uncertainExit();
   };
   const cancel=error=>{
    const entry=pending.get(id);if(!entry||entry.cancelledError)return;
    if(kind!=='render'){finish();reject(error);return;}
    // The caller's queue remains reserved until the desktop confirms that its
    // worker/validator has stopped. A missing acknowledgment disables this
    // bridge; it must never admit overlapping work after a cancellation timeout.
    entry.cancelledError=error;clearTimeout(timer);signal?.removeEventListener('abort',abort);
    timer=setTimeout(()=>close(new AppError('PDF_TIMEOUT')),10000);
    try{send({type:'pdf-cancel',id});}catch{close(new AppError('PDF_DESKTOP'));}
   },abort=()=>cancel(signal.reason??new AppError('PDF_CANCELLED'));
   timer=setTimeout(()=>cancel(new AppError('PDF_TIMEOUT')),kind==='render'?125000:30000);
   pending.set(id,{kind,resolve,reject,finish,preflightOnly:input?.preflightOnly===true,profile:input?.outputProfile,cancelledError:null});signal?.addEventListener('abort',abort,{once:true});
   try{send({type:kind==='render'?'pdf-render':'pdf-capabilities',id,...(kind==='render'?{input}:{})});}catch{finish();reject(new AppError('PDF_DESKTOP'));}
  });
 }
 function close(error=new AppError('PDF_CANCELLED')){closed=true;channel.off('message',receive);for(const entry of pending.values()){entry.finish();entry.reject(entry.cancelledError??error);}}
 return {render:(input,options)=>request('render',input,options),capabilities:options=>request('capabilities',null,options),close};
}

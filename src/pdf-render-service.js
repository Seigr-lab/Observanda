import {AppError} from './errors.js';
let renderer=null,active=null;
// Only the trusted desktop process installs a renderer. HTTP clients supply a
// saved document revision, never HTML or executable renderer configuration.
export function installPdfRenderer(value){if(typeof value!=='function'||renderer)throw new AppError('INVALID');renderer=value;return ()=>{if(renderer===value)renderer=null;};}
export const pdfRendererAvailable=()=>renderer!==null;
function waitForRender(promise,signal){
 signal?.throwIfAborted();return new Promise((resolve,reject)=>{const aborted=()=>{clean();reject(signal.reason??new AppError('PDF_CANCELLED'));},clean=()=>signal?.removeEventListener('abort',aborted);signal?.addEventListener('abort',aborted,{once:true});promise.then(()=>{clean();resolve();},error=>{clean();reject(error);});});
}
export async function renderSavedPdf(input,{signal,wait=false}={}){
 const selected=renderer;if(!selected)throw new AppError('PDF_DESKTOP');signal?.throwIfAborted();
 while(active){if(!wait)throw new AppError('PDF_BUSY');await waitForRender(active,signal);if(renderer!==selected)throw new AppError('PDF_DESKTOP');}
 signal?.throwIfAborted();let release;const current=new Promise(resolve=>{release=resolve;});active=current;
 try{return await selected(input,{signal});}finally{if(active===current)active=null;release();}
}

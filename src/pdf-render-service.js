import {AppError} from './errors.js';
let renderer=null;
// Only the trusted desktop process installs a renderer. HTTP clients supply a
// saved document revision, never HTML or executable renderer configuration.
export function installPdfRenderer(value){if(typeof value!=='function'||renderer)throw new AppError('INVALID');renderer=value;return ()=>{if(renderer===value)renderer=null;};}
export const pdfRendererAvailable=()=>renderer!==null;
export async function renderSavedPdf(input,options){if(!renderer)throw new AppError('PDF_DESKTOP');return renderer(input,options);}

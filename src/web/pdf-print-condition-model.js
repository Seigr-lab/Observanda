import {revisionId} from './revision-model.js';
export const PDF_ICC_MAX_BYTES=8*1024*1024;
export const PDF_PRINT_INTENTS=['relative-colorimetric','perceptual','saturation','absolute-colorimetric'];
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.split(',').sort().join();
export function validPdfPrintCondition(v){return !!exact(v,'version,profile,label,renderingIntent')&&v.version===1&&exact(v.profile,'sha256,revision')&&revisionId(v.profile.sha256)&&revisionId(v.profile.revision)&&typeof v.label==='string'&&v.label.trim().length>0&&v.label.length<=120&&!/[\u0000-\u001f\u007f]/.test(v.label)&&PDF_PRINT_INTENTS.includes(v.renderingIntent);}

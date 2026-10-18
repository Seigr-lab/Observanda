import {validPdfImageOutputDpi} from './pdf-image-resolution-model.js';
import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.split(',').sort().join();
const text=(v,max,required=false)=>typeof v==='string'&&v.length<=max&&(!required||!!v.trim())&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
const number=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
export const PDF_IMAGE_MAX_BYTES=16*1024*1024;
export const PDF_IMAGE_MAX_PIXELS=64*1024*1024;
export function validPdfImage(value){
 return exact(value,'id,asset,alt,caption,widthMm,heightMm,fit,crop,position'+(Object.hasOwn(value??{},'outputDpi')?',outputDpi':''))&&validPdfImageOutputDpi(value.outputDpi)&&researchId(value.id)&&revisionId(value.asset)&&text(value.alt,2000,true)&&text(value.caption,2000)&&number(value.widthMm,1,1000)&&number(value.heightMm,1,1000)&&['contain','cover'].includes(value.fit)&&exact(value.crop,'x,y')&&number(value.crop.x,0,100)&&number(value.crop.y,0,100)&&exact(value.position,'block,align')&&Number.isInteger(value.position.block)&&number(value.position.block,0,12000)&&['left','center','right'].includes(value.position.align);
}
export const validPdfImages=values=>Array.isArray(values)&&new Set(values.map(value=>value?.id)).size===values.length&&values.every(validPdfImage);
export function pdfImagePlacement(asset,{id,alt,caption='',block=0,widthMm=100}={}){
 if(!asset||!revisionId(asset.asset)||!Number.isInteger(asset.width)||asset.width<1||!Number.isInteger(asset.height)||asset.height<1)throw new TypeError('Invalid PDF image');
 const value={id,asset:asset.asset,alt,caption,widthMm,heightMm:Math.max(1,Math.min(1000,widthMm*asset.height/asset.width)),fit:'contain',crop:{x:50,y:50},position:{block,align:'center'}};
 if(!validPdfImage(value))throw new TypeError('Invalid PDF image');return value;
}

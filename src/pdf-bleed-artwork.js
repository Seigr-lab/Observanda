import {createHash} from 'node:crypto';
import {validPdfPress} from './web/pdf-press-model.js';
import {PDF_IMAGE_MAX_BYTES,PDF_IMAGE_MAX_PIXELS} from './web/pdf-image-model.js';
const fail=()=>{throw Object.assign(new Error('PDF_PRESS_FAILED'),{code:'PDF_PRESS_FAILED'});};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.split(',').sort().join();
export function pdfBleedImageBytes(press,image){
 if(!validPdfPress(press))fail();
 const wanted=press.version===2?press.artwork.image:null;
 if(!wanted){if(image!==undefined)fail();return null;}
 if(!exact(image,'asset,width,height,data')||image.asset!==wanted.asset||!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)||image.width<1||image.height<1||image.width*image.height>PDF_IMAGE_MAX_PIXELS||typeof image.data!=='string'||image.data.length>4*Math.ceil(PDF_IMAGE_MAX_BYTES/3))fail();
 const bytes=Buffer.from(image.data,'base64');
 if(bytes.length<45||bytes.length>PDF_IMAGE_MAX_BYTES||bytes.toString('base64')!==image.data||createHash('sha256').update(bytes).digest('hex')!==image.asset||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)!==image.width||bytes.readUInt32BE(20)!==image.height)fail();
 return bytes;
}
// Called while the exact document edition is open, never against a latest or
// foreign image library. The existing image reader authenticates canonical PNG.
export async function preparePdfBleedImage(press,readImage,{signal}={}){
 signal?.throwIfAborted();if(press?.version!==2||!press.artwork.image)return undefined;
 if(!validPdfPress(press)||typeof readImage!=='function')fail();
 const value=await readImage(press.artwork.image.asset);signal?.throwIfAborted();
 if(!value||value.mime!=='image/png'||!(value.content instanceof Uint8Array))fail();
 const result={asset:value.asset,width:value.width,height:value.height,data:Buffer.from(value.content).toString('base64')};pdfBleedImageBytes(press,result);return result;
}

import {attachPdfPressImage} from './pdf-press-fields.js';
import {PDF_IMAGE_MAX_BYTES} from './pdf-image-model.js';
import {t} from './i18n/index.js';
const base64=bytes=>{let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);};
export function pdfPressArtworkUI({post,getDocument,changed,draw,notify}){
 let upload=null,controller=null,disposed=false,generation=0;
 const reset=()=>{generation++;controller?.abort();controller=null;};
 function input(element){
  if(['enabled','artworkEnabled'].includes(element.dataset.pdfPress)){reset();return false;}
  if(!element.hasAttribute('data-pdf-press-image'))return false;
  const file=element.files?.[0],selected=getDocument();if(!file||disposed||selected?.header.press?.version!==2)return true;
  reset();const sequence=generation;controller=new AbortController();const signal=controller.signal;
  const same=()=>!disposed&&generation===sequence&&getDocument()===selected&&selected.header.press?.version===2;
  let task;task=(async()=>{
   if(!file.size||file.size>PDF_IMAGE_MAX_BYTES)throw Error(t('errors','MEDIA_LIMIT'));
   const bytes=new Uint8Array(await file.arrayBuffer());signal.throwIfAborted();
   const value=await post('image-import',{id:selected.header.id,bytes:base64(bytes)},{signal});signal.throwIfAborted();
   if(same()&&attachPdfPressImage(selected.header,value)){changed();draw();}
  })().catch(error=>{if(error.name!=='AbortError'&&same())notify(error.message??String(error));}).finally(()=>{if(upload===task){upload=null;if(same())draw();}});upload=task;return true;
 }
 function action(name){if(name!=='press-artwork-remove')return false;reset();const selected=getDocument();if(selected?.header.press?.version===2&&selected.header.press.artwork.image){selected.header.press={...selected.header.press,artwork:{...selected.header.press.artwork,image:null}};changed();draw();}return true;}
 return {input,action,isBusy:()=>upload!==null,whenIdle:()=>upload??Promise.resolve(),deactivate:reset,dispose(){disposed=true;reset();}};
}

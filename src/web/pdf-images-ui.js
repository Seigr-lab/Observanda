import {t} from './i18n/index.js';
import {PDF_IMAGE_MAX_BYTES,pdfImagePlacement,validPdfImage} from './pdf-image-model.js';
const tr=key=>t('pdfEditor',key);
const base64=bytes=>{let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);};
export function pdfImagesUI({post,esc,getDocument,getSection,changed,draw,notify,readImage}){
 let context='',pending=null,alt='',caption='',busy=false,upload=null,controller=null,preview=null,disposed=false,generation=0;
 const key=()=>[getDocument()?.header.id,getSection()?.id].join(':'),capture=()=>({key:key(),generation}),same=value=>!disposed&&key()===value.key&&generation===value.generation;
 const release=()=>{if(preview)URL.revokeObjectURL(preview.url);preview=null;};
 function reset(){generation++;controller?.abort();controller=null;pending=null;alt=caption='';busy=false;release();context=key();}
 const button=(label,command,attrs='')=>'<button type="button" class="button" data-action="module-command" data-module-id="pdf-editor" data-command="image-'+command+'" '+attrs+'>'+esc(tr(label))+'</button>';
 const field=(label,input)=>'<label class="field">'+esc(tr(label))+input+'</label>';
 async function select(file){
  reset();const selected=capture(),documentId=getDocument()?.header.id;controller=new AbortController();const signal=controller.signal;
  if(!file||!getSection())return;if(!file.size||file.size>PDF_IMAGE_MAX_BYTES)throw Error(t('errors','MEDIA_LIMIT'));
  busy=true;draw();
  try{
   const bytes=new Uint8Array(await file.arrayBuffer());signal.throwIfAborted();
   const value=await post('image-import',{id:documentId,bytes:base64(bytes)},{signal});signal.throwIfAborted();
   if(same(selected))pending=value;
  }finally{if(same(selected)){busy=false;draw();}}
 }
 function view(){
  if(context!==key())reset();const section=getSection();if(!section)return '';
  let html='<details data-pdf-images'+(busy||pending||section.images?.length?' open':'')+'><summary>'+esc(tr('imageTitle'))+'</summary>'+field('imageChoose','<input type="file" data-pdf-image-file accept="image/png,image/jpeg,image/webp,image/bmp,image/tiff"'+(busy?' disabled':'')+'>');
  if(busy)html+='<p role="status">'+esc(tr('imageUploading'))+'</p>';
  if(pending)html+='<div class="panel">'+field('imageAlt','<input data-pdf-image-new="alt" maxlength="2000" required value="'+esc(alt)+'">')+field('imageCaption','<textarea data-pdf-image-new="caption" maxlength="2000">'+esc(caption)+'</textarea>')+button('imageAdd','add')+'</div>';
  for(const [index,image] of (section.images??[]).entries()){
   const attr=' data-pdf-image-id="'+image.id+'"',number=(name,value,min,max)=>'<input type="number"'+attr+' data-pdf-image-field="'+name+'" min="'+min+'" max="'+max+'" step="'+(name==='block'?'1':'any')+'" value="'+value+'">';
   html+='<section class="panel" data-pdf-image="'+image.id+'">'+field('imageAlt','<input'+attr+' data-pdf-image-field="alt" maxlength="2000" required value="'+esc(image.alt)+'">')+field('imageCaption','<textarea'+attr+' data-pdf-image-field="caption" maxlength="2000">'+esc(image.caption)+'</textarea>')+field('imageWidth',number('widthMm',image.widthMm,1,1000))+field('imageHeight',number('heightMm',image.heightMm,1,1000))+field('imageFit','<select'+attr+' data-pdf-image-field="fit">'+['contain','cover'].map(value=>'<option value="'+value+'"'+(image.fit===value?' selected':'')+'>'+esc(tr(value==='contain'?'imageContain':'imageCover'))+'</option>').join('')+'</select>')+field('imageCropX',number('x',image.crop.x,0,100))+field('imageCropY',number('y',image.crop.y,0,100))+field('imageBlock',number('block',image.position.block,0,12000))+field('imageAlign','<select'+attr+' data-pdf-image-field="align">'+['left','center','right'].map(value=>'<option value="'+value+'"'+(image.position.align===value?' selected':'')+'>'+esc(tr('image'+value[0].toUpperCase()+value.slice(1)))+'</option>').join('')+'</select>')+'<div class="pdf-toolbar">'+button('imageUp','up','data-id="'+image.id+'"'+(index===0?' disabled':''))+button('imageDown','down','data-id="'+image.id+'"'+(index===section.images.length-1?' disabled':''))+button('imageRemove','remove','data-id="'+image.id+'"')+(readImage?button('imagePreview','preview','data-id="'+image.id+'"'):'')+'</div>'+(preview?.asset===image.asset?'<img src="'+esc(preview.url)+'" alt="'+esc(image.alt)+'" style="max-width:100%;max-height:240px">':'')+'</section>';
  }
  return html+'</details>';
 }
 function input(el){
  if(el.hasAttribute('data-pdf-image-file')){const file=el.files?.[0];if(file){let task;task=select(file).catch(error=>{if(error.name!=='AbortError'&&!disposed)notify(error.message??String(error));}).finally(()=>{if(upload===task)upload=null;});upload=task;}return true;}
  if(el.dataset.pdfImageNew){if(el.dataset.pdfImageNew==='alt')alt=el.value;else if(el.dataset.pdfImageNew==='caption')caption=el.value;return true;}
  if(!el.dataset.pdfImageField)return false;const section=getSection(),image=section?.images?.find(value=>value.id===el.dataset.pdfImageId);if(!image)return true;
  const next=structuredClone(image),name=el.dataset.pdfImageField,value=['alt','caption','fit','align'].includes(name)?el.value:el.value===''?NaN:Number(el.value);
  if(['x','y'].includes(name))next.crop[name]=value;else if(['block','align'].includes(name))next.position[name]=value;else if(['alt','caption','fit','widthMm','heightMm'].includes(name))next[name]=value;else return true;
  if(!validPdfImage(next)){el.setAttribute?.('aria-invalid','true');return true;}el.removeAttribute?.('aria-invalid');Object.assign(image,next);changed();return true;
 }
 async function action(command,node){
  if(!command.startsWith('image-'))return false;if(context!==key())reset();const section=getSection();if(!section)return true;const name=command.slice(6);
  if(name==='add'){
   if(!pending)return true;if(!alt.trim())throw Error(tr('imageMissingAlt'));
   const image=pdfImagePlacement(pending,{id:crypto.randomUUID(),alt,caption});(section.images??=[]).push(image);pending=null;alt=caption='';changed();draw();return true;
  }
  const index=section.images?.findIndex(value=>value.id===node.dataset.id)??-1;if(index<0)return true;const image=section.images[index];
  if(name==='remove'){section.images.splice(index,1);if(!section.images.length)delete section.images;release();changed();draw();}
  else if(name==='up'||name==='down'){const other=index+(name==='up'?-1:1);if(other>=0&&other<section.images.length){const neighbour=section.images[other],position=image.position.block;image.position.block=neighbour.position.block;neighbour.position.block=position;[section.images[index],section.images[other]]=[neighbour,image];changed();draw();}}
  else if(name==='preview'&&readImage){const selected=capture(),blob=await readImage({id:getDocument().header.id,asset:image.asset});if(same(selected)){release();preview={asset:image.asset,url:URL.createObjectURL(blob)};draw();}}
  else return false;return true;
 }
 return {view,input,action,isBusy:()=>busy,whenIdle:()=>upload??Promise.resolve(),dispose(){disposed=true;reset();}};
}

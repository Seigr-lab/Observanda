import {planPdfImageResolution} from './pdf-image-resolution-model.js';
// Called only on a compiled PDF or an isolated, attached preview container.
// Original assets and live authoring nodes are never inputs to this operation.
// Keep this function self-contained: the desktop script supplies its planner.
export async function applyPdfImageResolution(planner=planPdfImageResolution,{root=document}={}){
 const doc=root.ownerDocument??root,view=doc.defaultView??globalThis,select=selector=>[...(root.matches?.(selector)?[root]:[]),...root.querySelectorAll(selector)],sections=select('.pdf-section'),saved=sections.map(section=>[section,section.getAttribute('style')]),maxBytes=16*1024*1024,limit=256;
 const result={version:1,images:0,changed:0,beforeBytes:0,afterBytes:0,beforePixels:0,afterPixels:0,items:[],truncated:false},fail=()=>{const error=new Error('PDF_IMAGE_RESOLUTION_FAILED');error.code='PDF_IMAGE_RESOLUTION_FAILED';throw error;},id=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)?value:null;
 const size=source=>{if(typeof source!=='string'||!source.startsWith('data:image/png;base64,'))return fail();const value=source.slice(22);if(!value.length||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))return fail();const bytes=value.length/4*3-(value.endsWith('==')?2:value.endsWith('=')?1:0);if(!Number.isSafeInteger(bytes)||bytes<1||bytes>maxBytes)return fail();return bytes;};
 const dataURL=blob=>new Promise((resolve,reject)=>{const reader=new view.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error??new Error('PDF_IMAGE_RESOLUTION_FAILED'));reader.readAsDataURL(blob);});
 try{
  await doc.fonts.ready;
  for(const section of sections){const width=Number(section.getAttribute('data-pdf-width-mm'));if(!Number.isFinite(width)||width<=0||width>1000)fail();section.style.setProperty('width',width+'mm','important');section.style.setProperty('min-width','0','important');section.style.setProperty('max-width','none','important');}
  for(const image of select('.pdf-placed-image > img')){
   const raw=image.getAttribute('data-pdf-output-dpi'),requestedDpi=raw===null?null:Number(raw);if(raw!==null&&!/^[0-9]+$/.test(raw)||image.srcset)fail();
   await image.decode().catch(fail);const original=image.currentSrc||image.src,before={width:image.naturalWidth,height:image.naturalHeight,pixels:image.naturalWidth*image.naturalHeight,bytes:size(original)},rect=image.getBoundingClientRect();let plan;
   try{plan=planner({naturalWidth:before.width,naturalHeight:before.height,widthPx:rect.width,heightPx:rect.height,fit:view.getComputedStyle(image).objectFit,outputDpi:requestedDpi});}catch{fail();}
   let after={...before};
   if(plan.downsample){const canvas=doc.createElement('canvas');try{
    canvas.width=plan.width;canvas.height=plan.height;const context=canvas.getContext('2d',{alpha:true});if(!context)fail();context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(image,0,0,plan.width,plan.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob||blob.type!=='image/png'||blob.size<1||blob.size>maxBytes)fail();const output=await dataURL(blob);if(size(output)!==blob.size)fail();image.src=output;await image.decode().catch(fail);if(image.naturalWidth!==plan.width||image.naturalHeight!==plan.height)fail();after={width:plan.width,height:plan.height,pixels:plan.pixels,bytes:blob.size};
   }finally{canvas.width=0;canvas.height=0;}}
   const section=image.closest('.pdf-section'),figure=image.closest('.pdf-placed-image'),row={sectionId:id(section?.getAttribute('data-pdf-section-id')??section?.id?.replace(/^pdf-section-/,'')),imageId:id(figure?.getAttribute('data-pdf-block-id')),requestedDpi,sourceDpi:plan.sourceDpi,effectiveDpi:plan.effectiveDpi,before,after,changed:plan.downsample};
   result.images++;result.changed+=Number(row.changed);result.beforeBytes+=before.bytes;result.afterBytes+=after.bytes;result.beforePixels+=before.pixels;result.afterPixels+=after.pixels;if(result.items.length<limit)result.items.push(row);else result.truncated=true;
  }
  return result;
 }catch(error){if(error?.code==='PDF_IMAGE_RESOLUTION_FAILED')throw error;fail();}
 finally{for(const [section,style] of saved){if(style===null)section.removeAttribute('style');else section.setAttribute('style',style);}}
}

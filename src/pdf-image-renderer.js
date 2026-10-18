import {PdfLayoutError} from './web/pdf-layout-model.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Only canonical, document-owned raster assets reach the renderer. Positional
// settings affect this placement, never the source image or other documents.
export async function renderPdfImages(section,readImage,{signal,textGlyphs,font}={}){
 const images=[];for(const image of section.images??[]){signal?.throwIfAborted();if(!readImage)throw new PdfLayoutError('PDF_UNRESOLVED_FIGURE',[section.id,image.id]);const asset=await readImage(image.asset);signal?.throwIfAborted();if(asset.mime!=='image/png'||!Buffer.isBuffer(asset.content)||asset.asset!==image.asset)throw new PdfLayoutError('PDF_INPUT');textGlyphs?.(font,image.alt+' '+image.caption);
  const align={left:'0 auto 0 0',center:'0 auto',right:'0 0 0 auto'}[image.position.align];
  images.push({block:image.position.block,html:'<figure class="pdf-placed-image" data-pdf-block-id="'+image.id+'" style="width:'+image.widthMm+'mm;margin:'+align+'"><img src="data:image/png;base64,'+asset.content.toString('base64')+'" alt="'+esc(image.alt)+'" width="'+asset.width+'" height="'+asset.height+'" style="display:block;width:'+image.widthMm+'mm;height:'+image.heightMm+'mm;max-width:none;object-fit:'+image.fit+';object-position:'+image.crop.x+'% '+image.crop.y+'%">'+(image.caption?'<figcaption>'+esc(image.caption)+'</figcaption>':'')+'</figure>'});
 }return images;
}

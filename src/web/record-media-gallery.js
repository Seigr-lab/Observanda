import {t} from './i18n/index.js';
import {mediaCreditLine,mediaMetadataDetails} from './record-media-metadata.js';
const text=(key,values)=>t('recordContent',key,values);
// A record's photographs as a grid of reduced copies. Each tile is a native
// disclosure: keyboard focus and Enter or Space open the display copy below
// the tile, and the browser does not fetch that copy until it is opened, so
// a large gallery never loads full-resolution images. Audio and video keep
// their players. Thumbnails are served by /api/media/<id>/thumbnail-<width>.
export const thumbnailSources=(assetUrl,id)=>({src:assetUrl(id)+'/thumbnail-320',srcset:assetUrl(id)+'/thumbnail-320 320w, '+assetUrl(id)+'/thumbnail-640 640w'});
export function recordMediaGallery(items,esc,{assetUrl=id=>'/api/media/'+id,player}={}){
 if(!items.length)return '';
 const tile=item=>{
  if(item.kind!=='image')return '<li class="record-media-tile record-media-tile-'+esc(item.kind)+'">'+player(item)+'</li>';
  const label=item.caption||item.alt||text('galleryImage'),thumb=thumbnailSources(assetUrl,item.id);
  return '<li class="record-media-tile"><figure id="record-figure-'+esc(item.id)+'" tabindex="-1"><details class="record-media-open"><summary aria-label="'+esc(text('galleryOpen',{label}))+'"><img src="'+esc(thumb.src)+'" srcset="'+esc(thumb.srcset)+'" sizes="(max-width: 40rem) 45vw, 15rem" alt="'+esc(item.alt||item.caption)+'" loading="lazy" decoding="async"></summary>'+
   '<img class="record-media-full" src="'+esc(assetUrl(item.id))+'" alt="'+esc(item.alt||item.caption)+'" loading="lazy" decoding="async"></details><figcaption>'+esc(item.caption)+mediaCreditLine(item.metadata,esc)+'</figcaption>'+(item.transcript?'<div class="book-diagram-reading">'+esc(item.transcript)+'</div>':'')+mediaMetadataDetails(item.metadata,esc)+'</figure></li>';
 };
 return '<ul class="record-media-gallery" aria-label="'+esc(text('galleryLabel'))+'">'+items.map(tile).join('')+'</ul>';
}

import {enhancePublicGalleries} from './web/public-gallery.js';
import {publicationText} from './web/publication-messages.js';

export const PUBLIC_GALLERY_SCRIPT='('+enhancePublicGalleries.toString()+')(document);\n';
export function galleryAttributes(esc){
 return ' data-image-gallery'+['viewer','previous','next','close','download','position','zoom'].map(key=>' data-'+key+'="'+esc(publicationText('gallery'+key[0].toUpperCase()+key.slice(1),{current:'{current}',total:'{total}'}))+'"').join('');
}

import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {parse} from 'parse5';
import {PUBLIC_GALLERY_SCRIPT} from './publication-gallery.js';
import {attr} from './website-migration-views.js';
import {galleryGridCSS} from './web/website-gallery-grid.js';
import {imageFrameCSS} from './web/website-image-frame.js';

// A copied gallery must remain usable when its new page never had a viewer.
// Only site-owned, canonical resources are attached. Preserve all other head markup.
export function attachGalleryViewer(html,page){
 if(!html.includes('data-image-gallery'))return html;
 const document=parse(html,{sourceCodeLocationInfo:true}),root=document.childNodes.find(n=>n.tagName==='html'),head=root?.childNodes.find(n=>n.tagName==='head');
 const tags=[],base=path.posix.dirname(page);
 for(const [tag,attribute,name] of [['script','src','public-gallery.js'],['link','href','public-gallery.css']]){
  const linked=head?.childNodes.some(n=>n.tagName===tag&&(tag==='script'||attr(n,'rel')==='stylesheet')&&path.posix.normalize(path.posix.join(base,attr(n,attribute)??''))===name);
  if(linked)continue;const href=path.posix.relative(base,name);
  tags.push(tag==='script'?'<script defer src="'+href+'"></script>':'<link rel="stylesheet" href="'+href+'">');
 }
 if(!tags.length)return html;
 const offset=head?.sourceCodeLocation?.endTag?.startOffset??root?.childNodes.find(n=>n.tagName==='body')?.sourceCodeLocation?.startOffset??root?.sourceCodeLocation?.startTag?.endOffset??document.childNodes.find(n=>n.nodeName==='#documentType')?.sourceCodeLocation?.endOffset??0;
 return html.slice(0,offset)+tags.join('')+html.slice(offset);
}

export async function canonicalGalleryFile(store,siteId,name,signal){
 const content=name==='public-gallery.js'?PUBLIC_GALLERY_SCRIPT:galleryGridCSS+imageFrameCSS+await readFile(new URL('./web/public-gallery.css',import.meta.url),'utf8');
 return store.siteFile(siteId,name,content,{signal});
}

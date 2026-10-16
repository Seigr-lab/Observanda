// Progressive enhancement of published, explicitly selected gallery images.
// Ordinary image links remain usable when scripts or <dialog> are unavailable.
export function enhancePublicGalleries(doc){
 if(doc.documentElement.hasAttribute('data-gallery-ready'))return;
 doc.documentElement.setAttribute('data-gallery-ready','');
 let dialog,frame,picture,caption,position,previous,next,download,zoom,close,items=[],index=0,opener=null,labels=null;
 const element=(tag,className)=>{const el=doc.createElement(tag);el.className=className;return el;};
 function fit(){frame.classList.remove('gallery-actual-size');zoom.setAttribute('aria-pressed','false');frame.scrollTop=frame.scrollLeft=0;}
 function show(value){
  index=value;const link=items[index],image=link.querySelector('img');fit();
  picture.alt=image.alt;picture.src=link.href;
  caption.textContent=link.closest('figure')?.querySelector('figcaption')?.textContent||image.alt;
  position.textContent=labels.position.replace('{current}',String(index+1)).replace('{total}',String(items.length));
  previous.disabled=index===0;next.disabled=index===items.length-1;
  download.href=link.href;download.download=new URL(link.href).pathname.split('/').at(-1);
 }
 function create(){
  dialog=element('dialog','public-gallery-viewer');if(typeof dialog.showModal!=='function'){dialog=null;return false;}
  const bar=element('div','public-gallery-controls'),button=action=>{const el=element('button','public-gallery-button site-visitor-button');el.type='button';el.addEventListener('click',action);bar.append(el);return el;};
  previous=button(()=>show(index-1));next=button(()=>show(index+1));zoom=button(()=>{const actual=zoom.getAttribute('aria-pressed')!=='true';zoom.setAttribute('aria-pressed',String(actual));frame.classList.toggle('gallery-actual-size',actual);});
  download=element('a','public-gallery-download site-visitor-button');bar.append(download);close=button(()=>dialog.close());
  frame=element('div','public-gallery-image');picture=element('img','');frame.append(picture);
  caption=element('p','public-gallery-caption');position=element('p','public-gallery-position');position.setAttribute('role','status');
  dialog.append(bar,frame,caption,position);doc.body.append(dialog);
  dialog.addEventListener('keydown',event=>{if(event.altKey||event.ctrlKey||event.metaKey)return;if(event.key==='ArrowLeft'&&index>0){event.preventDefault();show(index-1);}if(event.key==='ArrowRight'&&index+1<items.length){event.preventDefault();show(index+1);}});
  dialog.addEventListener('close',()=>{picture.removeAttribute('src');items=[];opener?.focus({preventScroll:true});opener=null;});
  return true;
 }
 doc.addEventListener('click',event=>{
  const link=event.target.closest?.('a[data-gallery-image]'),gallery=link?.closest('[data-image-gallery]');
  if(!gallery||event.defaultPrevented||event.button!==0||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
  if(!dialog&&!create())return;
  const candidates=[...gallery.querySelectorAll('a[data-gallery-image]')].filter(item=>item.closest('[data-image-gallery]')===gallery&&item.querySelector('img'));
  const selected=candidates.indexOf(link);if(selected<0)return;
  event.preventDefault();items=candidates;opener=link;labels=gallery.dataset;
  dialog.setAttribute('aria-label',labels.viewer);previous.textContent=labels.previous;next.textContent=labels.next;zoom.textContent=labels.zoom;close.textContent=labels.close;download.textContent=labels.download;
  show(selected);dialog.showModal();close.focus();
 });
}

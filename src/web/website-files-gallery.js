import {PDF_IMAGE_MAX_BYTES,PDF_IMAGE_MAX_PIXELS} from './pdf-image-model.js';
import {publicationText} from './publication-messages.js';
import {galleryGridCSS} from './website-gallery-grid.js';
import {imageResourceURLs,displayWidths} from './website-image-candidates.js';
import {imageFrameControls,readImageFrame,applyImageFrame,changeImageFrame,imageFrameCSS,previewImageFrame,showOriginalImage} from './website-image-frame.js';

const selector='.site-gallery,[data-image-gallery]';
const protectedContent='[data-observanda-source],[data-observanda-link],[data-website-feed],[data-website-source-gallery],[data-website-instance],[data-website-region]';
const pageSize=12;
const galleryList=doc=>[...doc.querySelectorAll(selector)].filter(node=>!node.closest(protectedContent)&&!node.querySelector(protectedContent));
const figures=grid=>Array.from(grid?.children??[]).filter(node=>node.matches('figure')&&node.querySelector('img'));
const publicName=(src,page)=>new URL(src,new URL(page,'https://website.invalid/')).pathname.slice(1);
const relative=(page,name)=>'../'.repeat(page.split('/').length-1)+name;
function prepareViewer(doc,grid,page){
 grid.dataset.imageGallery='';
 for(const key of ['viewer','previous','next','close','download','position','zoom'])grid.dataset[key]??=publicationText('gallery'+key[0].toUpperCase()+key.slice(1),{current:'{current}',total:'{total}'});
 if(![...doc.scripts].some(s=>publicName(s.getAttribute('src'),page)==='public-gallery.js')){
  const script=doc.createElement('script');script.src=relative(page,'public-gallery.js');script.defer=true;doc.head.append(script);
 }
 if(![...doc.querySelectorAll('link[rel=stylesheet][href]')].some(s=>publicName(s.getAttribute('href'),page)==='public-gallery.css')){
  const link=doc.createElement('link');link.rel='stylesheet';link.href=relative(page,'public-gallery.css');doc.head.append(link);
 }
}
async function displayCopy(file,t){
 const image=await createImageBitmap(file);
 try{
  if(image.width*image.height>PDF_IMAGE_MAX_PIXELS)throw Error(t('imageLimit'));
  const make=(width,height)=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(image,0,0,width,height);return canvas;};
  const ratio=Math.min(1,300/Math.max(image.width,image.height)),thumb=make(Math.max(1,Math.round(image.width*ratio)),Math.max(1,Math.round(image.height*ratio)));
  const preview=thumb.toDataURL('image/png'),copies=[];thumb.width=thumb.height=0;
  for(const width of [...displayWidths(image.width,image.height),image.width]){
   const height=Math.max(1,Math.round(image.height*width/image.width)),canvas=make(width,height);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));canvas.width=canvas.height=0;
   if(!blob||blob.size>PDF_IMAGE_MAX_BYTES)throw Error(t('imageLimit'));
   copies.push({name:'pictures/'+crypto.randomUUID()+'.png',width,height,blob,preview});
  }
  return copies;
 }finally{image.close();}
}

export function websiteFilesGallery({t,esc,path,url,read,update,checkpoint,render,run,notify,getCSS,setCSS,createTarget,recoveredPicture=()=>null}){
 let index=0,offset=0,doc=null,drag=null;
 const pending=new Map();
 const inspectorPictures=new Set();
 const reset=()=>{pending.clear();inspectorPictures.clear();doc=null;index=offset=0;};
 function usedPictures(document,ownerPath){
  const used=new Set();
  for(const node of document.querySelectorAll('img[src],img[srcset],picture>source[srcset],a[href]')){
   for(const attr of ['src','srcset','href'])if(node.hasAttribute(attr)){
    for(const candidate of imageResourceURLs(attr,node.getAttribute(attr))){
     try{const name=publicName(candidate,ownerPath);if(name.startsWith('pictures/'))used.add(name);}catch{}
    }
   }
  }
  return used;
 }
 function acknowledged(document,ownerPath){
  for(const name of usedPictures(document,ownerPath))pending.delete(name);
  for(const name of cssPictures()){pending.delete(name);inspectorPictures.delete(name);}
 }
 function trimHistory(activeHTML,entries){
  if(!pending.size)return;
  const names=text=>text.matchAll(/pictures\/[a-f0-9-]{36}\.png/g);
  // Pictures are used by the page or its stylesheet; one just added from the
  // block inspector is kept until it is applied or the page is saved.
  const active=new Set([...Array.from(names(activeHTML+'\n'+(getCSS?.()??'')),match=>match[0]),...inspectorPictures]),kept=new Set();let bytes=0;
  for(const {html,css=''} of entries)for(const [name] of names(html+'\n'+css)){
   const item=pending.get(name);if(!item||active.has(name)||kept.has(name))continue;
   const size=item.blob.size+2*item.preview.length;
   if(kept.size<256&&size<=128*1024*1024-bytes){kept.add(name);bytes+=size;}
  }
  for(const name of pending.keys())if(!active.has(name)&&!kept.has(name))pending.delete(name);
 }
 const grid=()=>galleryList(doc)[index];
 const current=()=>figures(grid());
 const button=(key,op,attributes='')=>'<button type="button" class="button" data-action="website-files-gallery-'+op+'" '+attributes+'>'+esc(t(key))+'</button>';
 function open(nodePath){
  doc=read();const node=nodePath?.split('/').reduce((n,i)=>n?.children[Number(i)],doc.body);
  const target=node?.closest(selector)??node?.querySelector(selector);index=Math.max(0,galleryList(doc).indexOf(target));offset=0;
 }
 function layoutCSS(){
  const css=getCSS(),next=css+(css.includes(galleryGridCSS)?'':galleryGridCSS)+(css.includes(imageFrameCSS)?'':imageFrameCSS);
  if(next!==css)setCSS(next);
 }
 function create({single=false}={}){
  const section=doc.createElement('section'),heading=doc.createElement('h2'),node=doc.createElement('div');
  // A single image is a one-column picture block without a gallery heading.
  heading.textContent=t('gallery');node.className='site-gallery gallery-columns-'+(single?1:3);if(single)section.append(node);else section.append(heading,node);
  const target=createTarget?createTarget():doc.querySelector('main:not([hidden])')??doc.body;
  if(!target)throw Error(t('componentSelect'));
  target.append(section);prepareViewer(doc,node,path());index=galleryList(doc).indexOf(node);offset=0;layoutCSS();return node;
 }
 async function add(files){
  if(!files?.length)return;
  const copies=[];
  for(const file of files)copies.push(await displayCopy(file,t));
  checkpoint();const node=grid()??create();prepareViewer(doc,node,path());layoutCSS();
  for(const variants of copies){
   const picture=variants.at(-1);
   const figure=doc.createElement('figure'),a=doc.createElement('a'),image=doc.createElement('img');
   image.alt='';image.setAttribute('role','img');image.loading='lazy';image.src=a.href=relative(path(),picture.name);a.dataset.galleryImage='';a.setAttribute('aria-haspopup','dialog');
   image.width=picture.width;image.height=picture.height;
   if(variants.length>1){image.srcset=variants.map(item=>relative(path(),item.name)+' '+item.width+'w').join(', ');image.sizes='auto, 100vw';}
   a.append(image);figure.append(a);node.append(figure);
   for(const item of variants)pending.set(item.name,item);
  }
  offset=Math.floor((current().length-copies.length)/pageSize)*pageSize;update(doc);render();
 }
 function view(){
  const list=galleryList(doc),node=grid(),items=current();
  const choices=list.map((g,i)=>'<option value="'+i+'" '+(i===index?'selected':'')+'>'+esc((g.parentElement.querySelector('h1,h2,h3')?.textContent||t('gallery'))+' ('+(i+1)+')')+'</option>').join('');
  const rows=items.slice(offset,offset+pageSize).map((figure,j)=>{
   const i=offset+j,image=figure.querySelector('img'),src=image.getAttribute('src'),name=publicName(src,path()),thumb=pending.get(name)?.preview??recoveredPicture(name)??new URL(src,url(path())).href;
   const id='data-image-index="'+i+'"';
   const decorative=image.getAttribute('role')==='presentation',link=image.closest('a');
   const purpose='<label>'+esc(t('accessPurpose'))+'<select data-gallery-field="purpose" '+id+'><option value="informative">'+esc(t('accessInformative'))+'</option><option value="decorative"'+(decorative?' selected':'')+'>'+esc(t('websiteReviewDecorative'))+'</option></select></label>';
   const linkName=decorative&&link?'<label>'+esc(t('websiteReviewLinkName'))+'<input data-gallery-field="linkName" '+id+' value="'+esc(link.getAttribute('aria-label')??'')+'"></label>':'';
   return '<li '+id+' draggable="true"><img loading="lazy" alt="" src="'+esc(thumb)+'">'+purpose+(decorative?linkName:'<label>'+esc(t('altText'))+'<input data-gallery-field="alt" '+id+' value="'+esc(image.alt)+'"></label>')+'<label>'+esc(t('caption'))+'<input data-gallery-field="caption" '+id+' value="'+esc(figure.querySelector('figcaption')?.textContent??'')+'"></label>'+imageFrameControls(readImageFrame(image.className),t,esc)+button('frameOpenOriginal','original',id)+'<div>'+button('up','up',id+(i?'':' disabled'))+button('down','down',id+(i===items.length-1?' disabled':''))+button('remove','remove',id)+'</div></li>';
  }).join('');
  const columns=/gallery-columns-([1-4])/.exec(node?.className??'')?.[1]??'3';
  return '<section class="panel website-gallery-editor"'+(createTarget?'':' data-website-page-gallery')+'><h2>'+esc(t('gallery'))+'</h2><div class="website-files-toolbar">'+(choices?'<label>'+esc(t('gallery'))+' <select data-gallery-choose>'+choices+'</select></label>':'')+(!createTarget||createTarget()?button('newGallery','new'):'')+(createTarget?'':button('closePreview','close'))+'</div>'+
   (node?'<label>'+esc(t('columns'))+' <select data-gallery-columns>'+[1,2,3,4].map(n=>'<option '+(n===Number(columns)?'selected':'')+'>'+n+'</option>').join('')+'</select></label>':'')+
   '<label class="website-gallery-drop">'+esc(t('addImages'))+' <input type="file" data-gallery-files multiple accept="image/png,image/jpeg,image/webp,image/gif,image/avif"></label>'+
   '<ol class="website-gallery-items">'+rows+'</ol>'+button('prevPage','prev',offset?'':'disabled')+button('nextPage','next',offset+pageSize<items.length?'':'disabled')+'</section>';
 }
 function bind(host=document.querySelector('[data-website-page-gallery]')){
  if(!host)return;
  for(const row of host.querySelectorAll('li[data-image-index]')){
   const image=current()[Number(row.dataset.imageIndex)]?.querySelector('img');if(image)previewImageFrame(row.querySelector('img'),readImageFrame(image.className));
  }
  const input=host.querySelector('[data-gallery-files]');input.onchange=()=>{const files=[...input.files];void run(()=>add(files)).catch(e=>notify(e.message,true));};
  host.ondragstart=e=>{drag=e.target.closest('li[data-image-index]')?.dataset.imageIndex;if(drag!=null)e.dataTransfer.setData('text/plain',drag);};
  host.ondragend=()=>{drag=null;};
  host.ondragover=e=>{if(e.dataTransfer.types.includes('Files')||drag!=null)e.preventDefault();};
  host.ondrop=e=>{e.preventDefault();if(e.dataTransfer.files.length){void run(()=>add(e.dataTransfer.files)).catch(err=>notify(err.message,true));return;}
   const to=e.target.closest('li[data-image-index]')?.dataset.imageIndex,from=drag;drag=null;
   if(from==null||to==null||from===to)return;checkpoint();const items=current();if(Number(from)<Number(to))items[to].after(items[from]);else items[to].before(items[from]);update(doc);render();
  };
 }
 function input(el){
  if(!doc)return false;
  if(el.hasAttribute('data-image-frame')){
   const row=el.closest('li[data-image-index]');if(!row)return false;
   const image=current()[Number(row.dataset.imageIndex)]?.querySelector('img');if(!image)return false;
   const frame=changeImageFrame(el,readImageFrame(image.className));if(!frame)return false;
   checkpoint(false);applyImageFrame(image,frame);previewImageFrame(row.querySelector('img'),frame);layoutCSS();update(doc);return true;
  }
  if(el.matches('[data-gallery-choose]')){index=Number(el.value);offset=0;render();return true;}
  if(el.matches('[data-gallery-columns]')){
   const node=grid();checkpoint();node.classList.remove(...Array.from(node.classList).filter(c=>/^gallery-columns-\d+$/.test(c)));node.classList.add('gallery-columns-'+Number(el.value));layoutCSS();update(doc);return true;
  }
  const field=el.dataset.galleryField;if(!field)return false;
  const item=current()[Number(el.dataset.imageIndex)];if(!item)return true;
  if(field==='purpose'){
   const image=item.querySelector('img'),decorative=el.value==='decorative';checkpoint();image.setAttribute('role',decorative?'presentation':'img');
   if(decorative)image.alt='';update(doc);render();return true;
  }
  if(field==='linkName'){
   const link=item.querySelector('img')?.closest('a');if(link){checkpoint(false);link.setAttribute('aria-label',el.value);update(doc);}return true;
  }
  if(field==='alt'&&item.querySelector('img').alt!==el.value){checkpoint(false);item.querySelector('img').alt=el.value;}
  if(field==='caption'){let caption=item.querySelector('figcaption');if((caption?.textContent??'')===el.value)return true;checkpoint(false);if(el.value){if(!caption){caption=doc.createElement('figcaption');item.append(caption);}caption.textContent=el.value;}else caption?.remove();}
  update(doc);return true;
 }
 function action(op,el){
  if(op==='original'){
   const image=current()[Number(el.dataset.imageIndex)].querySelector('img'),src=image.getAttribute('src'),name=publicName(src,path());
   showOriginalImage(el,pending.get(name)?.blob??recoveredPicture(name)??new URL(src,url(path())).href,image.alt,t,'frameUploadNote');return;
  }
  if(op==='new'){checkpoint();create();update(doc);}
  else if(op==='new-image'){checkpoint();create({single:true});update(doc);}
  else if(op==='prev'||op==='next'){offset=Math.max(0,offset+(op==='prev'?-pageSize:pageSize));}
  else{const items=current(),i=Number(el.dataset.imageIndex),item=items[i];if(!item)return;checkpoint();
   if(op==='remove')item.remove();else if(op==='up')items[i-1]?.before(item);else if(op==='down')items[i+1]?.after(item);
   offset=Math.min(offset,Math.floor(Math.max(0,current().length-1)/pageSize)*pageSize);update(doc);
  }
  render();
 }
 // A picture used only as a background is referenced from the stylesheet.
 function cssPictures(){return new Set(Array.from((getCSS?.()??'').matchAll(/pictures\/[a-f0-9-]{36}\.png/g),match=>match[0]));}
 function body(data,ownerPath=data.path,document=read(),held=new Set()){
  if(!pending.size)return null;
  const used=new Set([...usedPictures(document,ownerPath),...cssPictures()]);
  const pictures=[...pending.values()].filter(item=>used.has(item.name)&&!held.has(item.name));if(!pictures.length)return null;
  const control=new TextEncoder().encode(JSON.stringify({...data,pictures:pictures.map(({name,blob})=>({name,size:blob.size}))}));
  const size=new DataView(new ArrayBuffer(4));size.setUint32(0,control.length);return new Blob([size,control,...pictures.map(p=>p.blob)]);
 }
 function paint(canvas){for(const image of canvas.querySelectorAll('img[src]')){const src=image.getAttribute('src'),name=publicName(src,path()),preview=pending.get(name)?.preview??recoveredPicture(name);if(preview){image.dataset.observandaEditorImage=src;image.src=preview;if(image.hasAttribute('srcset')){image.dataset.observandaEditorSrcset=image.getAttribute('srcset');image.removeAttribute('srcset');}}}}
 // The block inspector adds a background picture through the same copies.
 const objectURLs=new Map();
 async function addPicture(file){
  const variants=await displayCopy(file,t);for(const item of variants)pending.set(item.name,item);
  inspectorPictures.add(variants.at(-1).name);
  return variants.at(-1).name;
 }
 function pendingURL(name){
  const item=pending.get(name);if(!item)return null;
  if(!objectURLs.has(name))objectURLs.set(name,URL.createObjectURL(item.blob));
  return objectURLs.get(name);
 }
 return {open,view,bind,action,input,body,paint,reset,acknowledged,trimHistory,hasPending:name=>pending.has(name),addPicture,pendingURL};
}

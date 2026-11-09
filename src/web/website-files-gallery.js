import {PDF_IMAGE_MAX_BYTES,PDF_IMAGE_MAX_PIXELS} from './pdf-image-model.js';
import {publicationText} from './publication-messages.js';

const selector='.site-gallery,[data-image-gallery]';
const protectedContent='[data-observanda-source],[data-observanda-link]';
const pageSize=12;
const galleryList=doc=>[...doc.querySelectorAll(selector)].filter(node=>!node.closest(protectedContent)&&!node.querySelector(protectedContent));
const figures=grid=>Array.from(grid?.children??[]).filter(node=>node.matches('figure')&&node.querySelector('img'));
const publicName=(src,page)=>new URL(src,new URL(page,'https://website.invalid/')).pathname.slice(1);
const relative=(page,name)=>'../'.repeat(page.split('/').length-1)+name;
const gridCSS='\n.site-gallery{display:grid;gap:1rem}.site-gallery>figure{min-width:0;margin:0}.site-gallery img{max-width:100%;height:auto}.site-gallery.gallery-columns-1{grid-template-columns:1fr}.site-gallery.gallery-columns-2{grid-template-columns:repeat(2,minmax(0,1fr))}.site-gallery.gallery-columns-3{grid-template-columns:repeat(3,minmax(0,1fr))}.site-gallery.gallery-columns-4{grid-template-columns:repeat(4,minmax(0,1fr))}@media(max-width:600px){.site-gallery[class*=gallery-columns-]{grid-template-columns:1fr}}\n';
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
  const canvas=make(image.width,image.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  canvas.width=canvas.height=0;
  if(!blob||blob.size>PDF_IMAGE_MAX_BYTES)throw Error(t('imageLimit'));
  const ratio=Math.min(1,300/Math.max(image.width,image.height)),thumb=make(Math.max(1,Math.round(image.width*ratio)),Math.max(1,Math.round(image.height*ratio)));
  return {name:'pictures/'+crypto.randomUUID()+'.png',blob,preview:thumb.toDataURL('image/png')};
 }finally{image.close();}
}

export function websiteFilesGallery({t,esc,path,url,read,update,checkpoint,render,run,notify,getCSS,setCSS}){
 let index=0,offset=0,doc=null,drag=null;
 const pending=new Map();
 const reset=()=>{pending.clear();doc=null;index=offset=0;};
 function acknowledged(document,ownerPath){
  for(const image of document.querySelectorAll('img[src]'))pending.delete(publicName(image.getAttribute('src'),ownerPath));
 }
 function trimHistory(activeHTML,entries){
  if(!pending.size)return;
  const names=text=>text.matchAll(/pictures\/[a-f0-9-]{36}\.png/g);
  const active=new Set(Array.from(names(activeHTML),match=>match[0])),kept=new Set();let bytes=0;
  for(const {html} of entries)for(const [name] of names(html)){
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
 function layoutCSS(){const css=getCSS();if(!css.includes(gridCSS))setCSS(css+gridCSS);}
 function create(){
  const section=doc.createElement('section'),heading=doc.createElement('h2'),node=doc.createElement('div');
  heading.textContent=t('gallery');node.className='site-gallery gallery-columns-3';section.append(heading,node);
  (doc.querySelector('main:not([hidden])')??doc.body).append(section);prepareViewer(doc,node,path());index=galleryList(doc).indexOf(node);offset=0;layoutCSS();return node;
 }
 async function add(files){
  if(!files?.length)return;
  const copies=[];
  for(const file of files)copies.push(await displayCopy(file,t));
  checkpoint();const node=grid()??create();prepareViewer(doc,node,path());layoutCSS();
  for(const picture of copies){
   const figure=doc.createElement('figure'),a=doc.createElement('a'),image=doc.createElement('img');
   image.alt='';image.loading='lazy';image.src=a.href=relative(path(),picture.name);a.dataset.galleryImage='';a.setAttribute('aria-haspopup','dialog');
   a.append(image);figure.append(a);node.append(figure);pending.set(picture.name,picture);
  }
  offset=Math.floor((current().length-copies.length)/pageSize)*pageSize;update(doc);render();
 }
 function view(){
  const list=galleryList(doc),node=grid(),items=current();
  const choices=list.map((g,i)=>'<option value="'+i+'" '+(i===index?'selected':'')+'>'+esc((g.parentElement.querySelector('h1,h2,h3')?.textContent||t('gallery'))+' ('+(i+1)+')')+'</option>').join('');
  const rows=items.slice(offset,offset+pageSize).map((figure,j)=>{
   const i=offset+j,image=figure.querySelector('img'),src=image.getAttribute('src'),thumb=pending.get(publicName(src,path()))?.preview??new URL(src,url(path())).href;
   const id='data-image-index="'+i+'"';
   return '<li '+id+' draggable="true"><img loading="lazy" alt="" src="'+esc(thumb)+'"><label>'+esc(t('altText'))+'<input data-gallery-field="alt" '+id+' value="'+esc(image.alt)+'"></label><label>'+esc(t('caption'))+'<input data-gallery-field="caption" '+id+' value="'+esc(figure.querySelector('figcaption')?.textContent??'')+'"></label><div>'+button('up','up',id+(i?'':' disabled'))+button('down','down',id+(i===items.length-1?' disabled':''))+button('remove','remove',id)+'</div></li>';
  }).join('');
  const columns=/gallery-columns-([1-4])/.exec(node?.className??'')?.[1]??'3';
  return '<section class="panel website-gallery-editor"><h2>'+esc(t('gallery'))+'</h2><div class="website-files-toolbar">'+(choices?'<label>'+esc(t('gallery'))+' <select data-gallery-choose>'+choices+'</select></label>':'')+button('newGallery','new')+button('closePreview','close')+'</div>'+
   (node?'<label>'+esc(t('columns'))+' <select data-gallery-columns>'+[1,2,3,4].map(n=>'<option '+(n===Number(columns)?'selected':'')+'>'+n+'</option>').join('')+'</select></label>':'')+
   '<label class="website-gallery-drop">'+esc(t('addImages'))+' <input type="file" data-gallery-files multiple accept="image/png,image/jpeg,image/webp,image/gif,image/avif"></label>'+
   '<ol class="website-gallery-items">'+rows+'</ol>'+button('prevPage','prev',offset?'':'disabled')+button('nextPage','next',offset+pageSize<items.length?'':'disabled')+'</section>';
 }
 function bind(){
  const host=document.querySelector('.website-gallery-editor');if(!host)return;
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
  if(el.matches('[data-gallery-choose]')){index=Number(el.value);offset=0;render();return true;}
  if(el.matches('[data-gallery-columns]')){
   const node=grid();checkpoint();node.classList.remove(...Array.from(node.classList).filter(c=>/^gallery-columns-\d+$/.test(c)));node.classList.add('gallery-columns-'+Number(el.value));layoutCSS();update(doc);return true;
  }
  const field=el.dataset.galleryField;if(!field)return false;
  const item=current()[Number(el.dataset.imageIndex)];if(!item)return true;
  if(field==='alt'&&item.querySelector('img').alt!==el.value){checkpoint(false);item.querySelector('img').alt=el.value;}
  if(field==='caption'){let caption=item.querySelector('figcaption');if((caption?.textContent??'')===el.value)return true;checkpoint(false);if(el.value){if(!caption){caption=doc.createElement('figcaption');item.append(caption);}caption.textContent=el.value;}else caption?.remove();}
  update(doc);return true;
 }
 function action(op,el){
  if(op==='new'){checkpoint();create();update(doc);}
  else if(op==='prev'||op==='next'){offset=Math.max(0,offset+(op==='prev'?-pageSize:pageSize));}
  else{const items=current(),i=Number(el.dataset.imageIndex),item=items[i];if(!item)return;checkpoint();
   if(op==='remove')item.remove();else if(op==='up')items[i-1]?.before(item);else if(op==='down')items[i+1]?.after(item);
   offset=Math.min(offset,Math.floor(Math.max(0,current().length-1)/pageSize)*pageSize);update(doc);
  }
  render();
 }
 function body(data){
  if(!pending.size)return null;
  const used=new Set(Array.from(read().querySelectorAll('img[src]'),image=>publicName(image.getAttribute('src'),data.path)));
  const pictures=[...pending.values()].filter(item=>used.has(item.name));if(!pictures.length)return null;
  const control=new TextEncoder().encode(JSON.stringify({...data,pictures:pictures.map(({name,blob})=>({name,size:blob.size}))}));
  const size=new DataView(new ArrayBuffer(4));size.setUint32(0,control.length);return new Blob([size,control,...pictures.map(p=>p.blob)]);
 }
 function paint(canvas){for(const image of canvas.querySelectorAll('img[src]')){const src=image.getAttribute('src'),picture=pending.get(publicName(src,path()));if(picture){image.dataset.observandaEditorImage=src;image.src=picture.preview;}}}
 return {open,view,bind,action,input,body,paint,reset,acknowledged,trimHistory,hasPending:name=>pending.has(name)};
}

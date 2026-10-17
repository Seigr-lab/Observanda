import {websiteSnapshot} from './website-context.js';
import {websiteDocumentMedia} from './website-document-media.js';
import {ownedAssetURL} from './project-context.js';
import {websiteFileDetails} from './website-download-ui.js';
import {t} from './i18n/index.js';
import {inventoryWindow,websiteMediaItems,websiteMediaItem,websiteAssetUsed,MEDIA_WINDOW} from './website-inventory.js';
const tr=(key,values)=>t('websiteMedia',key,values);

export function websiteMediaUI({state,esc,field,option,showDialog,render,sections,checkpoint,changed,notify,research,researchMedia,documents}){
 let context=null,query='',kind='all',offset=0,galleryId=null,galleryQuery='',galleryOffset=0,orderOffset=0,session=null;
 const identity=()=>JSON.stringify([state.book?.id,websiteSnapshot(state),documents?.enabled()?documents.viewKey():null]);
 const native=websiteDocumentMedia({state,documents,onChange:event=>{
  if(state.page!=='website')return;
  if(session&&valid(session)){if(event.type==='window'&&session.page?.key===event.key)session.paint();return;}
  const attribute=event.type==='window'?'data-native-media-window':'data-native-media-selected';
  if([...document.querySelectorAll('['+attribute+']')].some(node=>node.getAttribute(attribute)===event.key))redraw();
 }});
 const button=(key,extra='')=>`<button type="button" class="button" data-action="website-media-${key}" ${extra}>${esc(tr(key))}</button>`;
 const range=page=>page.pending?esc(tr('loading')):page.error?esc(tr('loadFailed')):page.total?esc(tr('range',{first:page.offset+1,last:page.offset+page.items.length,total:page.total})):esc(tr('empty'));
 const pager=(page,scope)=>`<div class="inline-actions inventory-pager" data-media-pager="${scope}">${button('previous',`data-inventory="${scope}" ${page.previous===null?'disabled':''}`)}<span role="status">${range(page)}</span>${button('next',`data-inventory="${scope}" ${page.next===null?'disabled':''}`)}</div>`;
 function sync(){native.sync();if(context!==identity()){context=identity();query='';kind='all';offset=0;galleryId=null;galleryQuery='';galleryOffset=0;orderOffset=0;}if(session&&(!valid(session)||state.page!=='website'))close();}
 function redraw(focus){
  const active=document.activeElement,selection=typeof active?.selectionStart==='number'?[active.selectionStart,active.selectionEnd,active.selectionDirection]:null;
  const attrs=active?[...active.attributes].filter(a=>a.name.startsWith('data-')||a.name==='name'):[];
  const selector=focus??(active?.id?'#'+CSS.escape(active.id):attrs.length?active.tagName.toLowerCase()+attrs.map(a=>'['+a.name+'="'+CSS.escape(a.value)+'"]').join(''):null);
  render();const el=active?.isConnected&&!focus?active:selector?document.querySelector(selector):null;el?.focus({preventScroll:true});if(selection&&typeof el?.selectionStart==='number')el.setSelectionRange(...selection);
 }
 const windowMarker=page=>page.key?'data-native-media-window="'+esc(page.key)+'"':'';
 function selected(id){return native.enabled()?native.selection(id):{pending:false,item:websiteMediaItem(state.book,id)};}
 function windowFor(options={},position=0,search=''){if(native.enabled()&&!options.research)return native.window(options,position,search);return inventoryWindow(websiteMediaItems(state.book,options),{offset:position,query:search});}
 const picture=item=>item.asset.kind==='image'?`<img src="${esc(ownedAssetURL(state,'/api/media/'+item.asset.id))}" alt="" loading="lazy">`:`<span class="muted">${esc(tr(item.asset.kind))}</span>`;
 function selector(section,{research=false,images=false,files=false,label=tr('website'),empty=tr('choose')}={}){
  if(research&&state.workspaceOutline)return `<div class="field"><label>${esc(label)}</label><button type="button" class="button" data-action="website-research-media" data-section="${section.id}">${esc(tr('chooseResearch'))}</button></div>`;
  const key=research?section.entryId+':'+section.attachmentId:section.assetId;if(native.enabled()&&!research)native.ensure([key]);const selected=key?websiteMediaItem(state.book,key,{research}):null;
  const page=windowFor({research,kind:files?'file':images?'image':'media'}),items=page.items;
  if(selected&&!items.some(item=>item.key===key))items.unshift(selected);
  const attrs=`${windowMarker(page)} ${native.enabled()&&!research&&key?`data-native-media-selected="${esc(key)}"`:""} data-website-media-select="${section.id}" data-media-source="${research?'research':files?'file':images?'image':'media'}"`;
  return field(label,`<select ${attrs}>${option('',selected?empty:key?tr('selectedMissing'):empty,selected?key:'')}${items.map(item=>option(item.key,item.label,key)).join('')}${page.next!==null||native.enabled()&&!research?option('find',tr('find'),key):''}</select>`);
 }
 function library(){sync();const page=windowFor({kind},offset,query);offset=page.offset;
  return `<section class="panel" ${windowMarker(page)}><h2>${esc(tr('library'))}</h2>${field(tr('upload'),'<input type="file" data-upload="website-library" data-target="library" accept="image/*,audio/*,video/*">')}
   ${field(tr('uploadFile'),'<input type="file" data-upload="website-file-library" data-target="library">')}
   ${field(tr('search'),`<input type="search" id="website-media-search" maxlength="512" value="${esc(query)}">`)}${field(tr('kind'),`<select id="website-media-kind">${['all','image','audio','video','file'].map(value=>option(value,tr(value),kind)).join('')}</select>`)}
   <div class="website-media-library">${page.items.map(({asset:a})=>`<article data-library-asset="${a.id}">${a.kind==='file'?websiteFileDetails(a,esc)+`<a href="${esc(ownedAssetURL(state,'/api/media/'+a.id))}?context=${encodeURIComponent(state.storage?.contextId??'')}" download="${esc(a.name)}">${esc(tr('downloadOriginal'))}</a>`:a.kind==='image'?`<img src="${esc(ownedAssetURL(state,'/api/media/'+a.id))}" alt="${esc(a.alt)}" loading="lazy">`:`<${a.kind} src="${esc(ownedAssetURL(state,'/api/media/'+a.id))}" controls preload="none"></${a.kind}>`}${field(tr('caption'),`<input data-site-asset="${a.id}" data-key="caption" maxlength="1500" value="${esc(a.caption)}">`)}${field(tr('description'),`<textarea data-site-asset="${a.id}" data-key="alt" rows="2" maxlength="1500">${esc(a.alt)}</textarea>`)}${!native.enabled()&&websiteAssetUsed(state.book,a.id)?`<span class="muted">${esc(tr('used'))}</span>`:button('remove',`data-id="${a.id}"`)}</article>`).join('')}</div>${pager(page,'library')}${page.error?button('retry'):''}</section>`;
 }
 function gallery(section){sync();if(galleryId!==section.id){galleryId=section.id;galleryQuery='';galleryOffset=0;orderOffset=0;}
  const page=windowFor({kind:'image'},galleryOffset,galleryQuery);galleryOffset=page.offset;
  const ordered=inventoryWindow(section.assetIds,{offset:orderOffset});orderOffset=ordered.offset;if(native.enabled())native.ensure(ordered.items);
  return `<label class="checkbox"><input type="checkbox" data-home-section="${section.id}" data-key="viewer" ${section.viewer!==false?'checked':''}> ${esc(tr('viewer'))}</label><p class="muted">${esc(tr('viewerHelp'))}</p>${field(tr('columns'),`<select data-home-section="${section.id}" data-key="columns">${[2,3,4].map(n=>option(String(n),String(n),String(section.columns))).join('')}</select>`)}${field(tr('search'),`<input type="search" id="website-gallery-search" maxlength="512" value="${esc(galleryQuery)}">`)}
   <fieldset ${windowMarker(page)}><legend>${esc(tr('gallery'))}</legend><div class="gallery-picker">${page.items.map(item=>`<label>${picture(item)}<input type="checkbox" data-gallery-asset="${section.id}" value="${item.key}" ${section.assetIds.includes(item.key)?'checked':''}><span>${esc(item.label)}</span></label>`).join('')}</div>${pager(page,'gallery')}</fieldset>
   ${section.assetIds.length?`<h3>${esc(tr('selected',{count:section.assetIds.length}))}</h3><ol class="gallery-order" start="${ordered.offset+1}">${ordered.items.map((id,i)=>{const name=websiteMediaItem(state.book,id)?.label??tr('selectedMissing'),index=ordered.offset+i;return `<li data-native-media-selected="${esc(id)}"><span>${esc(name)}</span>${button('up',`data-id="${section.id}" data-index="${index}" aria-label="${esc(tr('moveUp',{name}))}" ${index===0?'disabled':''}`)}${button('down',`data-id="${section.id}" data-index="${index}" aria-label="${esc(tr('moveDown',{name}))}" ${index===section.assetIds.length-1?'disabled':''}`)}</li>`;}).join('')}</ol>${pager(ordered,'order')}`:''}`;
 }
 const valid=s=>s===session&&s.identity===identity()&&s.etag===state.etag&&state.page==='website'&&!state.access?.locked&&!state.storageUnavailable&&s.root.isConnected;
 function close(){const s=session;session=null;s?.unbind();if(s?.dialog.open)s.dialog.close();s?.root.replaceChildren();if(s)document.querySelector(s.focus)?.focus({preventScroll:true});}
 function open(options,focus,choose){
  close();showDialog(`<h2 id="dialog-title">${esc(tr(options.research?'chooseResearch':'choose'))}</h2><div data-website-media-picker>${options.research?`<p>${esc(tr('chooseHelp'))}</p>`:''}${field(tr('search'),'<input id="website-media-picker-search" type="search" maxlength="512">')}<div data-media-results></div><div class="dialog-actions">${button('cancel')}</div></div>`);
  const root=document.querySelector('[data-website-media-picker]'),dialog=root.closest('dialog');
  const s=session={root,dialog,identity:identity(),etag:state.etag,focus,offset:0,search:'',choose,options};
  function paint(){if(!valid(s))return;const page=windowFor(options,s.offset,s.search);s.offset=page.offset;s.page=page;
   root.querySelector('[data-media-results]').innerHTML=`<ul class="website-media-results">${page.items.map(item=>`<li><button type="button" class="button" data-choose-media="${item.key}">${picture(item)}<span>${esc(item.label)}</span></button></li>`).join('')}</ul>${pager(page,'picker')}`;
  }
  const click=event=>{const control=event.target.closest('[data-choose-media],[data-action]');if(!control||!root.contains(control))return;event.preventDefault();event.stopPropagation();if(!valid(s))return;
   if(control.dataset.action==='website-media-cancel'){close();return;}
   if(control.dataset.chooseMedia){const item=s.page.items.find(item=>item.key===control.dataset.chooseMedia);if(item){close();s.choose(item.key);document.querySelector(focus)?.focus({preventScroll:true});}return;}
   if(control.dataset.inventory==='picker'){const next=control.dataset.action.endsWith('previous')?s.page.previous:s.page.next;if(next!==null){s.offset=next;paint();root.querySelector('[data-choose-media]')?.focus();}}
  };
  const input=event=>{if(event.target.id==='website-media-picker-search'){event.stopPropagation();s.search=event.target.value;s.offset=0;paint();}};
  const keydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}else if(event.key==='Enter'&&event.target.id==='website-media-picker-search')event.preventDefault();};
  const cancel=event=>{event.preventDefault();event.stopImmediatePropagation();close();},closed=()=>{if(!dialog.open&&session===s)close();};
  root.addEventListener('click',click);root.addEventListener('input',input);root.addEventListener('keydown',keydown);dialog.addEventListener('cancel',cancel,true);dialog.addEventListener('close',closed);
  s.unbind=()=>{root.removeEventListener('click',click);root.removeEventListener('input',input);root.removeEventListener('keydown',keydown);dialog.removeEventListener('cancel',cancel,true);dialog.removeEventListener('close',closed);};s.paint=paint;paint();root.querySelector('input').focus();
 }
 function input(el){
  if(el.id==='website-media-search'||el.id==='website-media-kind'){if(el.id.endsWith('search'))query=el.value;else kind=el.value;offset=0;redraw('#'+el.id);return true;}
  if(el.id==='website-gallery-search'){galleryQuery=el.value;galleryOffset=0;redraw('#'+el.id);return true;}
  if(el.dataset.websiteMediaSelect){const section=sections().find(s=>s.id===el.dataset.websiteMediaSelect);if(!section)return true;
   const research=el.dataset.mediaSource==='research',options={research,kind:['image','file','media'].includes(el.dataset.mediaSource)?el.dataset.mediaSource:'all'},focus='[data-website-media-select="'+section.id+'"]';
   const choose=key=>{const current=sections().find(s=>s.id===section.id);const picked=key?websiteMediaItem(state.book,key,{research}):null;if(!current||key&&(!picked||options.kind!=='all'&&(options.kind==='media'?picked.asset.kind==='file':picked.asset.kind!==options.kind)))return;if(research&&!key)return;checkpoint();if(research)[current.entryId,current.attachmentId]=key.split(':');else current.assetId=key||null;changed(true);};
   if(el.value==='find'){el.value=research?section.entryId+':'+section.attachmentId:section.assetId??'';open(options,focus,choose);}else choose(el.value);return true;
  }
  if(el.dataset.galleryAsset){const section=sections().find(s=>s.id===el.dataset.galleryAsset);if(!section)return true;
   checkpoint();if(el.checked&&!section.assetIds.includes(el.value))section.assetIds.push(el.value);else if(!el.checked)section.assetIds=section.assetIds.filter(id=>id!==el.value);changed(true);return true;
  }
  return false;
 }
 async function action(el){const name=el.dataset.action;if(!name?.startsWith('website-media-'))return false;
  if(name==='website-media-retry'){native.clear();redraw();return true;}
  if(name==='website-media-remove'){
   if(native.enabled()){
    try{await documents.perform([{type:'asset-remove',key:el.dataset.id}]);}catch(error){if(error.code==='INVALID')throw Error(tr('inUse'));throw error;}
    native.clear();redraw();return true;
   }
   if(websiteAssetUsed(state.book,el.dataset.id))throw Error(tr('inUse'));checkpoint();state.book.website.assets=state.book.website.assets.filter(a=>a.id!==el.dataset.id);changed(true);return true;
  }
  if(['website-media-up','website-media-down'].includes(name)){const section=sections().find(s=>s.id===el.dataset.id),index=Number(el.dataset.index),next=index+(name.endsWith('up')?-1:1);if(!section||next<0||next>=section.assetIds.length)return true;checkpoint();[section.assetIds[index],section.assetIds[next]]=[section.assetIds[next],section.assetIds[index]];orderOffset=Math.floor(next/MEDIA_WINDOW)*MEDIA_WINDOW;changed(true);return true;}
  if(!['website-media-previous','website-media-next'].includes(name))return false;
  const scope=el.dataset.inventory,step=name.endsWith('previous')?-MEDIA_WINDOW:MEDIA_WINDOW;
  if(scope==='library')offset=Math.max(0,offset+step);else if(scope==='gallery')galleryOffset=Math.max(0,galleryOffset+step);else if(scope==='order')orderOffset=Math.max(0,orderOffset+step);else return false;
  redraw('[data-media-pager="'+scope+'"] button:not(:disabled)');return true;
 }
 function uploaded(id){query='';kind='all';if(native.enabled()){native.clear();offset=Math.floor(Math.max(0,documents.count('assets')-1)/MEDIA_WINDOW)*MEDIA_WINDOW;return;}const index=state.book.website.assets.findIndex(a=>a.id===id);offset=Math.floor(Math.max(0,index)/MEDIA_WINDOW)*MEDIA_WINDOW;}
 return {library,gallery,selector,selected,input,action,sync,uploaded};
}

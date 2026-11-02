// The library supplies permission-checked visual references. Website authors can
// arrange those references without copying research files into upload storage.
export function websiteSourceGallery({request,site,t,esc,render,changed,adopt,leave,signal,notify}){
 let draft=null,base=null,entry=null,choices=[],offset=0,orderPage=0,next=null,modified=false,epoch=0,requestGeneration=null;
 const same=(a,b)=>a.sourceId===b.sourceId&&a.key===b.key;
 function reset(){epoch++;draft=base=entry=null;choices=[];offset=orderPage=0;next=requestGeneration=null;modified=false;}
 function suspend(){epoch++;entry=null;choices=[];offset=0;next=requestGeneration=null;}
 function mark(){modified=true;changed(true);}
 const button=(key,op,attrs='')=>'<button type="button" class="button" data-action="website-files-figures-'+op+'" '+attrs+'>'+esc(t(key))+'</button>';
 const pin=()=>({siteId:site().site.id,expectedRevision:site().site.revision,path:site().path});
 async function open(id=null){
  reset();const version=epoch;
  const value=id?await request('gallery/source-read',{...pin(),galleryId:id},{signal:signal()}):{galleryId:null,heading:'',columns:2,items:[]};
  if(version!==epoch)return false;
  draft=value;base=structuredClone(value);return true;
 }
 async function load(source,start=0){
  if(!draft)await open();
  if(!draft)return false;
  const version=++epoch;
  entry=null;choices=[];next=null;offset=0;requestGeneration=null;
  render();
  const data=await request('library/gallery-items',{sourceId:source.id,sourceRevision:source.revision,offset:start,limit:12},{signal:signal()});
  if(version!==epoch||!draft)return false;
  entry=source;offset=start;next=data.next;
  choices=data.items.map(item=>({...item,sourceId:source.id,sourceRevision:source.revision}));return true;
 }
 function thumb(item,includeSource=false){
  if(item.unavailable)return '<p class="website-gallery-withheld">'+esc(t('galleryUnavailable'))+'</p>';
  const kind=t(item.kind==='graph'?'galleryGraph':'galleryPhoto'),caption=(item.captionOverride??item.caption)||(item.altOverride??item.alt)||'';
  return '<figure><img loading="lazy" decoding="async" src="'+esc(item.previewUrl)+'" alt="'+esc(item.altOverride??item.alt??'')+'"><figcaption><small>'+
   esc(includeSource&&item.sourceTitle?kind+' · '+item.sourceTitle:kind)+'</small><span>'+esc(caption)+'</span></figcaption></figure>';
 }
 function view(library){
  if(!draft)return '';
  const available=choices.map((item,i)=>{
   const chosen=draft.items.some(row=>same(row,item));
   return '<li>'+thumb(item)+button(chosen?'galleryIncluded':'galleryInclude','add','data-index="'+i+'" '+(chosen?'disabled':''))+'</li>';
  }).join('');
  orderPage=Math.min(orderPage,Math.floor(Math.max(0,draft.items.length-1)/12));
  const start=orderPage*12;
  const ordered=draft.items.slice(start,start+12).map((item,j)=>{
   const i=start+j;
   return '<li draggable="true" data-figure-order="'+i+'">'+thumb(item,true)+'<div>'+
    '<label>'+esc(t('galleryPosition'))+'<input type="number" min="1" max="'+draft.items.length+'" value="'+(i+1)+'" data-figure-position></label>'+
    button('galleryMove','move','data-index="'+i+'"')+button('up','up','data-index="'+i+'" '+(!i?'disabled':''))+
    button('down','down','data-index="'+i+'" '+(i+1===draft.items.length?'disabled':''))+button('remove','remove','data-index="'+i+'"')+'</div>'+
    (item.unavailable?'':'<details><summary>'+esc(t('galleryDescription'))+'</summary>'+['alt','caption'].map(key=>{
     const value=item[key+'Override']??item[key]??'';
     return '<label>'+esc(t(key==='alt'?'altText':'caption'))+'<textarea data-figure-text="'+key+'" maxlength="'+(key==='alt'?1500:4000)+'">'+esc(value)+'</textarea></label>'+
      button('gallerySourceText','inherit','data-field="'+key+'" data-index="'+i+'" '+(item[key+'Override']==null?'disabled':''));
    }).join('')+'</details>')+'</li>';
  }).join('');
  return '<section class="website-source-gallery panel"><header><h2>'+esc(t('galleryChooseFigures'))+'</h2>'+button('cancel','close')+'</header>'+
   '<div class="website-gallery-panes"><section tabindex="0" aria-labelledby="gallery-source-list"><h3 id="gallery-source-list">'+esc(t('galleryFromEntries'))+'</h3>'+library+
   (entry?'<h4>'+esc(entry.title)+'</h4>'+(choices.length?'<ul class="website-figure-choices">'+available+'</ul>':'<p>'+esc(t('galleryNoFigures'))+'</p>')+
    (offset||next!=null?'<nav>'+button('prevPage','prev',offset?'':'disabled')+button('nextPage','next',next!=null?'':'disabled')+'</nav>':''):'')+
   '</section><section tabindex="0" aria-labelledby="gallery-page-list"><h3 id="gallery-page-list">'+esc(t('galleryOnPage'))+'</h3><label>'+esc(t('galleryHeading'))+'<input data-figure-heading maxlength="200" value="'+esc(draft.heading)+'"></label>'+
   '<label>'+esc(t('columns'))+'<select data-figure-columns>'+[1,2,3,4,5,6].map(n=>'<option '+(n===draft.columns?'selected':'')+'>'+n+'</option>').join('')+'</select></label>'+
   (ordered?'<ol class="website-figure-order" start="'+(start+1)+'">'+ordered+'</ol>':'<p>'+esc(t('galleryChooseHelp'))+'</p>')+
   (draft.items.length>12?'<nav>'+button('prevPage','orderprev',orderPage?'':'disabled')+button('nextPage','ordernext',start+12<draft.items.length?'':'disabled')+'</nav>':'')+'</section></div><footer>'+
   button(draft.galleryId&&!draft.items.length?'galleryDelete':'galleryApply','apply',(draft.items.length||draft.galleryId)&&modified?'':'disabled')+'</footer></section>';
 }
 function input(el){
  if(!draft)return false;
  if(el.matches('[data-figure-heading]'))draft.heading=el.value;
  else if(el.matches('[data-figure-columns]'))draft.columns=Number(el.value);
  else if(el.matches('[data-figure-text]')){
   const row=el.closest('[data-figure-order]'),item=draft.items[Number(row.dataset.figureOrder)],key=el.dataset.figureText;
   if(!item||!['alt','caption'].includes(key))return false;
   item[key+'Override']=el.value;
   if(key==='alt')row.querySelector('img').alt=el.value;else row.querySelector('figcaption span').textContent=el.value;
   row.querySelector('[data-field="'+key+'"]').disabled=false;
  }
  else return false;
  mark();const save=el.closest('.website-source-gallery')?.querySelector('[data-action="website-files-figures-apply"]');
  if(save)save.disabled=!draft.items.length&&!draft.galleryId;return true;
 }
 function move(from,to){
  if(!draft?.items[from]||!draft.items[to]||from===to)return;
  const [item]=draft.items.splice(from,1);draft.items.splice(to,0,item);orderPage=Math.floor(to/12);mark();render();
  document.querySelector('[data-figure-order="'+to+'"] [data-figure-position]')?.focus();
 }
 function bind(){
  const list=document.querySelector('.website-figure-order');if(!list)return;
  let from=null;
  list.ondragstart=e=>{const row=e.target.closest('[data-figure-order]');if(!row)return;from=Number(row.dataset.figureOrder);e.dataTransfer.setData('application/x-observanda-gallery-order',String(from));e.dataTransfer.effectAllowed='move';};
  list.ondragover=e=>{if(from!==null)e.preventDefault();};
  list.ondrop=e=>{const row=e.target.closest('[data-figure-order]');if(from===null||!row)return;e.preventDefault();move(from,Number(row.dataset.figureOrder));from=null;};
  list.ondragend=()=>{from=null;};
 }
 async function action(op,el){
  if(!draft)return;
  const i=Number(el?.dataset.index);
  if(op==='apply'){
   const value=await request('gallery/source-save',{...pin(),galleryId:draft.galleryId,heading:draft.heading,columns:draft.columns,
    items:draft.items.map(({slotId,unavailable,key,sourceId,sourceRevision,altOverride,captionOverride})=>unavailable?{slotId,unavailable:true}:{slotId,key,sourceId,sourceRevision,altOverride,captionOverride})},{signal:signal()});
   reset();adopt(value);return leave();
  }
  if(op==='close'){if(!modified||confirm(t('discardConfirm'))){reset();changed(false);leave();}return;}
  if(op==='orderprev'||op==='ordernext'){orderPage=Math.max(0,orderPage+(op==='orderprev'?-1:1));render();return;}
  if(op==='move'){
   const field=el.closest('li').querySelector('[data-figure-position]');
   if(field.reportValidity()&&Number.isInteger(field.valueAsNumber))move(i,field.valueAsNumber-1);
   return;
  }
  if(op==='up'||op==='down')return move(i,i+(op==='up'?-1:1));
  if(op==='inherit'&&draft.items[i]&&['alt','caption'].includes(el.dataset.field)){
   const key=el.dataset.field,item=draft.items[i],row=el.closest('li');delete item[key+'Override'];
   const field=row.querySelector('[data-figure-text="'+key+'"]');field.value=item[key]??'';field.focus();
   if(key==='alt')row.querySelector('img').alt=field.value;else row.querySelector('figcaption span').textContent=field.value;
   mark();el.disabled=true;row.closest('.website-source-gallery').querySelector('[data-action="website-files-figures-apply"]').disabled=false;return;
  }
  if(op==='prev'||op==='next'){if(entry)await load(entry,op==='prev'?Math.max(0,offset-12):next);render();return;}
  if(op==='add'&&choices[i]&&!draft.items.some(row=>same(row,choices[i])))draft.items.push({...choices[i]});
  else if(op==='remove'&&draft.items[i])draft.items.splice(i,1);
  else return;
  const scroll=[...document.querySelectorAll('.website-gallery-panes>section')].map(el=>el.scrollTop);
  mark();render();
  const panes=document.querySelectorAll('.website-gallery-panes>section');
  panes.forEach((pane,j)=>{pane.scrollTop=scroll[j];});
  const controls=panes[op==='add'?0:1]?.querySelectorAll(op==='add'?'button[data-index]:enabled':'[data-figure-position]');
  (controls?.[Math.min(i,controls.length-1)]??panes[op==='add'?0:1])?.focus({preventScroll:true});
 }
 async function revalidate(){
  if(!draft)return;
  const version=epoch,refs=new Map();
  function include(id,revision){refs.set(id+'/'+revision,{id,revision});}
  for(const row of draft.items)if(!row.unavailable)include(row.sourceId,row.sourceRevision);
  if(entry)include(entry.id,entry.revision);
  const pins=[...refs.values()];
  let token;
  const denied=new Set(),seen=new Set();
  for(const {id} of pins){if(seen.has(id))denied.add(id);seen.add(id);}
  for(let i=0;i<pins.length;i+=40){
   const rows=pins.slice(i,i+40),result=await request('library/validate',{items:rows,generation:requestGeneration},{signal:signal()});
   if(version!==epoch||!draft)return;
   if(i&&result.generation!==token){
    const reason=Error(t('changedPageAccess'));reason.code='PUBLICATION_PERMISSIONS_CHANGED';throw reason;
   }
   const accepted=new Set(result.accepted);for(const {id} of rows)if(!accepted.has(id))denied.add(id);
   token=result.generation;
  }
  requestGeneration=token??null;
  if(denied.size){
   if(draft.items.some(row=>row.slotId&&denied.has(row.sourceId))){
    const reason=Error(t('changedPageAccess'));reason.code='PUBLICATION_PERMISSIONS_CHANGED';throw reason;
   }
   draft.items=draft.items.filter(row=>!denied.has(row.sourceId));
   if(denied.has(entry?.id))suspend();
   render();notify(t('galleryPermissionsUpdated'));
  }
 }
 // A research grant or an unrelated page save may advance the site revision
 // while the author is arranging figures. Recover only against current grants.
 async function recover(page){
  if(!draft)return;
  const version=epoch;
  if(draft.galleryId){
   const fresh=await request('gallery/source-read',{siteId:page.site.id,expectedRevision:page.site.revision,path:page.path,galleryId:draft.galleryId},{signal:signal()});
   if(!draft||version!==epoch)return;
   if(!modified){draft=fresh;base=structuredClone(fresh);}
   else{
    const oldOrder=base.items.map(row=>row.slotId),freshOrder=fresh.items.map(row=>row.slotId);
    const interferes=fresh.heading!==base.heading||fresh.columns!==base.columns||oldOrder.join()!==freshOrder.join();
    if(interferes){const reason=Error(t('galleryConcurrent'));reason.code='GALLERY_EDIT_CONFLICT';throw reason;}
    const original=new Map(base.items.map(row=>[row.slotId,row])),current=new Map(fresh.items.map(row=>[row.slotId,row]));
    draft.items=draft.items.map(local=>{
     if(!local.slotId)return local;
     const updated=current.get(local.slotId),prior=original.get(local.slotId);
     if(updated.unavailable||local.unavailable||local.sourceRevision!==updated.sourceRevision)return updated;
     const merged={...updated};
     for(const field of ['altOverride','captionOverride']){
      if(local[field]===prior[field])continue;
      if(updated[field]!==prior[field]&&updated[field]!==local[field]){const reason=Error(t('galleryConcurrent'));reason.code='GALLERY_EDIT_CONFLICT';throw reason;}
      merged[field]=local[field];
     }
     return merged;
    });
    base=structuredClone(fresh);
   }
  }
  await revalidate();
 }
 return {open,load,view,bind,action,input,reset,suspend,revalidate,recover,dirty:()=>modified,canSave:()=>Boolean(draft?.galleryId||draft?.items.length)};
}

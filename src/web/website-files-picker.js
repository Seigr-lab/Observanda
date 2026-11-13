import {language,t} from './i18n/index.js';
import {websitePickerView} from './website-files-picker-view.js';
import {websitePickerSaved} from './website-picker-saved.js';

const pageSize=12,facetSize=8,reviewLimit=40;
const facet=()=>({chosen:null,text:'',query:'',items:[],page:0,pages:[null],next:null,open:false,loading:false,loaded:false});
const defaults=()=>({search:'',searchField:'all',filter:'all',dateFrom:'',dateTo:'',dateKnowledge:'all',recordType:'',status:'',tagMode:'all',sort:'default'});
const initial=()=>({open:false,galleryOnly:false,filtersShown:true,fields:defaults(),criteria:defaults(),tags:[],owners:{project:facet(),book:facet(),tag:facet()},rows:[],page:0,pages:[null],next:null,
 queue:new Map(),item:null,detail:null,placements:null,tagOffset:0,sectionOffset:0,sectionPages:[0],placeOffset:0,placePages:[0],position:'end',block:1,confirm:null,
 status:'',loading:false,generation:null,token:null,totalEntries:null,preparation:null,pane:'detail',siteList:null,sitePage:0,sitePages:[null],usageSite:null});
export function websiteFilesPicker({request,esc,blocks,site,insert,insertMany,mutatePlacement,jumpPlacement,libraryStatus,onSourceGallery,choosingGallerySource,onPickerPaint,onPickerClose,workspaceOwners=null}){
 const msg=(key,args)=>t('websiteFiles',key,args);
 let s=initial(),epoch=0,controller=null,validating=false,types=null;
 const ownerRequests=new Map();
 const dialog=()=>document.querySelector('dialog[data-website-picker-dialog]');
 const siteArgs=()=>({siteId:site().site.id,expectedRevision:site().site.revision});
 function start(){
  controller?.abort();controller=new AbortController();
  return {number:++epoch,signal:controller.signal};
 }
 function cancelOwners(){for(const request of ownerRequests.values())request.abort();ownerRequests.clear();}
 function reset(){epoch++;controller?.abort();controller=null;cancelOwners();saved.reset();onPickerClose?.();dialog()?.close();s=initial();}
 function forgetDetails(){s.item=s.detail=s.placements=s.siteList=s.usageSite=null;s.confirm=null;s.tagOffset=s.sectionOffset=s.placeOffset=s.sitePage=0;s.sectionPages=[0];s.placePages=[0];s.sitePages=[null];}
 const criteria=()=>({...s.criteria,locale:language(),projectId:s.owners.project.chosen?.id??null,notebookId:s.owners.book.chosen?.id??null,tags:s.tags});
 const statusLabel=value=>value?t('recordViews','statusValues.'+value.replaceAll(' ','-')):'';
 const saved=websitePickerSaved({request,site,msg,esc,criteria:()=>{const {locale,...query}=criteria();return query;},paint,recall:async value=>{
  s.fields={...defaults(),...Object.fromEntries(Object.keys(defaults()).filter(k=>value[k]!=null).map(k=>[k,value[k]]))};s.criteria={...s.fields};s.tags=value.tags??[];
  s.owners={project:facet(),book:facet(),tag:facet()};s.filtersShown=true;
  if(value.projectId)s.owners.project.chosen={id:value.projectId};
  if(value.notebookId)s.owners.book.chosen={id:value.notebookId};
  s.pages=[null];await browse({focus:'[data-picker-search]'});
 }});
 const content=owner=>websitePickerView(s,{msg,esc,blocks,destination:site(),owner,types,statusLabel,saved,galleryAvailable:typeof onSourceGallery==='function'});
 function view(){
  return '<section class="panel website-files-picker" data-website-picker><h2>'+esc(msg('library'))+'</h2><p>'+esc(msg('libraryNotice'))+
   '</p><button type="button" class="button" data-action="website-files-picker-open">'+esc(msg('pickerBrowse'))+'</button>'+
   (s.open?'<dialog data-website-picker-dialog aria-labelledby="website-picker-title">'+content()+'</dialog>':'')+'</section>';
 }
 function focusWhenReady(el){
  if(!el)return;
  if(!el.matches(':disabled')){el.focus({preventScroll:true});return;}
  // The shell re-enables the workspace controls when the action settles.
  requestAnimationFrame(()=>{if(el.isConnected&&!el.matches(':disabled'))el.focus({preventScroll:true});});
 }
 function paint(focus){
  const host=document.querySelector('[data-website-picker]');if(!host)return;
  const current=dialog();let active=focus;
  if(!active&&current?.contains(document.activeElement)){
   const el=document.activeElement;
   const attr=[...el.attributes].filter(a=>a.name.startsWith('data-')).map(a=>'['+a.name+'="'+CSS.escape(a.value)+'"]').join('');
   if(attr)active=attr;
  }
  const scrollers=['.website-picker-detail','.website-picker-entry-list','.website-picker-queue','.website-picker-refinements'];
  const positions=scrollers.map(key=>current?.querySelector(key)?.scrollTop??0);
  if(current&&s.open){current.innerHTML=content();scrollers.forEach((key,i)=>{const target=current.querySelector(key);if(target)target.scrollTop=positions[i];});}else host.outerHTML=view();
  bind();if(active)focusWhenReady(dialog()?.querySelector(active));
 }
 function clearProtected(){
  cancelOwners();saved.reset();forgetDetails();s.rows=[];s.next=null;s.tags=[];s.queue.clear();s.token=s.generation=s.totalEntries=null;
  for(const f of Object.values(s.owners)){f.items=[];f.chosen=null;f.pages=[null];f.page=0;f.next=null;f.loaded=f.loading=false;}
 }
 function close(){
  reset();paint();focusWhenReady(document.querySelector('[data-action="website-files-picker-open"]'));
 }
 function bind(){
  const d=dialog();if(!s.open||!d)return;
  if(!document.head.querySelector('link[data-sheet="website-files-picker"]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/website-files-picker.css';link.dataset.sheet='website-files-picker';document.head.append(link);}
  if(!d.open)d.showModal();
  d.oncancel=e=>{e.preventDefault();close();};
  d.onchange=e=>{
   if(!e.target.matches('[data-picker-field="sort"]'))return;
   s.fields.sort=s.criteria.sort=e.target.value;s.pages=[null];
   void browse({facets:[],focus:'[data-picker-field="sort"]'}).catch(()=>{});
  };
  d.onclick=e=>{
   const summary=e.target.closest('[data-picker-facet] > summary');if(!summary)return;
   e.preventDefault();const details=summary.parentElement;
   details.open=!details.open;s.owners[details.dataset.pickerFacet].open=details.open;
   if(details.dataset.pickerFacet==='tag'&&details.open&&!s.owners.tag.loaded&&!s.owners.tag.loading&&s.token)void loadOwner('tag');
  };
  d.onkeydown=e=>{
   if(e.isComposing)return;
   const field=e.target;
   if(e.key==='Enter'&&field.matches('[data-picker-saved-query],[data-picker-saved-name]')){
    e.preventDefault();d.querySelector('[data-action="website-files-picker-saved-'+(field.hasAttribute('data-picker-saved-name')?'save':'find')+'"]')?.click();return;
   }
   if(e.key==='Enter'&&field.matches('[data-picker-search],[data-picker-facet-search]')){
    e.preventDefault();const op=field.dataset.pickerFacetSearch?'find-'+field.dataset.pickerFacetSearch:'search';
    d.querySelector('[data-action="website-files-picker-'+op+'"]').click();return;
   }
   if(field.matches('[data-action="website-files-picker-select"]')&&['ArrowUp','ArrowDown','Home','End'].includes(e.key)){
    const choices=[...d.querySelectorAll('[data-action="website-files-picker-select"]')],i=choices.indexOf(field);
    const index=e.key==='Home'?0:e.key==='End'?choices.length-1:Math.min(choices.length-1,Math.max(0,i+(e.key==='ArrowDown'?1:-1)));
    e.preventDefault();choices[index]?.focus();
   }
  };
  onPickerPaint?.(d);
 }
 async function collect(route,args,after,limit,job){
  const items=[],seen=new Set();let head;
  do{
   job.signal?.throwIfAborted();if(job.number!=null&&job.number!==epoch)throw new DOMException('Cancelled','AbortError');
   if(seen.has(after))throw Error(msg('failed'));seen.add(after);
   const data=await request(route,{...args,after,limit:limit-items.length},{signal:job.signal});
   if(head&&(head.visibilityToken!==data.visibilityToken||head.generation!==data.generation))throw Object.assign(Error(msg('changed')),{code:'WEBSITE_CHANGED'});
   head=data;items.push(...data.items);after=data.next;
  }while(after!=null&&items.length<limit);
  return {items,next:after??null,generation:head.generation,token:head.visibilityToken,totalEntries:head.totalEntries};
 }
 function paintOwner(kind){
  const current=dialog()?.querySelector('[data-picker-facet="'+kind+'"]');if(!current)return;
  const template=document.createElement('template');template.innerHTML=content(kind);
  const results=current.querySelector('[data-picker-owner-results]'),focus=document.activeElement;
  const action=results.contains(focus)?focus.dataset.action:null;
  current.querySelector('summary').textContent=template.content.querySelector('summary').textContent;
  results.replaceWith(template.content.querySelector('[data-picker-owner-results]'));
  if(action)focusWhenReady(current.querySelector('[data-action="'+CSS.escape(action)+'"]')??current.querySelector('summary'));
  if(Number.isSafeInteger(s.totalEntries))dialog().querySelector('[data-picker-total]').textContent=msg('pickerEligibleCount',{count:s.totalEntries.toLocaleString(document.documentElement.lang||undefined)});
 }
 async function loadOwner(kind,page=0){
  ownerRequests.get(kind)?.abort();const request=new AbortController();ownerRequests.set(kind,request);
  const f=s.owners[kind],projectId=s.owners.project.chosen?.id??null;
  f.loading=true;f.items=[];f.next=null;paintOwner(kind);
  try{
   const args=kind==='tag'?{criteria:{...criteria(),tags:s.criteria.tagMode==='any'?[]:s.tags}}:kind==='book'?{projectId}:{};
   if(kind==='tag')delete args.criteria.sort;
   const result=await collect('library/facets',{kind,search:f.query,...args},f.pages[page]??null,facetSize,{signal:request.signal});
   if(request.signal.aborted)return;
   if(result.token!==s.token||result.generation!==s.generation){await reloadPermissions();return;}
   f.loading=false;f.loaded=true;f.items=result.items;f.page=page;f.next=result.next;
   if(f.chosen)f.chosen=f.items.find(row=>row.id===f.chosen.id)??f.chosen;
   if(kind!=='tag'&&Number.isSafeInteger(result.totalEntries))s.totalEntries=result.totalEntries;
   paintOwner(kind);
  }catch(error){if(!request.signal.aborted){if(error.code==='WEBSITE_CHANGED')await reloadPermissions();else failHidden(error);}}
  finally{if(ownerRequests.get(kind)===request)ownerRequests.delete(kind);}
 }
 async function browse({entryPage=0,facets=['project','book'],focus}={}){
  const job=start();s.loading=true;s.status=msg('loading');s.rows=[];forgetDetails();s.next=null;
  for(const kind of facets){ownerRequests.get(kind)?.abort();s.owners[kind].loading=true;s.owners[kind].items=[];s.owners[kind].next=null;}
  paint(focus);
  try{
   const result=await collect('library/search',criteria(),s.pages[entryPage]??null,pageSize,job);
   if(job.number!==epoch)return;
   if(s.token&&(s.token!==result.token||s.generation!==result.generation))return reloadPermissions();
   s.generation=result.generation;s.token=result.token;s.rows=result.items;s.page=entryPage;s.next=result.next;
   const sample=s.rows[0];if(sample){
    for(const [kind,key] of [['project','project'],['book','notebook']]){
     const owner=s.owners[kind].chosen;if(owner&&!owner.title&&sample[key+'Id']===owner.id)owner.title=sample[key+'Title'];
    }
   }
   for(const row of s.rows)if(s.queue.has(row.id))s.queue.set(row.id,row);
   s.status='';s.loading=false;paint(focus);
   for(const kind of facets)void loadOwner(kind);
   if(s.owners.tag.open&&!s.owners.tag.loaded&&!s.owners.tag.loading)void loadOwner('tag');
  }catch(error){if(job.number===epoch){if(error.code==='WEBSITE_CHANGED')return reloadPermissions();failHidden(error);}if(error.name!=='AbortError')throw error;}
 }
 function failHidden(error){epoch++;controller?.abort();clearProtected();s.status=error.message||msg('changed');s.loading=false;paint();}
 function retainedQueue(rows,accepted){
  return new Map(rows.filter(row=>accepted.has(row.id)).map(({id,revision,title,recordId})=>[id,{id,revision,title,recordId}]));
 }
 async function reloadPermissions(){
  const job=start(),queued=[...s.queue.values()];clearProtected();s.loading=true;s.status=msg('pickerPermissionsChanged');paint();
  try{
   if(queued.length){
    const result=await request('library/validate',{items:queued.map(({id,revision})=>({id,revision})),generation:null},{signal:job.signal});
    if(job.number!==epoch)return;
    s.queue=retainedQueue(queued,new Set(result.accepted));s.token=result.visibilityToken;s.generation=result.generation;
   }
   await browse();
  }catch(error){if(job.number===epoch)failHidden(error);}
 }
 async function revalidate({signal}={}){
  if(!s.open||s.loading||validating)return;validating=true;const number=epoch;
  try{
   const items=[...new Map([...s.rows,...s.queue.values()].map(row=>[row.id,{id:row.id,revision:row.revision}])).values()];
   let token,first=true;const accepted=new Set();
   for(let i=0;i<Math.max(1,items.length);i+=40){
    const result=await request('library/validate',{items:items.slice(i,i+40),generation:s.generation},{signal});
    if(number!==epoch)return;
    if(!first&&token!==result.visibilityToken)throw Error(msg('changed'));first=false;token=result.visibilityToken;
    for(const id of result.accepted)accepted.add(id);
   }
   if(token!==s.token||items.some(row=>!accepted.has(row.id))){
    const retained=retainedQueue([...s.queue.values()],accepted);
    clearProtected();s.queue=retained;s.status=msg('pickerPermissionsChanged');paint();
    await browse();
   }else if((s.pane==='sites'||s.pane==='uses')&&s.siteList&&s.item)await listSites(s.sitePage,{number,signal},true);
  }catch(error){
   if(number===epoch)failHidden(error);
   if(error.name==='AbortError'||error.code==='AUTH'||error.code==='ACCESS_LOCKED')throw error;
  }
  finally{validating=false;}
 }
 function guarded(value){
  if(!s.token||value.visibilityToken!==s.token)throw Error(msg('changed'));
  return value;
 }
 async function listSites(page,job=start(),poll=false){
  const item=s.item,after=s.sitePages[page]??null;
  const data=await collect('library/sites',{sourceId:item.id,sourceRevision:item.revision},after,facetSize,job);
  if(job.number!==epoch)return;
  if(s.token!==data.token)throw Error(msg('changed'));
  if(poll&&s.siteList.next===data.next&&s.siteList.items.length===data.items.length&&s.siteList.items.every((row,i)=>row.siteId===data.items[i].siteId&&row.revision===data.items[i].revision))return;
  s.siteList=data;s.sitePage=page;
  if(s.usageSite){
   const fresh=data.items.find(row=>row.siteId===s.usageSite.siteId)??null;
   if(fresh?.revision!==s.usageSite.revision){s.usageSite=fresh;s.placeOffset=0;s.placePages=[0];await details(item,{part:'places',sectionOffset:s.sectionOffset});return;}
  }
  paint();
 }
 async function details(row,{sectionOffset=0,placeOffset=0,part='both',focus}={}){
  const job=start(),args={sourceId:row.id,sourceRevision:row.revision};
  const changedEntry=s.item?.id!==row.id;if(changedEntry)forgetDetails();
  try{
   const [preview,locations]=await Promise.all([
    part==='places'?null:request('library/preview',{...args,sectionAfter:sectionOffset},{signal:job.signal}),
    part==='sections'||s.galleryOnly?null:request('library/placements',{...(s.usageSite?{siteId:s.usageSite.siteId,expectedRevision:s.usageSite.revision}:{...siteArgs(),path:site().path}),...args,offset:placeOffset,limit:pageSize},{signal:job.signal})
   ]);
   if(preview?.metadata?.recordType){
    const {recordTypeLabel}=await import('./record-type-presentation.js');
    preview.displayType=recordTypeLabel(preview.metadata.recordType);
   }
   if(preview?.metadata?.status)preview.displayStatus=statusLabel(preview.metadata.status);
   if(job.number!==epoch)return;
   if(preview)s.detail=guarded(preview);if(locations)s.placements=guarded(locations);
   s.item=row;s.confirm=null;s.sectionOffset=sectionOffset;s.placeOffset=placeOffset;s.status='';paint(focus);
   if(changedEntry)dialog()?.querySelector('.website-picker-detail')?.scrollTo(0,0);
  }catch(error){if(job.number===epoch)failHidden(error);if(error.name!=='AbortError')throw error;}
 }
 function input(el){
  if(saved.input(el))return true;
  if(el.matches('[data-picker-batch-presentation]')){s.batchPresentation=el.value==='card'?'card':'full';paint('[data-picker-batch-presentation]');}
  else if(el.matches('[data-picker-search]'))s.fields.search=el.value;
  else if(el.matches('[data-picker-facet-search]'))s.owners[el.dataset.pickerFacetSearch].text=el.value;
  else if(el.matches('[data-picker-field]')&&Object.hasOwn(s.fields,el.dataset.pickerField))s.fields[el.dataset.pickerField]=el.value;
  else if(el.matches('[data-picker-position]')){s.position=el.value;s.block=1;paint('[data-picker-position]');}
  else if(el.matches('[data-picker-block]')){s.block=el.valueAsNumber;const n=dialog()?.querySelector('[data-picker-block-label]');if(n)n.textContent=blocks()[s.block-1]??'';}
  else if(el.matches('[data-picker-check]')){
   const row=s.rows.find(r=>r.id===el.dataset.pickerCheck);if(row){if(el.checked)add([row]);else s.queue.delete(row.id);if(!s.queue.size)s.pane='detail';paint();}
  }else return false;
  return true;
 }
 function add(items){
  if(new Set([...s.queue.keys(),...items.map(r=>r.id)]).size>reviewLimit){s.status=msg('pickerBatchLimit',{count:reviewLimit});return;}
  if(!s.queue.size)s.batchPresentation='full';
  for(const row of items)s.queue.set(row.id,row);s.pane='queue';s.status='';
 }
 function position(){
  if(s.position!=='before')return s.position;
  if(!Number.isInteger(s.block)||s.block<1||s.block>blocks().length)throw Error(msg('pickerBlockNumber'));
  return {before:s.block-1};
 }
 function showPane(pane,action){
  s.pane=pane;paint('[data-action="website-files-picker-'+action+'"]');
  dialog()?.querySelector('.website-picker-detail')?.scrollTo(0,0);
 }
 function invalidateTags(){
  ownerRequests.get('tag')?.abort();const f=s.owners.tag;
  f.loaded=f.loading=false;f.items=[];f.next=null;f.pages=[null];f.page=0;
 }
 async function refreshResults(facets=[],focus){
  invalidateTags();s.pages=[null];await browse({facets,focus});
 }
 async function applyFilters(){
  for(const input of dialog()?.querySelectorAll('input[type="date"]')??[])if(!input.reportValidity())return;
  const {dateFrom,dateTo,dateKnowledge}=s.fields;
  if(dateKnowledge!=='unknown'&&dateFrom&&dateTo&&dateFrom>dateTo){s.status=msg('pickerInvalidDates');paint('[data-picker-field="dateTo"]');return;}
  if(dateKnowledge==='unknown')s.fields.dateFrom=s.fields.dateTo='';
  s.criteria={...s.fields,search:s.fields.search.trim()};await refreshResults();
 }
 async function actFacet(op,kind,el){
  const f=s.owners[kind];
  if(op==='find'){f.open=true;f.query=f.text.trim();f.pages=[null];void loadOwner(kind);return;}
  if(op==='next'||op==='previous'){
   f.open=true;if(op==='next'){if(!f.next)return;f.pages[f.page+1]=f.next;}
   void loadOwner(kind,Math.max(0,f.page+(op==='next'?1:-1)));return;
  }
  const row=op==='choose'?f.items[Number(el.dataset.index)]:null;if(op==='choose'&&!row)return;
  if(kind==='tag'){
   if(row)await toggleTag(row.id,'[data-picker-facet="tag"] > summary');return;
  }
  f.chosen=row;f.open=false;
  if(kind==='project'){s.owners.book=facet();}
  else if(row?.projectId&&s.owners.project.chosen?.id!==row.projectId)s.owners.project.chosen={id:row.projectId,title:row.projectTitle??null};
  await refreshResults(kind==='project'?['book']:[], '[data-picker-facet="'+kind+'"] > summary');
 }
 async function toggleTag(tag,focus){
  s.tags=s.tags.includes(tag)?s.tags.filter(id=>id!==tag):[...s.tags,tag];
  if(!s.tags.length)s.fields.tagMode=s.criteria.tagMode='all';
  await refreshResults([],focus);
 }
 async function action(name,el){
  if(!name?.startsWith('picker-'))return false;
  const op=name.slice(7),owner=/^(find|choose|clear|next|previous)-(project|book|tag)$/.exec(op);
  if(op==='close'){close();return true;}
  if(op==='open'){
   s.open=true;s.galleryOnly=Boolean(choosingGallerySource?.());s.ownersAvailable=typeof workspaceOwners==='function';const opening=s;
   if(!types){
    const [definitions,presentation]=await Promise.all([import('./record-types.js'),import('./record-type-presentation.js')]);
    types={ids:definitions.RECORD_TYPES.map(row=>row.id),statuses:definitions.STATUSES,label:presentation.recordTypeLabel};
    if(s!==opening)return true;
   }
   if(libraryStatus)void libraryStatus().then(result=>{
    if(s!==opening||!s.open||!['preparing','locked','failed'].includes(result?.state))return;
    s.preparation=result.state;paint();
   }).catch(()=>{});
   await browse({focus:'[data-picker-search]'});return true;
  }
  if(!s.open)return true;
  // Projects and lab books of this workspace reach the library through their own
  // grants. Unlocking one resumes discovery, then the library is read again.
  if(op==='workspace-owners'){
   if(!s.ownersAvailable)return true;const opening=s;
   if(!await workspaceOwners()||s!==opening||!s.open)return true;
   s.preparation=null;await browse({});
   const result=await libraryStatus?.().catch(()=>null);
   if(s===opening&&s.open&&['preparing','locked','failed'].includes(result?.state)){s.preparation=result.state;paint();}
   return true;
  }
  if(op.startsWith('saved-')){await saved.action(op.slice(6),el);return true;}
  if(s.galleryOnly&&['insert','insert-group','select-page','remove-placement','show-uses','sites-open','jump'].includes(op))return true;
  if(owner){await actFacet(owner[1],owner[2],el);return true;}
  if(op==='filter-tag'){
   const row=s.rows.find(row=>row.id===el.dataset.source)??(s.item?.id===el.dataset.source?s.item:null);
   const tag=el.dataset.tag;
   if(row?.tags?.includes(tag)){
    const active=s.tags.includes(tag);
    await toggleTag(tag,active?'[data-picker-search]':'[data-key="tag"][data-value="'+CSS.escape(tag)+'"]');
   }
  }
  else if(op==='search')await applyFilters();
  else if(op==='more-tags'){
   const row=s.rows.find(row=>row.id===el.dataset.source);
   if(row){s.pane='detail';s.tagOffset=0;await details(row,{focus:'[data-picker-tag-list]'});}
  }else if(op==='tags-prev'||op==='tags-next'){
   const next=s.tagOffset+(op==='tags-prev'?-12:12);
   if(next>=0&&next<(s.item?.tags?.length??0)){s.tagOffset=next;paint('[data-picker-tag-list]');}
  }
  else if(op==='toggle-filters'){if(saved.isOpen()){saved.reset();s.filtersShown=true;}else s.filtersShown=!s.filtersShown;paint('[data-action="website-files-picker-toggle-filters"]');}
  else if(op==='reset-filters'){
   cancelOwners();s.owners={project:facet(),book:facet(),tag:facet()};s.tags=[];s.fields=defaults();s.criteria=defaults();await refreshResults(['project','book'],'[data-picker-search]');
  }else if(op==='remove-filter'){
   const key=el.dataset.key;
   if(key==='project'||key==='book')await actFacet('clear',key,el);
   else{if(key==='tag'){s.tags=s.tags.filter(tag=>tag!==el.dataset.value);if(!s.tags.length)s.fields.tagMode=s.criteria.tagMode='all';}
    else if(Object.hasOwn(s.criteria,key))s.criteria[key]=s.fields[key]=defaults()[key];
    await refreshResults([],'[data-picker-search]');}
  }
  else if(op==='previous'&&s.page)await browse({entryPage:s.page-1,facets:[]});
  else if(op==='next'&&s.next){s.pages[s.page+1]=s.next;await browse({entryPage:s.page+1,facets:[]});}
  else if(op==='select'){const row=s.rows.find(r=>r.id===el.dataset.source);if(row){s.pane='detail';await details(row);}}
  else if(op==='gallery'&&s.item&&s.detail&&onSourceGallery){const {id,revision,title}=s.item;close();await onSourceGallery({id,revision,title});}
  else if(op==='review-queue'){s.pane='queue';paint();}
  else if(op==='show-entry')showPane('detail','show-uses');
  else if(op==='show-uses'&&s.item)showPane('uses','show-entry');
  else if(op==='select-page'){add(s.rows);paint();}
  else if(op.startsWith('queue-')){
   const id=el.dataset.source;
   if(op==='queue-clear')s.queue.clear();else if(op==='queue-remove')s.queue.delete(id);
   else{const entries=[...s.queue.entries()],i=entries.findIndex(([key])=>key===id),dest=i+(op==='queue-up'?-1:1);
    if(i>=0&&dest>=0&&dest<entries.length){entries.splice(dest,0,...entries.splice(i,1));s.queue=new Map(entries);}}
   if(!s.queue.size)s.pane='detail';paint();
  }else if(op==='insert'||op==='insert-group'){
   const list=op==='insert-group'?[...s.queue.values()]:s.item?[s.item]:[];if(!list.length)return true;
   const sources=list.map(row=>({sourceId:row.id,sourceRevision:row.revision})),where=position(),pin=epoch;
   try{if(op==='insert')await insert({...sources[0],position:where});else await insertMany({sources,position:where,presentation:s.batchPresentation??'full'});}
   catch(error){if(pin===epoch)failHidden(error);throw error;}
   if(!s.open)return true;
   s.queue.clear();s.pane='detail';s.siteList=s.usageSite=null;if(s.item)await details(s.item);s.status=msg('pickerInserted',{count:sources.length});paint();
  }else if(s.item){
   const row=s.placements?.items[Number(el.dataset.index)];
   if(op==='sites-open'||op==='sites-next'||op==='sites-previous'){
    const next=op==='sites-open'?0:op==='sites-next'?s.sitePage+1:s.sitePage-1;
    if(next<0||op==='sites-next'&&!s.siteList?.next)return true;
    if(op==='sites-next')s.sitePages[next]=s.siteList.next;
    try{await listSites(next);if(s.open&&s.item)showPane('sites','show-entry');}catch(error){failHidden(error);throw error;}
   }else if(op==='use-site'||op==='sites-close'){
    const other=op==='use-site'?s.siteList?.items[Number(el.dataset.index)]:null;if(op==='use-site'&&!other)return true;
    s.usageSite=other?.siteId===site().site.id?null:other;s.placeOffset=0;s.placePages=[0];if(op==='sites-close')s.siteList=null;
    await details(s.item,{part:'places',sectionOffset:s.sectionOffset});if(s.open&&s.item)showPane('uses','show-entry');
   }else if(op==='review-remove'&&row?.editable){s.confirm=Number(el.dataset.index);paint();}
   else if(op==='cancel-remove'){s.confirm=null;paint();}
   else if(op==='jump'&&row){const result=await jumpPlacement({...row,siteId:s.usageSite?.siteId??site().site.id,expectedRevision:s.placements.revision,sourceId:s.item.id,sourceRevision:s.item.revision});if(result!==false&&s.open)close();}
   else if(op==='remove-placement'&&row?.editable&&s.confirm===Number(el.dataset.index)){
    try{await mutatePlacement('remove',{siteId:s.usageSite?.siteId??site().site.id,path:row.path,ordinal:row.ordinal,sourceId:s.item.id,sourceRevision:s.item.revision,expectedRevision:s.placements.revision});}
    catch(error){failHidden(error);throw error;}
    if(s.open&&s.item){if(s.siteList){if(s.usageSite)await listSites(s.sitePage);else{await listSites(s.sitePage);await details(s.item);}}else await details(s.item);s.status=msg('pickerRemoved');paint();}
   }else if(op==='sections-next'||op==='sections-previous'||op==='places-next'||op==='places-previous'){
    const sections=op.startsWith('sections'),history=sections?s.sectionPages:s.placePages;
    const current=sections?s.sectionOffset:s.placeOffset,i=history.indexOf(current),next=op.endsWith('next')?(sections?s.detail.nextSection:s.placements.next):history[i-1];
    if(next!=null){if(op.endsWith('next'))history[i+1]=next;await details(s.item,{sectionOffset:sections?next:s.sectionOffset,placeOffset:sections?s.placeOffset:next,part:sections?'sections':'places'});}
   }
  }
  return true;
 }
 return {view,input,action,reset,bind,revalidate};
}

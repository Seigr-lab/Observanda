import {t} from './i18n/index.js';
import {websitePickerView} from './website-files-picker-view.js';

const pageSize=12,facetSize=8,reviewLimit=40;
const facet=()=>({chosen:null,text:'',query:'',items:[],page:0,pages:[null],next:null,open:false});
const initial=()=>({open:false,search:'',query:'',filter:'all',applied:'all',owners:{project:facet(),book:facet()},rows:[],page:0,pages:[null],next:null,
 queue:new Map(),item:null,detail:null,placements:null,sectionOffset:0,sectionPages:[0],placeOffset:0,placePages:[0],position:'end',block:1,confirm:null,
 status:'',loading:false,generation:null,token:null,totalEntries:null,preparation:null});
export function websiteFilesPicker({request,esc,blocks,site,insert,insertMany,mutatePlacement,jumpPlacement,libraryStatus}){
 const msg=(key,args)=>t('websiteFiles',key,args);
 let s=initial(),epoch=0,controller=null,validating=false;
 const dialog=()=>document.querySelector('dialog[data-website-picker-dialog]');
 const siteArgs=()=>({siteId:site().site.id,expectedRevision:site().site.revision});
 function start(){
  controller?.abort();controller=new AbortController();
  return {number:++epoch,signal:controller.signal};
 }
 function reset(){epoch++;controller?.abort();controller=null;dialog()?.close();s=initial();}
 function forgetDetails(){s.item=s.detail=s.placements=null;s.confirm=null;s.sectionOffset=s.placeOffset=0;s.sectionPages=[0];s.placePages=[0];}
 function view(){
  return '<section class="panel website-files-picker" data-website-picker><h2>'+esc(msg('library'))+'</h2><p>'+esc(msg('libraryNotice'))+
   '</p><button type="button" class="button" data-action="website-files-picker-open">'+esc(msg('pickerBrowse'))+'</button>'+
   (s.open?'<dialog data-website-picker-dialog aria-labelledby="website-picker-title">'+websitePickerView(s,{msg,esc,blocks})+'</dialog>':'')+'</section>';
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
  if(current&&s.open)current.innerHTML=websitePickerView(s,{msg,esc,blocks});else host.outerHTML=view();
  bind();if(active)focusWhenReady(dialog()?.querySelector(active));
 }
 function clearProtected(){
  forgetDetails();s.rows=[];s.next=null;s.queue.clear();s.token=s.generation=s.totalEntries=null;
  for(const f of Object.values(s.owners)){f.items=[];f.chosen=null;f.pages=[null];f.page=0;f.next=null;}
 }
 function close(){
  reset();paint();focusWhenReady(document.querySelector('[data-action="website-files-picker-open"]'));
 }
 function bind(){
  const d=dialog();if(!s.open||!d)return;
  if(!document.head.querySelector('link[data-sheet="website-files-picker"]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/website-files-picker.css';link.dataset.sheet='website-files-picker';document.head.append(link);}
  if(!d.open)d.showModal();
  d.oncancel=e=>{e.preventDefault();close();};
  for(const details of d.querySelectorAll('[data-picker-facet]'))details.ontoggle=()=>{if(details.isConnected)s.owners[details.dataset.pickerFacet].open=details.open;};
  d.onkeydown=e=>{
   if(e.isComposing)return;
   const field=e.target;
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
 }
 async function collect(route,args,after,limit,job){
  const items=[],seen=new Set();let head;
  do{
   if(job.number!==epoch)throw new DOMException('Cancelled','AbortError');
   if(seen.has(after))throw Error(msg('failed'));seen.add(after);
   const data=await request(route,{...args,after,limit:limit-items.length},{signal:job.signal});
   if(head&&(head.visibilityToken!==data.visibilityToken||head.generation!==data.generation))throw Error(msg('changed'));
   head=data;items.push(...data.items);after=data.next;
  }while(after!=null&&items.length<limit);
  return {items,next:after??null,generation:head.generation,token:head.visibilityToken,totalEntries:head.totalEntries};
 }
 async function browse({entryPage=0,facetPage={},facets=['project','book'],entries=true,focus}={}){
  const job=start();s.loading=true;s.status=msg('loading');
  if(entries){s.rows=[];forgetDetails();s.next=null;}
  for(const kind of facets)s.owners[kind].items=[];
  paint(focus);
  const projectId=s.owners.project.chosen?.id??null,notebookId=s.owners.book.chosen?.id??null;
  const steps=[];
  if(entries)steps.push({key:'entries',page:entryPage,read:collect('library/search',{search:s.query,filter:s.applied,projectId,notebookId},s.pages[entryPage]??null,pageSize,job)});
  for(const kind of facets){
   const f=s.owners[kind],page=facetPage[kind]??0;
   steps.push({key:kind,page,read:collect('library/facets',{kind,search:f.query,...(kind==='book'?{projectId}:{})},f.pages[page]??null,facetSize,job)});
  }
  try{
   const values=await Promise.all(steps.map(step=>step.read));
   if(job.number!==epoch)return;
   if(values.some(v=>v.token!==values[0].token||v.generation!==values[0].generation))throw Error(msg('changed'));
   if(s.token&&values[0].token!==s.token){clearProtected();s.loading=false;return browse();}
   s.generation=values[0].generation;s.token=values[0].token;
   steps.forEach(({key,page},i)=>{
    const v=values[i];if(Number.isSafeInteger(v.totalEntries))s.totalEntries=v.totalEntries;
    if(key==='entries'){
     s.rows=v.items;s.page=page;s.next=v.next;
     for(const row of v.items)if(s.queue.has(row.id))s.queue.set(row.id,row);
    }
    else{const f=s.owners[key];f.items=v.items;f.page=page;f.next=v.next;if(f.chosen)f.chosen=v.items.find(r=>r.id===f.chosen.id)??f.chosen;}
   });
   s.status='';s.loading=false;paint(focus);
  }catch(error){if(job.number===epoch){clearProtected();s.loading=false;s.status=error.message;paint();}if(error.name!=='AbortError')throw error;}
 }
 function failHidden(error){clearProtected();s.status=error.message||msg('changed');s.loading=false;paint();}
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
    const retained=new Map([...s.queue].filter(([id])=>accepted.has(id)).map(([id,row])=>[id,{id,revision:row.revision,title:row.title,recordId:row.recordId}]));
    clearProtected();s.queue=retained;s.status=msg('pickerPermissionsChanged');paint();
    await browse();
   }
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
 async function details(row,{sectionOffset=0,placeOffset=0,part='both',focus}={}){
  const job=start(),args={sourceId:row.id,sourceRevision:row.revision};
  if(!s.item||s.item.id!==row.id)forgetDetails();
  try{
   const [preview,locations]=await Promise.all([
    part==='places'?null:request('library/preview',{...args,sectionAfter:sectionOffset},{signal:job.signal}),
    part==='sections'?null:request('library/placements',{...siteArgs(),...args,path:site().path,offset:placeOffset,limit:pageSize},{signal:job.signal})
   ]);
   if(job.number!==epoch)return;
   if(preview)s.detail=guarded(preview);if(locations)s.placements=guarded(locations);
   s.item=row;s.confirm=null;s.sectionOffset=sectionOffset;s.placeOffset=placeOffset;s.status='';paint(focus);
  }catch(error){if(job.number===epoch)failHidden(error);if(error.name!=='AbortError')throw error;}
 }
 function input(el){
  if(el.matches('[data-picker-search]'))s.search=el.value;
  else if(el.matches('[data-picker-facet-search]'))s.owners[el.dataset.pickerFacetSearch].text=el.value;
  else if(el.matches('[data-picker-filter]'))s.filter=el.value;
  else if(el.matches('[data-picker-position]')){s.position=el.value;s.block=1;paint('[data-picker-position]');}
  else if(el.matches('[data-picker-block]')){s.block=el.valueAsNumber;const n=dialog()?.querySelector('[data-picker-block-label]');if(n)n.textContent=blocks()[s.block-1]??'';}
  else if(el.matches('[data-picker-check]')){
   const row=s.rows.find(r=>r.id===el.dataset.pickerCheck);if(row){if(el.checked)add([row]);else s.queue.delete(row.id);paint();}
  }else return false;
  return true;
 }
 function add(items){
  if(new Set([...s.queue.keys(),...items.map(r=>r.id)]).size>reviewLimit){s.status=msg('pickerBatchLimit',{count:reviewLimit});return;}
  for(const row of items)s.queue.set(row.id,row);s.status='';
 }
 function position(){
  if(s.position!=='before')return s.position;
  if(!Number.isInteger(s.block)||s.block<1||s.block>blocks().length)throw Error(msg('pickerBlockNumber'));
  return {before:s.block-1};
 }
 async function actFacet(op,kind,el){
  const f=s.owners[kind];
  if(op==='find'){f.query=f.text.trim();f.pages=[null];await browse({entries:false,facets:[kind]});return;}
  if(op==='next'||op==='previous'){
   if(op==='next'){if(!f.next)return;f.pages[f.page+1]=f.next;}
   await browse({entries:false,facets:[kind],facetPage:{[kind]:Math.max(0,f.page+(op==='next'?1:-1))}});return;
  }
  const row=op==='choose'?f.items[Number(el.dataset.index)]:null;if(op==='choose'&&!row)return;
  f.chosen=row;f.open=false;
  if(kind==='project'){s.owners.book=facet();}
  else if(row?.projectId&&s.owners.project.chosen?.id!==row.projectId)s.owners.project.chosen={id:row.projectId,title:row.projectTitle??null};
  s.pages=[null];await browse({facets:kind==='project'?['book']:[]});
 }
 async function action(name,el){
  if(!name?.startsWith('picker-'))return false;
  const op=name.slice(7),owner=/^(find|choose|clear|next|previous)-(project|book)$/.exec(op);
  if(op==='close'){close();return true;}
  if(op==='open'){
   s.open=true;const opening=s;
   if(libraryStatus)void libraryStatus().then(result=>{
    if(s!==opening||!s.open||!['preparing','locked','failed'].includes(result?.state))return;
    s.preparation=result.state;paint();
   }).catch(()=>{});
   await browse({focus:'[data-picker-search]'});return true;
  }
  if(!s.open)return true;
  if(owner){await actFacet(owner[1],owner[2],el);return true;}
  if(op==='search'){s.query=s.search.trim();s.applied=s.filter;s.pages=[null];await browse({facets:[]});}
  else if(op==='previous'&&s.page)await browse({entryPage:s.page-1,facets:[]});
  else if(op==='next'&&s.next){s.pages[s.page+1]=s.next;await browse({entryPage:s.page+1,facets:[]});}
  else if(op==='select'){const row=s.rows.find(r=>r.id===el.dataset.source);if(row)await details(row);}
  else if(op==='select-page'){add(s.rows);paint();}
  else if(op.startsWith('queue-')){
   const id=el.dataset.source;
   if(op==='queue-clear')s.queue.clear();else if(op==='queue-remove')s.queue.delete(id);
   else{const entries=[...s.queue.entries()],i=entries.findIndex(([key])=>key===id),dest=i+(op==='queue-up'?-1:1);
    if(i>=0&&dest>=0&&dest<entries.length){entries.splice(dest,0,...entries.splice(i,1));s.queue=new Map(entries);}}
   paint();
  }else if(op==='insert'||op==='insert-group'){
   const list=op==='insert-group'?[...s.queue.values()]:s.item?[s.item]:[];if(!list.length)return true;
   const sources=list.map(row=>({sourceId:row.id,sourceRevision:row.revision})),where=position(),pin=epoch;
   try{if(op==='insert')await insert({...sources[0],position:where});else await insertMany({sources,position:where});}
   catch(error){if(pin===epoch)failHidden(error);throw error;}
   if(!s.open)return true;
   s.queue.clear();if(s.item)await details(s.item);s.status=msg('pickerInserted',{count:sources.length});paint();
  }else if(s.item){
   const row=s.placements?.items[Number(el.dataset.index)];
   if(op==='review-remove'&&row?.editable){s.confirm=Number(el.dataset.index);paint();}
   else if(op==='cancel-remove'){s.confirm=null;paint();}
   else if(op==='jump'&&row){await jumpPlacement({...row,expectedRevision:s.placements.revision,sourceId:s.item.id,sourceRevision:s.item.revision});if(s.open)close();}
   else if(op==='remove-placement'&&row?.editable&&s.confirm===Number(el.dataset.index)){
    try{await mutatePlacement('remove',{path:row.path,ordinal:row.ordinal,sourceId:s.item.id,sourceRevision:s.item.revision,expectedRevision:s.placements.revision});}
    catch(error){failHidden(error);throw error;}
    if(s.open&&s.item){await details(s.item);s.status=msg('pickerRemoved');paint();}
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

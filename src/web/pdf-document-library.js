import {pdfLibraryOrganizationUI} from './pdf-library-organization-ui.js';
export function pdfDocumentLibrary({post,esc,tr,button,host,project,readGeneration,openDocument}){
 let archived=false,search='',sort='name',match='prefix',items=[],next=null,previous=[],current=null;
 let pending=null,stage='',failure='',inspection=null,previewRequest=null,previewTimer=null,duplicate=null,copyAttempted=false,writing=false;
 const organization=pdfLibraryOrganizationUI({post,esc,tr,button,host,draw:refresh,query:()=>query(),rows:()=>items,archived:()=>archived});
 const stamped=date=>new Intl.DateTimeFormat(document.documentElement.lang||'en',{dateStyle:'medium',timeStyle:'short'}).format(date);
 function clearPreview(){
  previewRequest?.abort();previewRequest=null;clearTimeout(previewTimer);previewTimer=null;inspection=null;
 }
 function clearPage(){pending?.abort();pending=null;clearPreview();duplicate=null;copyAttempted=false;writing=false;}
 function close(){clearPage();organization.reset();}
 const attrs=id=>'data-id="'+esc(id)+'"';
 function row(item){
  const id=attrs(item.id);
  const title='<button type="button" class="pdf-library-title" data-action="module-command" data-module-id="pdf-editor" data-command="'+(archived?'archive-restore':'open')+'" '+id+'>'+esc(item.name)+(archived?' - '+esc(tr('restoreDocument')):'')+'</button>';
  const description='<div class="pdf-library-meta"><span>'+esc(tr(item.count===1?'libraryOneSection':'librarySections',{n:item.count}))+'</span><code title="'+esc(item.id)+'">'+esc(item.id.slice(0,8))+'</code>'+(item.modified?'<time datetime="'+new Date(item.modified).toISOString()+'">'+esc(stamped(item.modified))+'</time>':'')+'</div>';
  let controls='';
  if(!archived&&typeof item.pinned==='boolean'){
   controls='<div class="pdf-library-actions">'+button('libraryDetails','library-details',id+' aria-expanded="'+(inspection?.id===item.id)+'"')+button(item.pinned?'libraryUnpin':'libraryPin','library-pin',id+' aria-pressed="'+item.pinned+'"')+button('libraryDuplicate','library-copy',id)+'</div>';
  }
  return '<article class="pdf-library-row" data-library-item="'+esc(item.id)+'"><div class="pdf-library-document">'+organization.checkbox(item)+'<div>'+title+description+'</div></div>'+controls+detailView(item)+copyView(item)+'</article>';
 }
 function detailView(item){
  if(inspection?.id!==item.id)return '';
  const info=inspection.value;
  if(!info)return '<div class="pdf-library-detail" role="status">'+esc(tr('librarySearching'))+'</div>';
  const exported=info.exported.item,exportText=exported?tr('exportState'+exported.state)+' · '+stamped(exported.createdAt)+' · '+exported.revision.slice(0,12):tr(info.exported.next?'librarySearching':'noExports');
  const previews=info.previews.map(part=>'<li><strong>'+esc(part.title||tr('untitled'))+'</strong>'+(part.source!==null?'<span>'+esc(tr('retainedResearch'))+' · '+esc(part.source)+'</span>':'')+'<p>'+esc(part.excerpt)+'</p></li>').join('');
  return '<div class="pdf-library-detail"><p>'+esc(project())+' · '+esc(tr('edition',{number:info.edition}))+' · <code>'+esc(item.revision.slice(0,12))+'</code></p><p>'+esc(tr('exports'))+' · '+esc(exportText)+'</p><code>'+esc(item.id)+'</code>'+(previews?'<ul>'+previews+'</ul>':'')+'</div>';
 }
 function copyView(item){
  if(duplicate?.operation.id!==item.id)return '';
  return '<div class="pdf-library-copy"><label>'+esc(tr('libraryCopyName'))+'<input type="text" maxlength="240" data-pdf-library-copy-name value="'+esc(duplicate.operation.name)+'"'+(copyAttempted?' readonly':'')+'></label>'+button(copyAttempted&&!writing?'retry':'libraryCreateCopy','library-confirm-copy',writing?'disabled':'')+button('libraryCancelCopy','library-cancel-copy',writing?'disabled':'')+'</div>';
 }
 function results(){
  const key=stage||(!items.length&&!next?(search||sort==='pinned'?'libraryNoMatch':archived?'archiveEmpty':'empty'):'libraryResults');
  return organization.view()+'<p role="status">'+esc(failure||tr(key,{n:items.length}))+'</p>'+items.map(row).join('')+'<nav class="pdf-toolbar">'+(previous.length?button('previous','library-previous'):'')+(next?button('more','library-next'):'')+'</nav>';
 }
 function refresh(){const target=host()?.querySelector('[data-pdf-library-results]');if(target)target.innerHTML=results();}
 async function query(cursor=null,back=[],retry=true){
  clearPage();const controller=new AbortController();pending=controller;const {signal}=controller;
  const options={search,sort,match,archived,cursor,limit:20,groupId:organization.groupId()};stage='librarySearching';failure='';refresh();
  try{
   let value=await post('library-query',options,{signal});
   if(!value.ready){
    stage='libraryIndexing';refresh();
    do{const progress=await post('library-prepare',{},{signal});if(progress.ready)break;}while(!signal.aborted);
    value=await post('library-query',options,{signal});
   }
   while(!value.items.length&&value.next&&!signal.aborted)value=await post('library-query',{...options,cursor:value.next},{signal});
   if(signal.aborted)return;
   items=value.items;next=value.next;current=cursor;previous=back;stage='';
  }catch(error){
   if(signal.aborted)return;
   if(error.code==='CONFLICT'&&retry){await query(null,[],false);return;}
   failure=error.message;stage='';
  }finally{if(pending===controller){pending=null;refresh();}}
 }
 async function open(archivedList){
  close();archived=archivedList;items=[];next=current=null;previous=[];stage='';failure='';
  const controller=new AbortController();pending=controller;const {signal}=controller;
  try{
   const value=await post('library-query',{search,sort,match,archived},{signal});if(signal.aborted)return;
   if(value.ready&&(!value.next||value.items.length)){items=value.items;next=value.next;return;}
   if(!value.ready&&!search)items=(await post(archived?'archive':'list',{},{signal})).items;
   if(!signal.aborted){stage=value.ready?'librarySearching':'libraryIndexing';void query();}
  }catch(error){if(!signal.aborted)throw error;}finally{if(pending===controller)pending=null;}
 }
 function view(){
  const options=[['name','name'],['recent','libraryRecent'],['pinned','libraryPinned']].map(([key,label])=>'<option value="'+key+'"'+(sort===key?' selected':'')+'>'+esc(tr(label))+'</option>');
  const matches=[['prefix','libraryStartsWith'],['contains','libraryContains']].map(([key,label])=>'<option value="'+key+'"'+(match===key?' selected':'')+'>'+esc(tr(label))+'</option>');
  return '<section class="pdf-document-list"><div class="pdf-toolbar"><label>'+esc(tr('librarySearch'))+'<input type="search" maxlength="240" data-pdf-library-search value="'+esc(search)+'"></label><label>'+esc(tr('libraryMatch'))+'<select data-pdf-library-match>'+matches.join('')+'</select></label><label>'+esc(tr('librarySort'))+'<select data-pdf-library-sort>'+options.join('')+'</select></label>'+button('search','library-search')+'</div><div data-pdf-library-results>'+results()+'</div></section>';
 }
 function input(el){
  if(organization.input(el))return true;
  if(el.hasAttribute('data-pdf-library-copy-name')){if(duplicate&&!copyAttempted)duplicate.operation.name=el.value;return true;}
  if(el.hasAttribute('data-pdf-library-search')){search=el.value;return true;}
  if(el.hasAttribute('data-pdf-library-match')){match=el.value;void query();return true;}
  if(el.hasAttribute('data-pdf-library-sort')){sort=el.value;void query();return true;}
  return false;
 }
 async function details(item){
  clearPreview();const controller=new AbortController();previewRequest=controller;const {signal}=controller;
  inspection={id:item.id,value:null};refresh();
  try{
   const pin=await readGeneration(signal).catch(()=>undefined),request={id:item.id,revision:item.revision,cursor:null},value=await post('library-details',request,{signal});
   if(signal.aborted)return;
   if(value.protected&&(pin===undefined||await readGeneration(signal)!==pin)){clearPreview();refresh();return;}
   if(signal.aborted)return;
   inspection={id:item.id,value,pin};refresh();schedulePreviewCheck();
   while(value.exported.next){
    const result=await post('library-details',{...request,cursor:value.exported.next},{signal});
    if(signal.aborted)return;value.exported=result.exported;
   }
  }catch(error){if(!signal.aborted){clearPreview();failure=error.message;}}
  finally{if(!signal.aborted)refresh();}
 }
 function schedulePreviewCheck(){if(inspection?.value?.protected&&!previewTimer)previewTimer=setTimeout(()=>{previewTimer=null;void checkPreview();},5000);}
 async function checkPreview(){
  if(!inspection)return;
  if(document.hidden||!inspection.value){clearPreview();refresh();return;}
  if(!inspection.value.protected)return;
  const active=inspection;
  try{if(await readGeneration(previewRequest.signal)!==active.pin&&inspection===active){clearPreview();refresh();}}
  catch{if(inspection===active){clearPreview();refresh();}}
  schedulePreviewCheck();
 }
 async function action(name,node){
  if(writing)return true;
  if(await organization.action(name,node))return true;
  const item=items.find(row=>row.id===node?.dataset.id);
  try{
   if(name==='library-search')await query();
   else if(name==='library-next'&&next)await query(next,[...previous,current]);
   else if(name==='library-previous'&&previous.length)await query(previous.at(-1),previous.slice(0,-1));
   else if(name==='library-details'&&item){if(inspection?.id===item.id){clearPreview();refresh();}else await details(item);}
   else if(name==='library-pin'&&item){writing=true;await post('library-pin',{id:item.id,expectedRevision:item.revision,pinned:!item.pinned});await query(current,previous);}
   else if(name==='library-copy'&&item){clearPreview();if(duplicate?.operation.id!==item.id){copyAttempted=false;duplicate={id:crypto.randomUUID(),commandId:crypto.randomUUID(),expectedRevision:null,operation:{type:'duplicate',id:item.id,expectedRevision:item.revision,name:tr('libraryCopyDefault',{name:item.name}).slice(0,240)}};}refresh();const field=host()?.querySelector('[data-pdf-library-copy-name]');field?.focus();field?.select();}
   else if(name==='library-confirm-copy'&&duplicate){
    if(!duplicate.operation.name.trim()){host()?.querySelector('[data-pdf-library-copy-name]')?.focus();return true;}
    const request=duplicate;copyAttempted=true;writing=true;refresh();await post('change',request);if(duplicate===request)await openDocument(request.id);
   }else if(name==='library-cancel-copy'){duplicate=null;copyAttempted=false;refresh();}
   else return false;
  }catch(error){failure=error.message;refresh();}
  finally{if(writing){writing=false;refresh();}}
  return true;
 }
 function bind(){
  const field=host()?.querySelector('[data-pdf-library-search]');
  if(field){
   field.oninput=()=>{search=field.value;};
   field.onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();search=field.value;void query();}};
  }
 }
 return {open,view,input,action,close,bind,checkPreview};
}

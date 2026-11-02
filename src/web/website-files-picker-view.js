export function websitePickerView(state,{msg,esc,blocks}){
 const {owners,rows,queue,item,detail,placements}=state;
 const label=(key,args)=>esc(msg(key,args));
 const count=value=>new Intl.NumberFormat(document.documentElement.lang||undefined).format(value);
 const button=(key,op,attributes='',args)=>'<button type="button" class="button" data-action="website-files-picker-'+op+'" '+attributes+'>'+label(key,args)+'</button>';
 const option=(value,key,selected)=>'<option value="'+value+'" '+(value===selected?'selected':'')+'>'+label(key)+'</option>';
 const ownerName=(kind,row)=>row?.title||msg(kind==='project'?'pickerProjectId':'pickerBookId',{id:row?.id??'—'});
 const ancestry=row=>[row.projectTitle||(row.projectId?msg('pickerProjectId',{id:row.projectId}):msg('pickerUnlistedProject')),
  row.notebookTitle||(row.notebookId?msg('pickerBookId',{id:row.notebookId}):msg('pickerUnlistedBook'))].join(' › ');
 function facet(kind){
  const data=owners[kind],project=kind==='project',name=project?'pickerProject':'pickerBook';
  return '<details data-picker-facet="'+kind+'" '+(data.open?'open':'')+'><summary>'+label(name)+' · '+(data.chosen?esc(ownerName(kind,data.chosen)):label(project?'pickerAllProjects':'pickerAllBooks'))+'</summary>'+
   '<label>'+label(project?'pickerSearchProjects':'pickerSearchBooks')+'<input type="search" maxlength="160" data-picker-facet-search="'+kind+'" value="'+esc(data.text)+'"></label>'+
   button('pickerFind','find-'+kind)+(data.chosen?button(project?'pickerAllProjects':'pickerAllBooks','clear-'+kind):'')+
   '<ul class="website-picker-owners">'+data.items.map((row,index)=>'<li><button type="button" class="button" data-action="website-files-picker-choose-'+kind+'" data-index="'+index+'" aria-pressed="'+String(row.id===data.chosen?.id)+'">'+esc(ownerName(kind,row))+
    (!project&&row.projectTitle?' <small>'+esc(row.projectTitle)+'</small>':'')+(Number.isSafeInteger(row.count)?' ('+esc(count(row.count))+')':'')+'</button></li>').join('')+'</ul>'+
   (data.items.length||state.loading?'':'<p>'+label('pickerNoMatches')+'</p>')+
   (data.page?button('pickerPrevious','previous-'+kind):'')+(data.next!==null?button('pickerNext','next-'+kind):'')+'</details>';
 }
 function position(){
  const labels=state.position==='before'?blocks():[];
  return '<label>'+label('pickerPosition')+'<select data-picker-position>'+option('end','pickerEnd',state.position)+option('start','pickerStart',state.position)+option('before','pickerBefore',state.position)+'</select></label>'+
   (state.position==='before'?'<label>'+label('pickerBlockNumber')+'<input type="number" min="1" max="'+labels.length+'" value="'+esc(state.block)+'" data-picker-block></label><small data-picker-block-label>'+esc(labels[state.block-1]??'')+'</small>':'');
 }
 function selected(){
  const entries=[...queue.values()];
  if(!entries.length)return '';
  return '<section class="website-picker-queue"><h3>'+label('pickerQueue',{count:entries.length})+'</h3><ol>'+entries.map((row,i)=>'<li><span>'+esc(row.title)+' <small>'+esc(ancestry(row))+'</small></span>'+
   button('up','queue-up','data-source="'+esc(row.id)+'" '+(i===0?'disabled':''))+button('down','queue-down','data-source="'+esc(row.id)+'" '+(i===entries.length-1?'disabled':''))+
   button('remove','queue-remove','data-source="'+esc(row.id)+'"')+'</li>').join('')+'</ol>'+
   position()+button('pickerInsertGroup','insert-group','',{count:entries.length})+button('pickerClearQueue','queue-clear')+'</section>';
 }
 function places(){
  if(!placements)return '';
  return '<section class="website-picker-places"><h4>'+label('pickerUses',{count:placements.total})+'</h4>'+
   (Number.isSafeInteger(placements.pageCount)?'<p>'+label('pickerPageCount',{count:placements.pageCount})+'</p>':'')+
   (placements.total?'<ol start="'+(state.placeOffset+1)+'">'+placements.items.map((row,i)=>{
    const name=(row.draft?msg('draftPage',{title:row.pageTitle||row.path}):row.pageTitle||row.path);
  const target=esc(name)+' <small>'+esc(row.path)+' · '+label('pickerOccurrence',{n:row.ordinal+1})+(row.sectionTitle?' · '+esc(row.sectionTitle):'')+'</small>';
    return '<li>'+target+' <div class="inline-actions">'+button('pickerLocate','jump','data-index="'+i+'"')+
     (row.editable?button('pickerRemoveHere','review-remove','data-index="'+i+'"'):'<small>'+label('pickerManagedUse')+'</small>')+'</div>'+
     (state.confirm===i?'<p>'+label('pickerRemovalNotice')+'</p>'+button('pickerConfirmRemove','remove-placement','data-index="'+i+'"')+button('cancel','cancel-remove'):'')+'</li>';
   }).join('')+'</ol>':'<p>'+label('pickerUnused')+'</p>')+
   (state.placeOffset?button('pickerPrevious','places-previous'):'')+(placements.next!=null?button('pickerNext','places-next'):'')+'</section>';
 }
 function preview(){
  if(!item||!detail)return '<section class="website-picker-detail"><p>'+label('pickerChooseEntry')+'</p></section>';
  return '<section class="website-picker-detail" aria-label="'+label('pickerPreview')+'"><h3>'+esc(item.title)+'</h3><p>'+esc(ancestry(item))+'</p>'+
   (detail.preview?'<p>'+esc(detail.preview)+'</p>':'')+
   '<h4>'+label('pickerSections')+'</h4>'+(detail.sections.length?'<ul>'+detail.sections.map(s=>'<li><strong>'+esc(s.title)+'</strong>'+(s.preview?'<p>'+esc(s.preview)+'</p>':'')+'</li>').join('')+'</ul>':'<p>'+label('pickerNoSections')+'</p>')+
   (state.sectionOffset?button('pickerPrevious','sections-previous'):'')+(detail.nextSection!=null?button('pickerNext','sections-next'):'')+
   places()+(queue.size?'':position()+button(placements?.total?'pickerInsertAgain':'pickerInsert','insert'))+'</section>';
 }
 const resultList='<section class="website-picker-entry-list"><h3>'+label('pickerEntries')+'</h3><p>'+label('pickerPage',{page:state.page+1})+'</p>'+
  (rows.length?button('pickerSelectPage','select-page','',{count:rows.length})+
   '<ul class="website-picker-results">'+rows.map(row=>'<li><strong>'+esc(row.title)+'</strong><small>'+esc(ancestry(row))+(row.displayDate?' · '+esc(row.displayDate):'')+'</small><small>'+label('pickerReference',{id:row.recordId??row.id})+'</small>'+
    '<label class="website-picker-checkbox"><input type="checkbox" data-picker-check="'+esc(row.id)+'" '+(queue.has(row.id)?'checked':'')+'>'+label('pickerSelectEntry',{title:row.title})+'</label>'+
    button('pickerPreview','select','data-source="'+esc(row.id)+'" aria-pressed="'+String(item?.id===row.id)+'"')+'</li>').join('')+'</ul>':
    state.loading?'':'<p>'+label(state.query||owners.project.chosen||owners.book.chosen||state.applied!=='all'?'pickerNoMatches':'emptyLibrary')+'</p>')+
  (state.page?button('pickerPrevious','previous'):'')+(state.next!==null?button('pickerNext','next'):'')+'</section>';
 return '<header><h2 id="website-picker-title">'+label('library')+'</h2>'+button('pickerClose','close')+'</header>'+
 (Number.isSafeInteger(state.totalEntries)?'<strong>'+label('pickerEligibleCount',{count:count(state.totalEntries)})+'</strong>':'')+'<p>'+label('pickerPermissionHelp')+'</p>'+
 (state.preparation?'<p class="hint">'+label(({preparing:'pickerPreparingLibrary',locked:'pickerLockedLibrary',failed:'pickerFailedLibrary'})[state.preparation])+'</p>':'')+
 '<div class="website-picker-facets">'+facet('project')+facet('book')+'</div><div class="website-picker-search">'+
 '<label>'+label('pickerSearch')+'<input type="search" maxlength="160" data-picker-search value="'+esc(state.search)+'"></label>'+
 '<label>'+label('pickerFilter')+'<select data-picker-filter>'+option('all','pickerAll',state.filter)+option('media','pickerWithMedia',state.filter)+option('text','pickerTextOnly',state.filter)+'</select></label>'+button('pickerFind','search')+'</div>'+
 '<p role="status" aria-live="polite">'+esc(state.status)+'</p><div class="website-picker-workspace">'+resultList+'<div class="website-picker-side">'+selected()+preview()+'</div></div>';
}

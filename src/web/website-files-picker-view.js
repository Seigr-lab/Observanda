import {websitePickerRefinements} from './website-files-picker-refinements.js';
export function websitePickerView(state,{msg,esc,blocks,destination,owner,types,statusLabel,galleryAvailable,saved}){
 const {owners,rows,queue,item,detail,placements,galleryOnly}=state;
 const label=(key,args)=>esc(msg(key,args));
 const count=value=>new Intl.NumberFormat(document.documentElement.lang||undefined).format(value);
 const button=(key,op,attributes='',args)=>'<button type="button" class="button'+(['insert','insert-group'].includes(op)||(op==='gallery'&&galleryOnly)?' primary':'')+'" data-action="website-files-picker-'+op+'" '+attributes+'>'+label(key,args)+'</button>';
 const option=(value,key,selected)=>'<option value="'+value+'" '+(value===selected?'selected':'')+'>'+label(key)+'</option>';
 function tagButtons(source,limit,detail=false){
  const tags=source.tags??[];
  if(!tags.length)return '';
  const start=detail?state.tagOffset:0;
  return '<div class="website-picker-tags" role="group" aria-label="'+label('pickerTags')+'" '+(detail?'tabindex="-1" data-picker-tag-list':'')+'>'+tags.slice(start,start+limit).map(tag=>
   '<button type="button" data-action="website-files-picker-filter-tag" data-source="'+esc(source.id)+'" data-tag="'+esc(tag)+'" aria-pressed="'+state.tags.includes(tag)+'" aria-label="'+label('pickerFilterTag',{tag})+'">'+esc(tag)+'</button>'
  ).join('')+(detail?(start?button('pickerPrevious','tags-prev'):'')+(start+limit<tags.length?button('pickerNext','tags-next'):''):
   tags.length>limit?button('pickerMoreTags','more-tags','data-source="'+esc(source.id)+'"',{count:tags.length-limit}):'')+'</div>';
 }
 const ownerName=(kind,row)=>row?.title||msg(kind==='project'?'pickerProjectId':'pickerBookId',{id:row?.id??'—'});
 const ancestry=row=>[row.projectTitle||(row.projectId?msg('pickerProjectId',{id:row.projectId}):msg('pickerUnlistedProject')),
  row.notebookTitle||(row.notebookId?msg('pickerBookId',{id:row.notebookId}):msg('pickerUnlistedBook'))].join(' › ');
 function facet(kind){
  const data=owners[kind],project=kind==='project',tags=kind==='tag',name=project?'pickerProject':tags?'pickerTags':'pickerBook';
  return '<details data-picker-facet="'+kind+'" '+(data.open?'open':'')+'><summary>'+label(name)+(data.chosen?' · '+esc(ownerName(kind,data.chosen)):'')+'</summary><div class="website-picker-owner-menu">'+
   (tags?'<p>'+label('pickerTagHelp')+'</p>':'')+'<label>'+label(project?'pickerSearchProjects':tags?'pickerSearchTags':'pickerSearchBooks')+'<input type="search" maxlength="160" data-picker-facet-search="'+kind+'" value="'+esc(data.text)+'"></label>'+
   button('pickerFind','find-'+kind)+(data.chosen?button(project?'pickerAllProjects':'pickerAllBooks','clear-'+kind):'')+
   '<div data-picker-owner-results aria-busy="'+String(data.loading)+'"><ul class="website-picker-owners">'+data.items.map((row,index)=>'<li><button type="button" data-action="website-files-picker-choose-'+kind+'" data-index="'+index+'" aria-pressed="'+String(tags?state.tags.includes(row.id):row.id===data.chosen?.id)+'">'+esc(ownerName(kind,row))+
   (!project&&row.projectTitle?' <small>'+esc(row.projectTitle)+'</small>':'')+(Number.isSafeInteger(row.count)?' <span class="website-picker-facet-count">('+esc(count(row.count))+')</span>':'')+'</button></li>').join('')+'</ul>'+
   (data.loading?'<p>'+label('loading')+'</p>':data.items.length?'':'<p>'+label('pickerNoMatches')+'</p>')+
   (data.page&&!data.loading?button('pickerPrevious','previous-'+kind):'')+(data.next!==null?button('pickerNext','next-'+kind):'')+'</div></div></details>';
 }
 if(owner)return facet(owner);
 function position(){
  const labels=state.position==='before'?blocks():[];
  return '<label>'+label('pickerPosition')+'<select data-picker-position>'+option('end','pickerEnd',state.position)+option('start','pickerStart',state.position)+option('before','pickerBefore',state.position)+'</select></label>'+
   (state.position==='before'?'<label>'+label('pickerBlockNumber')+'<input type="number" min="1" max="'+labels.length+'" value="'+esc(state.block)+'" data-picker-block></label><small data-picker-block-label>'+esc(labels[state.block-1]??'')+'</small>':'');
 }
 function selected(){
  const entries=[...queue.values()];
  if(!entries.length)return '';
  const asCards=state.batchPresentation==='card';
  const presentation='<label>'+label('placementFormat')+'<select data-picker-batch-presentation><option value="full" '+(asCards?'':'selected')+'>'+label('placementFull')+'</option>'+
   '<option value="card" '+(asCards?'selected':'')+'>'+label('placementCard')+' · '+label('placementTitleOnly')+'</option></select></label>';
  return '<section class="website-picker-queue"><h3>'+label('pickerQueue',{count:entries.length})+'</h3>'+presentation+'<ol>'+entries.map((row,i)=>'<li><span>'+esc(row.title)+' <small>'+esc(ancestry(row))+'</small></span>'+
   button('up','queue-up','data-source="'+esc(row.id)+'" '+(i===0?'disabled':''))+button('down','queue-down','data-source="'+esc(row.id)+'" '+(i===entries.length-1?'disabled':''))+
   button('remove','queue-remove','data-source="'+esc(row.id)+'"')+'</li>').join('')+'</ol>'+
   button('pickerClearQueue','queue-clear')+(item?button('pickerBackToEntry','show-entry'):'')+'</section>';
 }
 function siteChoices(){
  const list=state.siteList;
  if(!list)return button('pickerFindWebsites','sites-open');
  return '<section class="website-picker-sites"><h4>'+label('pickerWebsitesUsing')+'</h4>'+
   (list.items.length?'<table aria-label="'+label('pickerWebsitesUsing')+'"><thead><tr>'+['pickerSitesColumn','pickerPlacementsColumn','pickerPagesColumn'].map(k=>'<th scope="col">'+label(k)+'</th>').join('')+'</tr></thead><tbody>'+list.items.map((row,i)=>'<tr><th scope="row"><button type="button" class="website-picker-link" data-action="website-files-picker-use-site" '+((state.usageSite?.siteId??destination.site.id)===row.siteId?'aria-current="true" ':'')+'data-index="'+i+'">'+esc(row.siteTitle)+'</button></th><td>'+esc(count(row.total))+'</td><td>'+esc(count(row.pageCount))+'</td></tr>').join('')+'</tbody></table>':'<p>'+label('pickerNoWebsites')+'</p>')+
   (state.sitePage?button('pickerPrevious','sites-previous'):'')+(list.next?button('pickerNext','sites-next'):'')+button('pickerThisWebsite','sites-close')+'</section>';
 }
 function places(){
  if(!placements)return '';
  return '<section class="website-picker-places"><h4>'+(state.usageSite?label('pickerUseInSite',{title:state.usageSite.siteTitle,count:placements.total}):label('pickerUses',{count:placements.total}))+'</h4>'+
   (Number.isSafeInteger(placements.pageCount)?'<p>'+label('pickerPageCount',{count:placements.pageCount})+'</p>':'')+
   (placements.total?'<ol start="'+(state.placeOffset+1)+'">'+placements.items.map((row,i)=>{
    const name=(row.draft?msg('draftPage',{title:row.pageTitle||row.path}):row.pageTitle||row.path);
    const target='<button type="button" class="website-picker-link" data-action="website-files-picker-jump" data-index="'+i+'" aria-label="'+label('pickerLocate')+' · '+esc(name)+' · '+label('pickerOccurrence',{n:row.ordinal+1})+'">'+esc(name)+'</button><small>'+esc(row.path)+' · '+label('pickerOccurrence',{n:row.ordinal+1})+(row.sectionTitle?' · '+esc(row.sectionTitle):'')+'</small>';
    return '<li>'+target+' <div class="inline-actions">'+
     (row.editable?button('pickerRemoveHere','review-remove','data-index="'+i+'"'):'<small>'+label('pickerManagedUse')+'</small>')+'</div>'+
     (state.confirm===i?'<p>'+label('pickerRemovalNotice')+'</p>'+button('pickerConfirmRemove','remove-placement','data-index="'+i+'"')+button('cancel','cancel-remove'):'')+'</li>';
   }).join('')+'</ol>':'<p>'+label('pickerUnused')+'</p>')+
   (state.placeOffset?button('pickerPrevious','places-previous'):'')+(placements.next!=null?button('pickerNext','places-next'):'')+(state.pane==='detail'?button('pickerFindWebsites','sites-open'):'')+'</section>';
 }
 function preview(){
  if(!item||!detail)return '<section class="website-picker-detail"><p>'+label('pickerChooseEntry')+'</p></section>';
  const keys={body:'pickerBody',outcome:'pickerOutcome',results:'pickerResults',contributors:'pickerContributors',attempt:'pickerAttempt',tags:'pickerTags',text:'pickerText'};
  const data=[[msg('pickerType'),detail.displayType],[msg('pickerDate'),detail.metadata?.displayDate??item.displayDate],[msg('pickerStatus'),detail.displayStatus]].filter(([,v])=>v);
  const heading='<section class="website-picker-detail" aria-label="'+label('pickerPreview')+'"><small class="website-picker-eyebrow">'+label('pickerPreview')+'</small><h3>'+esc(item.title)+'</h3><p class="website-picker-ancestry">'+esc(ancestry(item))+'</p>';
  if(state.pane==='sites'||state.pane==='uses')return heading+'<div class="inline-actions">'+button('pickerBackToEntry','show-entry')+
   (state.pane==='uses'?button('pickerFindWebsites','sites-open'):'')+'</div>'+(state.pane==='sites'?siteChoices():places())+'</section>';
  return heading+(galleryOnly?'':'<div class="inline-actions">'+button('pickerWhereUsed','show-uses')+(galleryAvailable?button('galleryChooseFigures','gallery'):'')+'</div>')+
   (data.length?'<dl class="website-picker-facts">'+data.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl>':'')+
   '<small class="website-picker-reference">'+label('pickerReference',{id:item.recordId??item.id})+'</small>'+tagButtons(item,12,true)+(detail.overview??[]).filter(group=>keys[group.kind]&&(group.kind!=='tags'||!item.tags?.length)).map(group=>'<h4>'+label(keys[group.kind])+'</h4>'+group.paragraphs.map(text=>'<p>'+esc(text)+'</p>').join('')).join('')+
   '<h4>'+label('pickerSections')+'</h4>'+(detail.sections.length?'<ul>'+detail.sections.map(s=>'<li><strong>'+esc(s.title)+'</strong>'+(s.preview?'<p>'+esc(s.preview)+'</p>':'')+'</li>').join('')+'</ul>':'<p>'+label('pickerNoSections')+'</p>')+
   (state.sectionOffset?button('pickerPrevious','sections-previous'):'')+(detail.nextSection!=null?button('pickerNext','sections-next'):'')+
   places()+'</section>';
 }
 const refinements=websitePickerRefinements(state,{msg,esc,types,statusLabel,button,facet,savedOpen:saved?.isOpen()});
 function entry(row){
  const id=esc(row.id),ref=row.recordId??row.id,facts=[row.recordType?types.label(row.recordType):'',statusLabel(row.status),row.displayDate].filter(Boolean);
  return '<li data-picker-row="'+id+'" data-picker-revision="'+esc(row.revision)+'" '+(item?.id===row.id?'data-picker-current':'')+'>'+
   (galleryOnly?'':'<input type="checkbox" data-picker-check="'+id+'" aria-label="'+label('pickerSelectEntry',{title:row.title})+'" aria-describedby="picker-owner-'+id+'" '+(queue.has(row.id)?'checked':'')+'>')+'<div class="website-picker-record"><button type="button" class="website-picker-link" data-source="'+id+'" aria-pressed="'+String(item?.id===row.id)+'" aria-describedby="picker-owner-'+id+'" data-action="website-files-picker-select">'+esc(row.title)+'</button>'+
   '<small id="picker-owner-'+id+'" class="website-picker-ancestry">'+esc(ancestry(row))+'</small>'+(facts.length?'<small class="website-picker-row-facts">'+esc(facts.join(' · '))+'</small>':'')+
   '<div class="website-picker-row-meta">'+tagButtons(row,3)+'<small class="website-picker-reference" title="'+label('pickerReference',{id:ref})+'">'+label('pickerReference',{id:ref.slice(0,8)})+'</small></div></div>'+
   (galleryOnly?'':'<span draggable="true" data-picker-drag-handle title="'+label('pickerDragEntry')+'">'+label('pickerDragEntry')+'</span>')+'</li>';
 }
 const resultCount=state.page===0&&state.next===null&&!state.loading&&state.token?label('pickerMatches',{count:count(rows.length)}):label('pickerPage',{page:state.page+1});
 const resultList='<section class="website-picker-entry-list"><div class="website-picker-list-head"><div><h3>'+label('pickerEntries')+'</h3><small>'+resultCount+'</small></div>'+refinements.sort+'</div>'+
  (rows.length?(galleryOnly?'':button('pickerSelectPage','select-page','',{count:rows.length}))+'<ul class="website-picker-results">'+rows.map(entry).join('')+'</ul>':
   state.loading?'':'<p>'+label(refinements.filtered?'pickerNoMatches':'emptyLibrary')+'</p>'+(refinements.filtered?button('pickerClearFilters','reset-filters'):''))+
  (state.page?button('pickerPrevious','previous'):'')+(state.next!==null?button('pickerNext','next'):'')+'</section>';
 const review=queue.size&&state.pane!=='queue'?button('pickerReviewSelection','review-queue','',{count:queue.size}):'';
 const ready=item&&!queue.size?label('pickerReadyEntry',{title:item.title}):label('pickerSelectedCount',{count:queue.size})+(queue.size?' · '+label(state.batchPresentation==='card'?'placementCard':'placementFull'):'');
 const footer=galleryOnly?'<footer class="website-picker-footer"><div>'+(item?esc(item.title):label('pickerChooseEntry'))+'</div>'+button('galleryChooseFigures','gallery',item&&detail?'':'disabled')+'</footer>':'<footer class="website-picker-footer"><div><strong>'+label('pickerToPage',{site:destination.site.name,page:destination.path})+'</strong><small>'+ready+'</small></div>'+position()+review+
  (queue.size?button('pickerInsertGroup','insert-group','',{count:queue.size}):button(placements?.total&&!state.usageSite?'pickerInsertAgain':'pickerInsert','insert',item?'':'disabled'))+'</footer>';
 return '<header><div><h2 id="website-picker-title">'+label('pickerLibraryTitle')+'</h2>'+
 '<strong data-picker-total>'+(Number.isSafeInteger(state.totalEntries)?label('pickerEligibleCount',{count:count(state.totalEntries)}):'')+'</strong></div><div class="website-picker-commands">'+(galleryOnly?'':'<button type="button" class="button" data-picker-dock>'+label('pickerDock')+'</button>')+button('pickerClose','close')+'</div></header><div class="website-picker-intro"><p>'+label('pickerPermissionHelp')+'</p>'+
 (state.preparation?'<p class="hint">'+label(({preparing:'pickerPreparingLibrary',locked:'pickerLockedLibrary',failed:'pickerFailedLibrary'})[state.preparation])+'</p>':'')+
 refinements.search+'<p role="status" aria-live="polite">'+esc(state.status)+'</p></div><div class="website-picker-workspace" data-filters-shown="'+(state.filtersShown||Boolean(saved?.isOpen()))+'" data-detail-open="'+Boolean(item||queue.size&&state.pane==='queue')+'">'+(saved?.isOpen()?saved.view():refinements.rail)+resultList+'<div class="website-picker-side">'+(state.pane==='queue'&&queue.size?selected():preview())+'</div></div>'+footer;
}

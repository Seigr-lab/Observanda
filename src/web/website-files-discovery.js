// Search and sharing settings for the published website, and the language
// versions of the open page. Values are saved as declarations; the editor
// never requests the public address or the preview image from the network.
export function websiteFilesDiscovery({request,site,esc,tr,signal,adopt}){
 let value=null,draft=null,link={of:'',status:'current'},error=null,ticket=0;
 const button=(key,op,extra='')=>'<button type="button" class="button" data-action="website-files-discovery-'+op+'" '+extra+'>'+esc(tr(key))+'</button>';
 const checkbox=(key,field,checked,extra='')=>'<label class="website-inline-check"><input type="checkbox" data-discovery-field="'+field+'" '+(checked?'checked ':'')+extra+'>'+esc(tr(key))+'</label>';
 const pin=()=>({siteId:site().site.id,expectedRevision:site().site.revision,path:site().path});
 function subdirectory(){try{return !!draft.baseUrl&&new URL(draft.baseUrl).pathname!=='/';}catch{return false;}}
 function settingsView(){
  const pictures=['<option value="">'+esc(tr('discoveryNoImage'))+'</option>',...value.pictures.map(name=>'<option value="'+esc(name)+'"'+(draft.socialImage===name?' selected':'')+'>'+esc(name)+'</option>')].join('');
  return '<form data-discovery-settings><fieldset><legend>'+esc(tr('discoveryPublic'))+'</legend>'+
   '<label>'+esc(tr('discoveryBaseUrl'))+'<input type="url" inputmode="url" spellcheck="false" autocomplete="off" maxlength="2048" data-discovery-field="baseUrl" value="'+esc(draft.baseUrl??'')+'" aria-describedby="discovery-base-help"></label>'+
   '<p class="hint" id="discovery-base-help">'+esc(tr('discoveryBaseHelp'))+'</p>'+
   checkbox('discoveryIndexing','indexing',draft.indexing)+checkbox('discoverySitemap','sitemap',draft.sitemap,draft.baseUrl&&draft.indexing?'':'disabled')+
   (subdirectory()?'<p class="hint">'+esc(tr('discoveryRobotsSubdirectory'))+'</p>':'')+
   '<label>'+esc(tr('discoverySocialImage'))+'<select data-discovery-field="socialImage">'+pictures+'</select></label>'+
   '<label>'+esc(tr('discoverySocialAlt'))+'<input maxlength="300" data-discovery-field="socialImageAlt" value="'+esc(draft.socialImageAlt)+'"'+(draft.socialImage?'':' disabled')+'></label>'+
   (draft.socialImage&&!draft.baseUrl?'<p class="hint">'+esc(tr('discoveryImageNeedsAddress'))+'</p>':'')+
   '</fieldset>'+button('discoverySave','save')+'</form>';
 }
 function languagesView(){
  const current=value.pages.find(page=>page.path===value.path),group=value.group;
  let body;
  if(group.length){
   body='<ul class="website-discovery-group">'+group.map(row=>'<li'+(row.path===value.path?' aria-current="page"':'')+'><strong>'+esc(row.title||row.path)+'</strong> <code>'+esc(row.path)+'</code> · '+
    esc(row.language||tr('discoveryNoLanguage'))+' · '+esc(tr(row.source?'discoveryOriginal':row.outdated?'discoveryOutdated':'discoveryCurrent'))+(row.draft?' · '+esc(tr('discoveryDraft')):'')+'</li>').join('')+'</ul>'+
    (group.some(row=>!row.language)?'<p role="alert">'+esc(tr('discoveryMissingLanguage'))+'</p>':'')+button('discoveryLeave','leave');
  }else{
   const others=value.pages.filter(page=>page.path!==value.path).map(page=>'<option value="'+esc(page.pageId)+'"'+(link.of===page.pageId?' selected':'')+'>'+esc((page.title||page.path)+' · '+page.path)+'</option>').join('');
   body='<p>'+esc(tr('discoveryNoGroup'))+'</p><div class="website-discovery-link"><label>'+esc(tr('discoveryVersionOf'))+'<select data-discovery-link="of"><option value="">'+esc(tr('discoveryChoosePage'))+'</option>'+others+'</select></label>'+
    '<label>'+esc(tr('discoveryStatus'))+'<select data-discovery-link="status"><option value="current"'+(link.status==='current'?' selected':'')+'>'+esc(tr('discoveryCurrent'))+'</option><option value="outdated"'+(link.status==='outdated'?' selected':'')+'>'+esc(tr('discoveryOutdated'))+'</option></select></label>'+
    button('discoveryLink','link',link.of?'':'disabled')+'</div>';
  }
  return '<section class="website-discovery-languages"><h3>'+esc(tr('discoveryLanguages'))+'</h3><p class="hint">'+esc(tr('discoveryLanguagesHelp',{page:current?.title||value.path}))+'</p>'+body+'</section>';
 }
 function view(){
  let body;
  if(error)body='<p role="alert">'+esc(error)+'</p>';
  else if(!value)body='<p role="status">'+esc(tr('loading'))+'</p>';
  else body='<p>'+esc(tr('discoveryIntro'))+'</p>'+settingsView()+languagesView();
  return '<section class="panel website-files-publish website-discovery" data-website-discovery><h2 tabindex="-1" data-discovery-heading>'+esc(tr('discoveryTitle'))+'</h2>'+body+
   '<div class="inline-actions">'+button('closePreview','close')+'</div></section>';
 }
 function accept(next){value=next;draft={...next.settings};link={of:'',status:'current'};error=null;}
 async function open(){
  const active=++ticket;value=null;error=null;
  try{const next=await request('discovery/read',pin(),{signal:signal()});if(active===ticket&&next.revision===site()?.site.revision)accept(next);}
  catch(reason){if(active===ticket&&reason.name!=='AbortError')error=reason.message;}
 }
 async function write(data){
  const result=await request('discovery/save',{...pin(),...data},{signal:signal()});
  adopt(result);accept(result.discovery);
 }
 function input(element){
  const field=element.dataset.discoveryField,linkField=element.dataset.discoveryLink;
  if(!field&&!linkField||!draft)return false;
  if(linkField){link[linkField]=element.value;const action=document.querySelector('[data-action="website-files-discovery-link"]');if(action)action.disabled=!link.of;return true;}
  draft[field]=element.type==='checkbox'?element.checked:field==='socialImage'?element.value||null:element.value;
  return 'rerender';
 }
 async function action(op){
  if(op==='save'){
   const form=document.querySelector('[data-discovery-settings]');if(form&&!form.reportValidity())return;
   await write({settings:{baseUrl:draft.baseUrl?.trim()||null,indexing:draft.indexing,sitemap:draft.sitemap,socialImage:draft.socialImage,socialImageAlt:draft.socialImageAlt}});
  }else if(op==='link'){if(!link.of)return;await write({translation:{of:link.of,status:link.status}});}
  else if(op==='leave')await write({translation:{of:null}});
 }
 return {view,open,input,action,reset(){ticket++;value=draft=null;error=null;},
  dirty:()=>!!draft&&!!value&&JSON.stringify(draft)!==JSON.stringify(value.settings),
  focus(){requestAnimationFrame(()=>document.querySelector('[data-discovery-heading]')?.focus({preventScroll:true}));}};
}

import {confirmAction} from './confirm-action.js';
export function websiteFilesVersions({site,request,signal,tr,esc,adopt,close,render,run}){
 let openSite,history,version,kind,path,area,items,comparison,review,query,offset,reviewOffset,component,label;
 function reset(){openSite=history=items=comparison=review=null;version=component=label=query='';kind='page';area='text';offset=reviewOffset=0;}
 reset();
 const button=(key,action,disabled=false)=>'<button type="button" class="button" data-action="website-files-versions-'+action+'"'+(disabled?' disabled':'')+'>'+esc(tr(key))+'</button>';
 const field=(key,body)=>'<label>'+esc(tr(key))+body+'</label>';
 const select=(key,rows,selected)=>'<select data-versions="'+key+'">'+rows.map(([value,text])=>'<option value="'+esc(value)+'"'+(selected===value?' selected':'')+'>'+esc(text)+'</option>').join('')+'</select>';
 const time=value=>new Intl.DateTimeFormat(document.documentElement.lang||undefined,{dateStyle:'medium',timeStyle:'medium'}).format(new Date(value));
 const title=e=>[e.label,time(e.at),e.actor?.label??tr(e.actor?.kind==='unrecorded'?'versionUnrecorded':'versionWorkspace')].filter(Boolean).join(' · ');
 async function call(action,fields={}){
  const current=site(),siteId=current.site.id,expectedRevision=current.site.revision;
  const result=await request('versions/'+action,{siteId,expectedRevision,version,path,kind,component,...fields},{signal:signal()});
  if(site()?.site.revision!==expectedRevision||site()?.site.id!==siteId||
   (result.site?result.site.id!==siteId:result.revision!==expectedRevision))throw Error(tr('changed'));
  return result;
 }
 async function list(preferred=version){
  history=await call('list');version=history.items.find(row=>row.id===preferred)?.id??history.items[0]?.id??'';
 }
 // A release names the history version that produced it. Opening that
 // version selects it for the ordinary page and design restoration reviews.
 async function open(preferred){reset();openSite=site().site.id;path=site().path;await list(preferred);render();}
 async function loadItems(){
  if(!['component','page'].includes(kind)){items=null;return;}
  items=await call('contents',{query,offset});
  if(kind==='component'&&!items.items.some(i=>i.id===component))component=items.items[0]?.id??'';
  if(kind==='page'&&!items.items.some(i=>i.id===path))path=items.items[0]?.id??'';
 }
 function reviewList(rows){
  return '<ul class="website-version-impact">'+rows.map(r=>'<li><strong>'+esc(r.position?tr('versionSection',{position:r.position,kind:tr('versionKind_'+r.kind)}):r.name)+'</strong>'+
   (r.before!==undefined?'<div class="website-version-diff"><pre>'+esc(r.before)+'</pre><pre>'+esc(r.after)+'</pre></div>':
   r.reason?' <span>'+esc(tr('versionImpact_'+r.reason))+'</span>':'')+'</li>').join('')+'</ul>';
 }
 function details(){
  const row=history.items.find(e=>e.id===version);if(!row)return '';
  const counts=row.changes.pages,summary=tr('versionSummary',{added:counts.added,edited:counts.edited,removed:counts.removed,files:row.changes.files.added+row.changes.files.edited+row.changes.files.removed});
  const labels={name:'site',cssPath:'css',appearance:'siteAppearance',components:'pageImpact_component',themeBook:'designThemes',pageDesigns:'designManage',styleBook:'styleLibrary',breakpoints:'breakpointManage'};
  const settings=row.changes.settings.filter(k=>Object.hasOwn(labels,k)).map(k=>tr(labels[k]));
  const origin=row.restoredFrom&&history.items.find(e=>e.id===row.restoredFrom);
  const restored=row.restoredFrom?'<p>'+esc(tr('versionRestoredFrom',{version:origin?title(origin):row.restoredFrom.slice(0,8)}))+'</p>':'';
  const parts=[field('versionTarget',select('kind',[['page',tr('page')],['appearance',tr('siteAppearance')],['themeBook',tr('designThemes')],['styleBook',tr('styleLibrary')],['breakpoints',tr('breakpointManage')],['pageDesigns',tr('designManage')],['component',tr('pageImpact_component')]],kind))];
  if(['page','component'].includes(kind)){
   parts.push(field(kind==='page'?'pageSearch':'componentSearch','<input type="search" data-versions="query" maxlength="160" value="'+esc(query)+'">'),button('versionFind','find'));
   if(items){
    parts.push(field(kind==='page'?'page':'pageImpact_component',select('item',items.items.map(r=>[r.id,r.name]),kind==='page'?path:component)));
    if(offset||items.next!==null)parts.push(button('pageBack','back',!offset),button('pageForward','next',items.next===null));
   }else if(kind==='page')parts.push('<code>'+esc(path)+'</code>');
  }
  if(kind==='page')parts.push(field('recoveryDocument',select('area',[['text',tr('pickerText')],['html','HTML'],['css','CSS']],area)));
  parts.push(button('recoveryCompare','compare',kind==='page'?!path:kind==='component'&&!component));
  return '<p>'+esc([summary,...settings].join(' · '))+'</p>'+restored+'<div class="website-version-controls">'+parts.join('')+'</div>';
 }
 function changes(){
  let html='';
  if(comparison){
   const d=comparison.difference;
   html='<div class="website-version-diff"><section><h3>'+esc(tr('versionEarlier'))+'</h3><pre tabindex="0">'+esc(d.before??tr('versionReason_unavailable'))+'</pre></section>'+
    '<section><h3>'+esc(tr('recoverySaved'))+'</h3><pre tabindex="0">'+esc(d.after)+'</pre></section></div>';
   if(d.offset||d.next!==null)html+='<div class="inline-actions">'+button('pageBack','text-back',!d.offset)+button('pageForward','text-next',d.next===null)+'</div>';
  }
  if(!review)return html;
  if(review.unavailable||review.updated||review.currentOnly)html+='<p role="status">'+esc(tr('versionPermissions',{missing:review.unavailable,updated:review.updated,added:review.currentOnly}))+'</p>';
  if(review.status!=='ready')html+='<p role="status">'+esc(tr('versionReason_'+review.status))+'</p>';
  if(review.createsPage)html+='<p>'+esc(tr('versionCreatesPrivate'))+'</p>';
  if(review.items.length)html+=reviewList(review.items);
  if(reviewOffset||review.next!==null)html+=button('pageBack','review-back',!reviewOffset)+button('pageForward','review-next',review.next===null);
  return html+'<p>'+esc(tr('versionLocalRestore'))+'</p>'+button('versionRestore','apply',review.status!=='ready');
 }
 function view(){
  if(!history||openSite!==site()?.site.id||history.revision!==site()?.site.revision)return '<section class="panel">'+button('reopen','refresh')+'</section>';
  return '<section class="panel website-version-panel"><header><h2>'+esc(tr('versionsTitle'))+'</h2>'+button('closePreview','close')+'</header>'+
   '<p>'+esc(tr('versionCapacity',{total:history.maxVersions,named:history.maxNamed,mb:Math.floor(history.retiredLimit/(1024*1024))}))+'</p>'+
   '<div class="website-version-controls">'+field('versionLabel','<input data-versions="label" maxlength="120" value="'+esc(label)+'">')+button('versionName','name',history.items.filter(e=>e.label).length>=history.maxNamed)+'</div>'+
   (history.items.length?'<div class="website-version-controls">'+field('versionsTitle',select('version',history.items.map(e=>[e.id,title(e)]),version))+
    (history.items.find(e=>e.id===version)?.label?button('versionRelease','release'):'')+'</div>'+details()+changes():'')+'</section>';
 }
 function input(el){
  if(!el.dataset.versions)return false;
  switch(el.dataset.versions){
   case 'label':label=el.value;return true;
   case 'query':query=el.value;return true;
   case 'version':version=el.value;kind='page';path=site().path;items=null;query='';offset=0;break;
   case 'kind':kind=el.value;path=site().path;items=null;component='';query='';offset=0;break;
   case 'item':if(kind==='page')path=el.value;else component=el.value;break;
   case 'area':area=el.value;break;
  }
  comparison=review=null;render();
  if(['version','kind'].includes(el.dataset.versions)&&['page','component'].includes(kind))void run(async()=>{await loadItems();render();});
  return true;
 }
 async function reviewPage(at){
  reviewOffset=at;
  review=await call(kind==='page'?'review':'review-design',{offset:at,...(kind==='page'?{}:{path:site().path})});
 }
 async function action(operation){
  if(operation==='close'){reset();close();return;}
  if(operation==='refresh'){await open();return;}
  if(operation==='name'||operation==='release'){
   if(operation==='name'&&!label.trim()){document.querySelector('[data-versions="label"]')?.focus();return;}
   if(operation==='release'&&!await confirmAction(tr('versionReleaseConfirm'),{action:'release'}))return;
   const result=await call(operation,{path:site().path,label});adopt(result);
   await open();return;
  }
  if(['find','back','next'].includes(operation)){
   offset=operation==='next'?items.next:operation==='back'?Math.max(0,offset-40):0;
   comparison=review=null;await loadItems();
  }else if(operation==='compare'){
   comparison=kind==='page'?await call('compare',{area}):null;await reviewPage(0);
  }else if(operation==='text-next'||operation==='text-back'){
   comparison=await call('compare',{area,textOffset:operation==='text-next'?comparison.difference.next:Math.max(0,comparison.difference.offset-16384)});
  }else if(operation==='review-next'||operation==='review-back')await reviewPage(operation==='review-next'?review.next:Math.max(0,reviewOffset-40));
  else if(operation==='apply'&&review?.status==='ready'){
   const result=await call(kind==='page'?'restore':'restore-design',{reviewId:review.reviewId,...(kind==='page'?{}:{path:site().path})});
   reset();adopt(result);close();return;
  }
  render();
 }
 return {open,view,input,action,reset};
}

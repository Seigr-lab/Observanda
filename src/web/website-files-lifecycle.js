import {suggestedPagePath} from './website-files-pages.js';

export function websiteFilesLifecycle({active,esc,tr,request,render,close,updated}){
 let scope=null,site=null,path='',operation='',title='',destination='',includeEntries=false,copyId=null;
 let review=null,archive=null,after=null,prior=[],offset=0,epoch=0;
 const field=(key,name,value)=>'<label>'+esc(tr(key))+'<input data-lifecycle-field="'+name+'" value="'+esc(value)+'" maxlength="'+(name==='destination'?500:200)+'" required></label>';
 const button=(key,action,attributes='')=>'<button type="button" class="button" data-action="website-files-life-'+action+'" '+attributes+'>'+esc(tr(key))+'</button>';
 function reset(){epoch++;scope=site=null;path=operation=title=destination='';includeEntries=false;review=archive=null;prior=[];offset=0;after=null;}
 function configure(choice){
  const current=site?.pages?.find(p=>p.path===path);operation=choice;review=null;includeEntries=false;copyId=crypto.randomUUID();
  title=choice==='duplicate'?'':scope==='site'?site.name:current?.title??'';
  destination=choice==='move'?path:'';offset=0;
 }
 function open(area){
  reset();scope=area;site=active()?.site;path=active()?.path??'';configure('rename');render();
 }
 function pin(){return {siteId:site.id,expectedRevision:site.revision};}
 function payload(){
  const data={...pin(),action:operation};
  if(scope==='page')data.path=path;
  if(['duplicate','rename'].includes(operation))data.title=title.trim();
  if(scope==='page'&&['move','duplicate'].includes(operation))data.destination=destination.trim();
  if(operation==='duplicate'){data.includeEntries=includeEntries;if(scope==='site')data.copyId=copyId;}
  return data;
 }
 const kindKeys={page:'pageImpact_page',menu:'pageImpact_menu',link:'pageImpact_link',asset:'pageImpact_asset',component:'pageImpact_component',feed:'pageImpact_feed',source:'lifeEntry',sourceLink:'lifeEntryLink',instance:'lifeInstance',gallery:'gallery',design:'designName',theme:'designThemes',publication:'lifePublication',archivedPage:'lifeArchive',privatePage:'pagePrivate'};
 function view(){
  const subject=scope==='site'?'lifeManageSite':'lifeManagePage';
  const heading='<h2>'+esc(tr(subject))+'</h2>';
  if(archive){
   const rows=archive.items.map((row,i)=>'<li><button type="button" class="button" data-action="website-files-life-restore" data-index="'+i+'">'+esc(row.name??row.title)+' <code>'+esc(row.path??'')+'</code></button></li>').join('');
   return '<section class="panel website-page-form"><h2>'+esc(tr(scope==='site'?'lifeArchivedSites':'lifeArchivedPages'))+'</h2>'+(rows?'<ul>'+rows+'</ul>':'<p>'+esc(tr('lifeNoArchive'))+'</p>')+
    '<div class="inline-actions">'+button('pageBack','back',prior.length?'':'disabled')+button('pageForward','next',archive.next!==null?'':'disabled')+button('closePages','close')+'</div></section>';
  }
  const node='<p><strong>'+esc(site.name)+'</strong>'+(scope==='page'?' · <code>'+esc(path)+'</code>':'')+'</p>';
  if(review){
   const items=review.items.map(row=>'<li><strong>'+esc(tr(kindKeys[row.kind]))+'</strong> <code>'+esc(row.name)+'</code>'+(row.count>1?' × '+row.count:'')+'</li>').join('');
   const counts=review.counts?'<p>'+Object.entries({components:'pageImpact_component',sources:'lifeEntry',feeds:'pageImpact_feed',designs:'designName',themes:'designThemes'}).map(([key,label])=>esc(tr(label))+' '+review.counts[key]).join(' · ')+'</p>':'';
   const pageStatus=operation==='duplicate'&&scope==='page'||operation==='restore'&&scope==='page'?'<p>'+esc(tr('lifePrivateResult'))+'</p>':'';
   const external=scope==='site'&&operation==='archive'?'<p>'+esc(tr('lifeExternal'))+'</p>':scope==='page'&&['archive','move'].includes(operation)?'<p>'+esc(tr('lifePageExternal'))+'</p>':'';
   return '<section class="panel website-page-form">'+heading+node+'<h3>'+esc(tr('life_'+operation))+'</h3>'+
    (title&&['duplicate','rename'].includes(operation)?'<p>'+esc(title)+'</p>':'')+(destination?'<p><code>'+esc(destination)+'</code></p>':'')+
    pageStatus+external+(scope==='site'&&operation==='duplicate'?'<p>'+esc(tr('lifeNewOwner'))+'</p>':'')+
    (operation==='duplicate'?'<p>'+esc(tr(includeEntries?'lifeWithEntries':'lifeWithoutEntries'))+'</p>':'')+counts+
    '<ul>'+items+'</ul><p>'+esc(tr('pageRange',{start:review.items.length?offset+1:0,end:offset+review.items.length,total:review.total}))+'</p>'+
    (offset||review.next!==null?'<div class="inline-actions">'+button('pageBack','back',offset?'':'disabled')+button('pageForward','next',review.next!==null?'':'disabled')+'</div>':'')+
    (review.blocked?'<p role="alert">'+esc(tr('lifeBlockedRecovery'))+'</p>':'')+'<div class="inline-actions">'+button('life_'+operation,'apply',review.blocked?'disabled':'')+button('cancel','close')+'</div></section>';
  }
  const choices=scope==='site'?['rename','duplicate','archive']:['rename',...(path==='index.html'?[]:['move']),'duplicate',...(path==='index.html'?[]:['archive'])];
  return '<section class="panel website-page-form">'+heading+node+'<div class="website-page-form-fields"><label>'+esc(tr('lifeAction'))+'<select data-lifecycle-field="operation">'+choices.map(c=>'<option value="'+c+'"'+(c===operation?' selected':'')+'>'+esc(tr('life_'+c))+'</option>').join('')+'</select></label>'+
   (['duplicate','rename'].includes(operation)?field(scope==='site'?'name':'pageTitle','title',title):'')+
   (scope==='page'&&['move','duplicate'].includes(operation)?field('pagePath','destination',destination):'')+'</div>'+
   (operation==='duplicate'?'<label><input type="checkbox" data-lifecycle-field="includeEntries"'+(includeEntries?' checked':'')+'> '+esc(tr('lifeWithEntries'))+'</label><p data-life-copy-note'+(includeEntries?' hidden':'')+'>'+esc(tr('lifeWithoutEntries'))+'</p>':'')+
   '<div class="inline-actions">'+button('lifeReview','review')+button(scope==='site'?'lifeArchivedSites':'lifeArchivedPages','archive-list')+button('closePages','close')+'</div></section>';
 }
 function input(el){
  const k=el.dataset.lifecycleField;if(!k)return false;
  if(k==='operation'){configure(el.value);render();document.querySelector('[data-lifecycle-field="operation"]')?.focus();}
  else if(k==='includeEntries'){includeEntries=el.checked;const note=document.querySelector('[data-life-copy-note]');if(note)note.hidden=includeEntries;}
  else if(k==='destination')destination=el.value;
  else if(k==='title'){
   const generated=scope==='page'&&operation==='duplicate'&&(!destination||destination===suggestedPagePath(title,new Set(site.pages.map(p=>p.path))));
   title=el.value;
   if(generated){destination=suggestedPagePath(title,new Set(site.pages.map(p=>p.path)));document.querySelector('[data-lifecycle-field="destination"]').value=destination;}
  }
  return true;
 }
 async function loadArchive(cursor){
  const generation=epoch;
  const result=scope==='site'?await request('list',{archived:true,limit:40,after:cursor}):await request('page/archive-list',{...pin(),offset:cursor??0});
  if(generation===epoch){archive=result;after=cursor;render();}
 }
 async function archivedSites(){reset();scope='site';await loadArchive(null);}
 async function showReview(at){
  const generation=epoch;
  let result;
  try{result=await request(scope+'/review-lifecycle',{...payload(),offset:at});}
  catch(error){
   const input=document.querySelector('[data-lifecycle-field="destination"]');
   if(generation===epoch&&input&&error.code==='EXISTS'){
    input.setCustomValidity(tr('lifeAddressTaken'));input.reportValidity();input.setCustomValidity('');return;
   }
   throw error;
  }
  if(generation===epoch){review=result;offset=at;render();}
 }
 async function action(op,el){
  if(op==='close'){reset();close();return;}
  if(op==='archive-list'){prior=[];await loadArchive(null);return;}
  if(op==='restore'&&archive){
   const item=archive.items[Number(el.dataset.index)];if(!item)return;
   if(scope==='site')site=item;else path=item.path;
   archive=null;configure('restore');await showReview(0);return;
  }
  if(op==='back'||op==='next'){
   if(archive){if(op==='next'){prior.push(after);await loadArchive(archive.next);}else if(prior.length)await loadArchive(prior.pop());}
   else if(review)await showReview(op==='next'?review.next:Math.max(0,offset-40));
   return;
  }
  if(op==='review'){
   for(const input of document.querySelectorAll('[data-lifecycle-field][required]'))if(!input.reportValidity())return;
   await showReview(0);return;
  }
  if(op==='apply'&&review&&!review.blocked){
   const generation=epoch;
   const response=await request(scope+'/apply-lifecycle',{...payload(),reviewId:review.reviewId});
   if(generation===epoch){reset();await updated(response);}
  }
 }
 return {open,view,action,input,reset,archivedSites};
}

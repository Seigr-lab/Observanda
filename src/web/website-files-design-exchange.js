import {operationProgress} from './operation-progress-ui.js';
import {downloadResource} from './session-download.js';

// Design export and import: a site's look (stylesheet, themes, page styles and
// fonts, layout ranges, components, region slots and page designs) leaves as
// one design package and enters another site after a review.
const slotKey={header:'regionHeader',sidebar:'regionSidebar','secondary-sidebar':'regionSecondarySidebar',footer:'regionFooter'};
export function websiteFilesDesignExchange({request,site,esc,tr,render,adopt,close}){
 let review=null,file=null,notice='',epoch=0,includeDrafts=false;
 const panel=()=>document.querySelector('.website-files-design-exchange');
 const action=(key,id,attributes='')=>'<button type="button" class="button" data-action="website-files-exchange-'+id+'" '+attributes+'>'+esc(tr(key))+'</button>';
 function reset(){epoch++;review=file=null;notice='';includeDrafts=false;}
 function upload(data){
  const json=new TextEncoder().encode(JSON.stringify(data)),length=new Uint8Array(4);new DataView(length.buffer).setUint32(0,json.length);
  return new Blob([length,json,file],{type:'application/octet-stream'});
 }
 function reviewView(){
  if(!review)return '';
  const rows=review.rows.map(row=>'<li>'+esc(tr('designKind_'+row.kind))+': '+esc(row.from?tr('designImportRenamed',{name:row.name,from:row.from}):row.name)+'</li>').join('');
  const regions=review.regions.map(row=>'<li><label><input type="checkbox" data-design-region="'+esc(row.slot)+'"> '+esc(tr(row.current?'designImportRegionReplace':'designImportRegion',{component:row.component,slot:tr(slotKey[row.slot]),current:row.current??''}))+'</label></li>').join('');
  const omitted=review.omitted.length?'<h4>'+esc(tr('designImportOmitted'))+'</h4><ul>'+review.omitted.map(row=>'<li>'+esc(row.name)+' ('+esc(tr('designOmitted_'+row.reason))+')</li>').join('')+'</ul>':'';
  return '<section class="website-design-review" aria-label="'+esc(tr('designImportReview'))+'"><h3>'+esc(tr('designImportFrom',{name:review.name}))+'</h3>'+
   (rows?'<p>'+esc(tr('designImportRows'))+'</p><ul>'+rows+'</ul>':'<p>'+esc(tr('designImportNothing'))+'</p>')+omitted+
   (review.stylesheet?'<p><label><input type="checkbox" data-design-stylesheet> '+esc(tr('designImportStylesheet'))+'</label></p>':'')+
   (regions?'<ul class="website-design-regions">'+regions+'</ul>':'')+
   '<div class="inline-actions">'+action('designImportApply','apply','data-primary')+action('cancel','discard')+'</div></section>';
 }
 function view(){
  return '<section class="panel website-files-design-exchange" aria-label="'+esc(tr('designExchange'))+'"><header><div><h2>'+esc(tr('designExchange'))+'</h2><p>'+esc(tr('designExchangeHelp'))+'</p></div>'+action('closePreview','close')+'</header>'+
   (notice?'<p role="status">'+esc(notice)+'</p>':'')+
   '<section><h3>'+esc(tr('designExport'))+'</h3><p>'+esc(tr('designExportHelp'))+'</p><p><label><input type="checkbox" data-design-drafts'+(includeDrafts?' checked':'')+'> '+esc(tr('designIncludePrivate'))+'</label></p>'+action('designExport','export')+'</section>'+
   '<section><h3>'+esc(tr('designImport'))+'</h3><p>'+esc(tr('designImportHelp'))+'</p><label>'+esc(tr('designImportChoose'))+' <input type="file" accept=".observanda-design,application/zip" data-design-file></label> '+action('designImportReview','review')+reviewView()+'</section></section>';
 }
 async function handle(operation,element){
  const name=operation.slice('exchange-'.length),current=site(),token=epoch;
  if(name==='close'){reset();close();return;}
  if(name==='export'){
   const query=new URLSearchParams({siteId:current.site.id,revision:current.site.revision,drafts:includeDrafts?'1':'0',heading:tr('heading'),text:tr('paragraph'),image:tr('altText')});
   await downloadResource('/api/website-files/designs/export?'+query,'');return;
  }
  if(name==='review'){
   file=panel()?.querySelector('[data-design-file]')?.files?.[0]??null;
   if(!file){panel()?.querySelector('[data-design-file]')?.focus();throw Error(tr('designImportNeedsFile'));}
   const result=await request('designs/import/review',upload({siteId:current.site.id,expectedRevision:current.site.revision,path:current.path}));
   if(token!==epoch)return;review=result;notice='';render();return;
  }
  if(name==='discard'){review=file=null;render();return;}
  if(name==='apply'&&review){
   if(review.revision!==current.site.revision)throw Error(tr('changed'));
   const root=panel(),options={stylesheet:Boolean(root?.querySelector('[data-design-stylesheet]')?.checked),regions:[...(root?.querySelectorAll('[data-design-region]:checked')??[])].map(box=>box.dataset.designRegion)};
   const progress=root?operationProgress({host:root,stageText:tr,title:()=>tr('designImportApply'),compact:true,disableControls:true}):null;
   let next;try{next=await request('designs/import/apply',upload({siteId:current.site.id,expectedRevision:review.revision,path:current.path,reviewId:review.reviewId,options}),progress?{onProgress:progress.update}:undefined);}finally{progress?.close();}
   if(token!==epoch)return;
   review=file=null;adopt(next);notice=tr('designImported');render();panel()?.querySelector('[role="status"]')?.focus?.();
  }
 }
 function bind(){
  panel()?.addEventListener('change',event=>{if(event.target.matches('[data-design-drafts]'))includeDrafts=event.target.checked;});
 }
 return {view,bind,handle,reset};
}

import {projectApiRoute,researchOwner} from './project-context.js';
import {WEBSITE_THEME_MIME} from './website-theme-model.js';
import {websiteContext} from './website-context.js';
import {t} from './i18n/index.js';
const text=(key,args)=>t('websiteEditor',key,args);
// Exchange reviews are scoped to one draft. Import is one ordinary undoable
// command; choosing a file or opening a review never saves or publishes.
export function websiteThemeUI({state,documents,api,esc,field,notify,render,changed=()=>{}}){
 let review=null,mode=null,busy=false,controller=null,epoch=0,origin=null,stamp=null,name='',templates=new Set(),regions=new Set(),expanded=false;
 const enabled=()=>Boolean(documents?.enabled());
 function discard(value){if(value?.id)void api('/api/websites/themes/discard',{id:value.id,sha256:value.sha256},{adopt:false}).catch(()=>{});}
 function invalidate(){controller?.abort();controller=null;epoch++;discard(review);review=null;mode=null;busy=false;stamp=null;}
 function reset(){controller?.abort();controller=null;epoch++;discard(review);review=null;mode=null;busy=false;origin=null;stamp=null;templates.clear();regions.clear();expanded=false;}
 function sync(){if(origin!==null&&(origin!==websiteContext(state)||stamp!==null&&stamp!==documents.snapshot()))reset();}
 const button=(action,label)=>'<button type="button" class="button" data-action="website-theme-'+action+'"'+(busy?' disabled':'')+'>'+esc(label)+'</button>';
 function reviewView(){if(!review)return '';if(!review.ready)return '<div role="alert"><h4>'+esc(text('themeNeedsAttention'))+'</h4><ul>'+review.blockers.map(v=>'<li>'+esc(v)+'</li>').join('')+'</ul></div>';
  return '<section aria-label="'+esc(text('themeReview'))+'"><h4>'+esc(review.name)+'</h4><p>'+esc(text('themeCounts',{layouts:review.templates.length,regions:review.regions.length,assets:review.assets,fonts:review.fonts}))+'</p>'+
   '<ul>'+[...review.templates.map(v=>text('themeLayout',{name:v.name})),...review.regions.map(v=>text('themeRegion',{name:v.name}))].map(v=>'<li>'+esc(v)+'</li>').join('')+'</ul>'+
   (review.authoredContent?'<p>'+esc(text('themeAuthoredContent'))+'</p>':'')+
   (review.links.length?'<details><summary>'+esc(text('themeRetainedLinks',{count:review.links.length}))+'</summary><ul>'+review.links.map(v=>'<li style="overflow-wrap:anywhere">'+esc(v)+'</li>').join('')+'</ul></details>':'')+
   (review.systemFonts.length?'<p>'+esc(text('themeSystemFonts'))+'</p>':'')+
   '<p>'+esc(text(mode==='import'?'themeApplyHelp':'themeDownloadHelp'))+'</p>'+
   '<div class="inline-actions">'+button(mode==='import'?'apply':'download',text(mode==='import'?'themeApply':'themeDownload'))+button('cancel',text('themeCancel'))+'</div></section>';
 }
 function view(){if(!enabled())return '';sync();const site=state.book.website;return '<details class="theme-exchange"'+(expanded?' open':'')+'><summary>'+esc(text('themeExchange'))+'</summary><p>'+esc(text('themeExchangeHelp'))+'</p>'+
  field(text('themeName'),'<input id="website-theme-name" maxlength="160" value="'+esc(name)+'" placeholder="'+esc(text('themeNamePlaceholder'))+'">')+
  '<fieldset><legend>'+esc(text('themeIncludeLayouts'))+'</legend>'+((site.templates??[]).map(t=>'<label><input type="checkbox" data-theme-template="'+esc(t.id)+'"'+(templates.has(t.id)?' checked':'')+'> '+esc(t.name)+'</label>').join('')||'<p>'+esc(text('themeNoLayouts'))+'</p>')+'</fieldset>'+
  '<fieldset><legend>'+esc(text('themeIncludeRegions'))+'</legend>'+((site.design.regions?.definitions??[]).map(r=>'<label><input type="checkbox" data-theme-region="'+esc(r.id)+'"'+(regions.has(r.id)?' checked':'')+'> '+esc(r.name)+'</label>').join('')||'<p>'+esc(text('themeNoRegions'))+'</p>')+'</fieldset>'+
  button('prepare',text('themePrepare'))+field(text('themeImport'),'<input id="website-theme-import" type="file" accept=".obsvtheme,'+WEBSITE_THEME_MIME+'"'+(busy?' disabled':'')+'>')+(busy?'<p role="status">'+esc(text('themePreparing'))+'</p>':'')+reviewView()+'</details>';
 }
 async function target(){await documents.flush();const value=documents.descriptor();return {workspaceId:state.book.id,websiteId:value.websitePin.websiteId,websitePin:value.websitePin,draftId:value.draft?.id??null,draftRevision:value.draft?.revision??null};}
 async function run(operation){sync();if(busy)return;const request=++epoch,context=websiteContext(state),control=controller=new AbortController();origin=context;busy=true;render();
  try{await operation({signal:control.signal,current:()=>request===epoch&&context===websiteContext(state)&&!control.signal.aborted});}
  catch(error){if(request===epoch&&!control.signal.aborted)notify(error.message,true);}
  finally{if(request===epoch){busy=false;controller=null;render();}}
 }
 async function action(el){const action=el.dataset.action;if(!action?.startsWith('website-theme-'))return false;if(!enabled()||busy)return true;sync();
  if(action==='website-theme-cancel'){reset();render();return true;}
  if(action==='website-theme-prepare'){await run(async({signal,current})=>{const selected={name,templateIds:[...templates],regionIds:[...regions]},pinned=await target(),snapshot=documents.snapshot();if(!current())return;discard(review);review=null;const result=await api('/api/websites/themes/export/prepare',{...pinned,...selected},{signal,adopt:false});if(!current()||snapshot!==documents.snapshot()){discard(result);return;}review=result;mode='export';stamp=snapshot;});}
  if(action==='website-theme-download'&&review?.ready&&mode==='export'){await run(async({signal,current})=>{const selected=review,blob=await api('/api/websites/themes/export',{id:selected.id,sha256:selected.sha256},{signal,adopt:false});if(!current())return;const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='observanda-theme.obsvtheme';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);discard(selected);review=null;});}
  if(action==='website-theme-apply'&&review?.ready&&mode==='import'){await run(async({current})=>{const selected=review;await documents.perform([{type:'theme-apply',id:selected.id,sha256:selected.sha256}]);if(!current())return;discard(selected);review=null;stamp=null;origin=null;await changed(true);notify(text('themeApplied'));});}
  return true;
 }
 async function importFile(input){const file=input.files?.[0];input.value='';if(!file)return;await run(async({signal,current})=>{const pinned=await target(),snapshot=documents.snapshot();if(!current())return;discard(review);review=null;const response=await fetch(projectApiRoute('/api/websites/themes/import',researchOwner(state)),{method:'POST',credentials:'same-origin',headers:{'Content-Type':WEBSITE_THEME_MIME,'X-Observanda-Wait':'1','X-Observanda-Workspace':state.storage.contextId,'X-Observanda-Theme-Target':JSON.stringify(pinned)},body:file,signal}),result=await response.json();if(!response.ok)throw new Error(result.error?.message??result.error??text('themeImportFailed'));if(!current()||snapshot!==documents.snapshot()){discard(result);return;}review=result;mode='import';stamp=snapshot;});}
 function input(el){if(el.id==='website-theme-name'){invalidate();name=el.value;return true;}if(el.dataset.themeTemplate){invalidate();el.checked?templates.add(el.dataset.themeTemplate):templates.delete(el.dataset.themeTemplate);return true;}if(el.dataset.themeRegion){invalidate();el.checked?regions.add(el.dataset.themeRegion):regions.delete(el.dataset.themeRegion);return true;}if(el.id==='website-theme-import'){void importFile(el);return true;}return false;}
 function bind(){document.querySelector('.theme-exchange')?.addEventListener('toggle',event=>{expanded=event.currentTarget.open;});}
 return {view,action,input,reset,bind};
}

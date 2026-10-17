import {websitePagePicker} from './website-page-picker.js';
import {websiteDocumentPages} from './website-document-pages.js';
import {websiteSnapshot} from './website-context.js';
import {ownedAssetURL} from './project-context.js';
import {logosFor} from './branding.js';
import {researchTargetPicker} from './research-target-picker.js';
import {t} from './i18n/index.js';
const text=(key,parameters)=>t('branding',key,parameters);

// Branding owns presentation metadata. Record bodies belong to the record
// editor; scope discovery and direct links need only one page or one label.
export function brandingUI({state,api,esc,field,option,showDialog,render,dirty,leave,report,uploading,documents}){
 const active=()=>state.page==='branding'&&!state.access?.locked&&!state.storageUnavailable&&!state.newWorkspace;
 const native=()=>Boolean(documents?.enabled());
 const nativePage=()=>native()&&target().startsWith('page:');
 const target=()=>state.brandTarget??'home';
 const key=()=>JSON.stringify([websiteSnapshot(state),state.book?.id,target(),documents?.enabled()?documents.viewKey():null]);
 const pages=websitePagePicker({state,api,esc,field,showDialog,documents,active,kinds:['site'],structurePages:options=>websiteDocumentPages(documents,state.book,{...options,kind:'page'}),onChoose:item=>changeScope(item.target)});
 const picker=researchTargetPicker({state,api,esc,field,showDialog,active,excludeId:()=>null});
 let label=null,controller=null,override=null,overrideController=null;
 const overrideReady=()=>!native()||documents.hasSelected('branding',target());
 const needsLabel=()=>target().startsWith('entry:')||nativePage();
 const nameReady=()=>!needsLabel()||label&&!label.loading&&!label.error&&!label.missing;
 const labelMessage=()=>needsLabel()&&!nameReady()?`<p role="${label?.error||label?.missing?'alert':'status'}">${esc(label?.error??text(label?.missing?'missing':'loading'))}</p>${label?.error?`<button class="button" data-action="brand-label-retry">${esc(text('retry'))}</button>`:''}`:'';
 function paintLabel(){
  const scope=document.querySelector('#branding-target'),panel=scope?.closest('[data-branding-panel]');if(!active()||!panel||scope.value!==target())return;
  const selected=[...scope.options].find(option=>option.value===target());if(selected&&needsLabel())selected.textContent=text(nativePage()?'page':'record',{title:label?.title??text('selectedRecord')});
  panel.querySelector('[data-branding-label-status]').innerHTML=labelMessage();const ready=overrideReady()&&nameReady();
  for(const control of panel.querySelectorAll('[data-logo-alt],[data-action="brand-remove"]'))control.disabled=!ready;
  for(const control of panel.querySelectorAll('[data-action="brand-up"]'))control.disabled=!ready||Number(control.dataset.index)===0;
  const upload=panel.querySelector('input[data-upload="branding"]');if(upload){upload.disabled=uploading()||!ready;const imports=upload.parentElement.querySelector('[data-action="media-import-open"]');if(imports)imports.disabled=upload.disabled;}
 }

 async function changeScope(scope){const stamp=key();if(native())await documents.flush();if(!active()||stamp!==key())return;state.brandTarget=scope;render();}
 function stop(){controller?.abort();controller=null;label=null;overrideController?.abort();overrideController=null;override=null;picker.stop();pages.close();}
 function sync(){picker.sync();pages.sync();if(!active()){stop();return;}if(label?.key!==key()){controller?.abort();controller=null;label=null;}if(override?.key!==key()){overrideController?.abort();overrideController=null;override=null;}}
 function editableLogos(scope=target()){
  if(native())return documents.editableOverride('branding',scope,()=>({target:scope,logos:structuredClone(logosFor(state.book,scope))})).logos;
  let branding=state.book.branding.find(b=>b.target===scope);
  if(!branding){branding={target:scope,logos:structuredClone(logosFor(state.book,scope))};state.book.branding.push(branding);}
  return branding.logos;
 }
 async function loadOverride(){
  const request=overrideController=new AbortController(),stamp=key(),scope=target();override={key:stamp,loading:true};
  try{await documents.selectOverride('branding',scope,{signal:request.signal});if(!request.signal.aborted&&active()&&stamp===key())override={key:stamp};}
  catch(error){if(!request.signal.aborted&&active()&&stamp===key())override={key:stamp,error:error.message??text('overrideInvalid')};}
  finally{if(overrideController===request)overrideController=null;if(!request.signal.aborted&&active()&&stamp===key())render();}
 }
 async function loadLabel(){
  controller?.abort();const request=controller=new AbortController(),stamp=key(),id=target().slice(nativePage()?5:6),workspaceId=state.book.id,etag=state.etag;
  label={key:stamp,loading:true};
  try{
   let record;
   if(nativePage())record=(await documents.item('pages',id,{signal:request.signal,retain:false})).value;
   else if(state.storage?.researchStorage==='catalogue'&&state.storage.researchFormatVersion===21){
    const result=await api('/api/workspace/read/labels',{workspaceId,etag,ids:[id]},{adopt:false,signal:request.signal});
    if(result.workspaceId!==workspaceId||result.etag!==etag||!Array.isArray(result.records)||!Array.isArray(result.missing)||result.records.length+result.missing.length!==1||result.records.some(r=>r.id!==id||typeof r.title!=='string'||!state.book.notebooks.some(n=>n.id===r.notebookId))||result.missing.some(value=>value!==id))throw Error(text('invalid'));
    record=result.records[0];
   }else record=state.book.entries.find(r=>r.id===id);
   if(request.signal.aborted||!active()||stamp!==key())return;
   label={key:stamp,title:record?.title,missing:!record};
  }catch(error){if(request.signal.aborted||!active()||stamp!==key())return;label={key:stamp,error:error.message??text('invalid')};}
  finally{if(!request.signal.aborted&&active()&&stamp===key()){controller=null;paintLabel();}}
 }
 function bind(){
  sync();if(!active())return;
  const input=document.querySelector('input[data-upload="branding"]'),imports=input?.parentElement.querySelector('[data-action="media-import-open"]');if(imports)imports.disabled=input.disabled;
  if((target().startsWith('entry:')||nativePage())&&!label)void loadLabel();
  if(native()&&!overrideReady()&&!override)void loadOverride();
 }
 function chooseRecord(){
  picker.open({title:text('pickRecord'),recordsOnly:true,onChoose:async(item,{stillCurrent})=>{
   if(!stillCurrent())return;await changeScope('entry:'+item.id);document.querySelector('#dialog').close();picker.stop();document.querySelector('#branding-target')?.focus();
  }});
 }
 function input(el){
  if(picker.input(el))return true;
  if(!active())return false;
  if(el.id==='branding-target'){
   const choice=el.value;el.value=target();const change=async()=>{if(choice==='record-picker')chooseRecord();else if(choice==='page-picker')pages.open(null,{title:text('choosePage'),returnFocus:'#branding-target'});else await changeScope(choice);};(native()?change():leave.run(change)).catch(report);return true;
  }
  if(el.dataset.logoAlt!==undefined){const logo=editableLogos()[Number(el.dataset.logoAlt)];if(logo){logo.alt=el.value;dirty();}return true;}
  return false;
 }
 async function action(el){
  if(await picker.action(el))return true;
  if(!active())return false;
  const name=el.dataset.action,index=Number(el.dataset.index);
  if(name==='brand-override-retry'){override=null;render();return true;}
  if(name==='brand-default'){await documents.perform([{type:'remove',collection:'branding',key:target()}]);dirty();render();return true;}
  if(name==='brand-label-retry'){label=null;render();return true;}
  if(name==='brand-remove'||name==='brand-up'){
   const logos=editableLogos();if(name==='brand-remove')logos.splice(index,1);else if(index>0)[logos[index-1],logos[index]]=[logos[index],logos[index-1]];
   dirty();render();return true;
  }
  return false;
 }
 function acceptAsset(scope,asset){
  if(!active()||scope!==target()||!overrideReady()||(scope.startsWith('entry:')||nativePage())&&(!label||label.key!==key()||label.loading||label.error||label.missing))throw Error(text('invalid'));
  const logos=editableLogos(scope);if(logos.some(a=>a.id===asset.id))return;if(logos.length>=4)throw Error(text('limit'));logos.push({id:asset.id,alt:''});
 }
 function view(){
  sync();const scope=target(),known=overrideReady(),logos=known?logosFor(state.book,scope):[],record=needsLabel(),ready=known&&nameReady();
  const choices=[option('home',text('home'),scope),...(documents?.enabled()?['project','notebook']:['project','notebook','page']).flatMap(kind=>state.book[kind==='project'?'projects':kind==='notebook'?'notebooks':'pages'].map(item=>option(kind+':'+item.id,text(kind,{title:item.title}),scope)))];
  if(record)choices.push(option(scope,text(nativePage()?'page':'record',{title:label?.title??text('selectedRecord')}),scope));if(documents?.enabled())choices.push(option('page-picker',text('choosePage'),scope));choices.push(option('record-picker',text('chooseRecord'),scope));
  const back=state.brandReturn?.startsWith('#/website')?'backWebsite':!state.brandReturn||state.brandReturn.startsWith('#/preferences')?'backAppearance':'backPrevious';
  return `<div class="page-heading"><div><button class="button branding-return" data-action="branding-back">${esc(text(back))}</button><h1>${esc(text('title'))}</h1><p class="subtitle">${esc(text('description'))}</p></div></div>
   <section class="panel" data-branding-panel>${field(esc(text('scope')),`<select id="branding-target">${choices.join('')}</select>`)}
   <div data-branding-label-status>${labelMessage()}</div>
   ${!known?`<p role="${override?.error?'alert':'status'}">${esc(override?.error??text('overrideLoading'))}</p>${override?.error?`<button class="button" data-action="brand-override-retry">${esc(text('overrideRetry'))}</button>`:''}`:''}
   ${native()&&known&&state.book.branding.some(item=>item.target===scope)?`<button class="button" data-action="brand-default">${esc(text('useDefault'))}</button>`:''}
   <div class="branding-grid">${logos.map((logo,index)=>`<div class="logo-editor"><img src="${esc(ownedAssetURL(state,'/api/media/'+logo.id))}" alt="${esc(logo.alt||text('preview'))}">${field(esc(text('alt',{number:index+1})),`<input data-logo-alt="${index}" maxlength="160" value="${esc(logo.alt)}" ${ready?'':'disabled'}>`)}<div class="inline-actions"><button class="button" data-action="brand-up" data-index="${index}" ${index===0||!ready?'disabled':''}>${esc(text('earlier'))}</button><button class="button" data-action="brand-remove" data-index="${index}" ${ready?'':'disabled'}>${esc(text('remove',{number:index+1}))}</button></div></div>`).join('')}</div>
   ${logos.length<4?field(esc(text('add')),`<input type="file" data-upload="branding" data-target="${esc(scope)}" accept="image/svg+xml,.svg,image/png,image/jpeg,image/webp,image/bmp,image/tiff" ${uploading()||!ready?'disabled':''}>`):`<p>${esc(text('full'))}</p>`}<p class="muted">${esc(text('formats'))}</p></section>`;
 }
 return {view,bind,sync,stop,input,action,editableLogos,acceptAsset};
}

import {progressUnit} from './progress-units.js';
import {t} from './i18n/index.js';
import {operationProgress} from './operation-progress-ui.js';
import {storageSize} from './storage-progress-presentation.js';

export function workspaceDeletionUI({api,accessOwners=operation=>operation(),esc,field,showDialog,ready,switched,refreshWorkspaces,notify}){
 const m=(key,args)=>t('workspaceDeletion',key,args);let review;
 const button=(path='')=>`<button class="button danger" data-action="storage-delete-dialog" data-path="${esc(path)}">${esc(m('delete'))}</button>`;
 const pending=items=>items?.length?`<section><h3>${esc(m('pending'))}</h3><p>${esc(m('pendingHint'))}</p>${items.map(item=>`<article><strong>${esc(item.title||m('workspace'))}</strong><p class="storage-path">${esc(item.source)}</p><button class="button" data-action="storage-delete-finish" data-id="${esc(item.id)}" data-path="${esc(item.source)}">${esc(m('finish'))}</button></article>`).join('')}</section>`:'';
 function credentials(){return `${field(esc(m('username')),'<input name="username" maxlength="80" autocomplete="username">')}${field(esc(m('password')),'<input name="password" type="password" maxlength="1024" autocomplete="current-password">')}<details><summary>${esc(m('recovery'))}</summary>${field(esc(m('recovery')),'<input name="recovery" type="password" autocomplete="off">')}</details>`;}
 async function prepare(path='',access={}){
  const selected=!!path;
  review={...await api(selected?'/api/workspaces/delete/preview':'/api/storage/delete/preview',selected?{path,...access}:{}),selected};
   showDialog(`<form id="storage-delete-form"><h2 id="dialog-title">${esc(m('title'))}</h2><strong>${esc(review.title)}</strong><p class="storage-path">${esc(review.source)}</p><p>${esc(m('scope'))}</p><p>${esc(m('database-'+review.database))}</p><p>${esc(m('retained'))}</p>${field(esc(m('name')),'<input name="title" required autocomplete="off" spellcheck="false">')}<label><input type="checkbox" name="confirmed" required> ${esc(m('confirm'))}</label><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">${esc(m('cancel'))}</button><button type="submit" class="button danger">${esc(m('delete'))}</button></div></form>`);
 }
 async function action(button){
  if(button.dataset.action==='storage-delete-dialog'){
   const path=button.dataset.path||'';if(!path&&!await ready())return true;
   try{await prepare(path);}
   catch(error){
    if(!path||!['ACCESS_DENIED','DEVICE_UNKNOWN','DEVICE_UNAVAILABLE','DEVICE_INVALID'].includes(error.code))throw error;
    showDialog(`<form id="storage-delete-unlock-form" data-path="${esc(path)}"><h2 id="dialog-title">${esc(m('title'))}</h2><p class="storage-path">${esc(path)}</p><p>${esc(m('authenticate'))}</p>${credentials()}<div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">${esc(m('cancel'))}</button><button type="submit" class="button primary">${esc(m('continue'))}</button></div></form>`);
   }
   return true;
  }
  if(button.dataset.action==='storage-delete-finish'){
   showDialog(`<form id="storage-delete-finish-form" data-id="${esc(button.dataset.id)}"><h2 id="dialog-title">${esc(m('finish'))}</h2><p class="storage-path">${esc(button.dataset.path)}</p><p>${esc(m('pendingHint'))}</p><p>${esc(m('credentials'))}</p>${field(esc(m('username')),'<input name="username" autocomplete="username">')}${field(esc(m('password')),'<input name="password" type="password" autocomplete="current-password">')}${field(esc(m('recovery')),'<input name="recovery" type="password" autocomplete="off">')}<div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">${esc(m('cancel'))}</button><button type="submit" class="button danger">${esc(m('finish'))}</button></div></form>`);return true;
  }
  return false;
 }
 async function submit(form,data){
  if(form.id==='storage-delete-unlock-form'){await prepare(form.dataset.path,{username:data.get('username'),password:data.get('password'),recovery:data.get('recovery')});return true;}
  const finish=form.id==='storage-delete-finish-form';if(!finish&&form.id!=='storage-delete-form')return false;
  if(!finish&&data.get('title')!==review?.title){form.elements.title.setCustomValidity(t('errors','STORAGE_DELETE_CONFIRM'));form.elements.title.reportValidity();form.elements.title.oninput=()=>form.elements.title.setCustomValidity('');return true;}
  const progress=operationProgress({className:'storage-progress',host:form,stageText:key=>m(key),presentation:value=>{
   const deleting=value.stage==='delete-files'&&Number.isSafeInteger(value.total),count=value.completed?.toLocaleString()??'0';
   return {path:'',count:deleting?m('count',{count,total:value.total.toLocaleString()}):['delete-check','delete-count','delete-check-owners'].includes(value.stage)?m('checking',{count}):['projects','books'].includes(value.unit)&&Number.isSafeInteger(value.total)?m('ownerCount',{count,total:value.total.toLocaleString(),unit:progressUnit(value.unit)}):'',work:deleting?m('bytes',{size:storageSize(value.activity?.bytes)}):'',detail:'',barLabel:m('delete'),total:value.total??0,completed:value.completed??0};
  }});
  let error,result;
  const command=()=>{if(!form.isConnected){const dialog=document.getElementById('dialog');dialog.replaceChildren(form);dialog.showModal();}return api(finish?'/api/workspaces/delete/finish':review.selected?'/api/workspaces/delete/confirm':'/api/storage/delete',finish?{id:form.dataset.id,confirmed:true,username:data.get('username'),password:data.get('password'),recovery:data.get('recovery')}:{id:review.id,path:review.source,title:data.get('title'),confirmed:data.get('confirmed')==='on'},{onProgress:progress.update});};
  try{result=finish?await command():await accessOwners(command,review.selected?{unlock:(access,options)=>api('/api/workspaces/delete/unlock',{id:review.id,...access},{adopt:false,...options})}:{});}
  catch(e){error=e;}finally{progress.close();}
  if(finish||review.selected)await refreshWorkspaces();else await switched();
  if(error?.name==='AbortError'){if(!finish&&review.selected)await api('/api/workspaces/delete/cancel',{id:review.id},{adopt:false});return true;}
  if(error)notify(error.message+' '+m('retryHint'),true);else notify(m(result.result.cancelled?'cancelled':'done'));
  return true;
 }
 return {button,pending,action,submit};
}

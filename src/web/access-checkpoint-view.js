import {t} from './i18n/index.js';

export function accessCheckpointView(data,esc){
 return '<section class="security-section"><h3>'+esc(t('access','settingsCode'))+'</h3><p class="security-fingerprint">'+esc(data.fingerprint.match(/.{1,8}/g).join(' '))+'</p><p>'+esc(t('access','settingsHelp'))+'</p><button type="button" class="button" data-save-access-checkpoint>'+esc(t('access','settingsExport'))+'</button></section>';
}
export function bindAccessCheckpoint(node,load,onError){
 node.querySelector('[data-save-access-checkpoint]')?.addEventListener('click',async event=>{
  const button=event.currentTarget;button.disabled=true;
  try{
   const data=await load();if(!button.isConnected)return;
   const url=URL.createObjectURL(new Blob([JSON.stringify(data.checkpoint,null,2)],{type:'application/octet-stream'})),link=document.createElement('a');
   link.href=url;link.download='current.observanda-access';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){onError(error);}finally{button.disabled=false;}
 });
}

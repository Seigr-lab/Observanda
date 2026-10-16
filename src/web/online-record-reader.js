import {t} from './i18n/index.js';
import {recordRevisionView} from './record-revision-view.js';
import {applyRichTextStyles} from './rich-text-stylesheet.js';

// The reader is a saved host snapshot. Fetch on opening or explicit refresh,
// without replacing the mounted writer or its unsaved detail fields.
export function mountOnlineRecordReader(host,{remote,recordId,esc,assetUrl}){
 let busy=false,generation=0;
 host.innerHTML='<summary>'+esc(t('online','read'))+'</summary><p>'+esc(t('online','readSnapshot'))+'</p><button type="button" class="button" data-reader-refresh>'+esc(t('online','refresh'))+'</button><p role="status" data-reader-status></p><div data-reader-record></div>';
 const button=host.querySelector('button'),status=host.querySelector('[data-reader-status]'),view=host.querySelector('[data-reader-record]');
 async function refresh(){
  if(busy)return;busy=true;button.disabled=true;const request=++generation;status.textContent=t('online','busy');
  try{
   const {record}=await remote('read',{recordId});if(!host.isConnected||request!==generation)return;
   view.innerHTML=recordRevisionView(record,esc,{assetUrl,figureSources:false});applyRichTextStyles(document,record);status.textContent='';
  }catch(error){if(host.isConnected&&request===generation)status.textContent=error.message;}
  finally{busy=false;button.disabled=false;}
 }
 host.addEventListener('toggle',()=>{if(host.open)void refresh();});button.addEventListener('click',()=>void refresh());
}

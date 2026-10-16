import {t} from './i18n/index.js';
const text=(key,args)=>t('recordDrafts',key,args);
// Older checkpoints can own several records. Choose one while preserving the
// others, and show durable completion after restart or a lost acknowledgement.
export function recordDraftRecords({api,esc}){
 return async(header,{signal}={})=>{
  const dialog=document.createElement('dialog');dialog.className='record-recovery record-draft-records';dialog.setAttribute('aria-labelledby','draft-records-title');document.body.append(dialog);
  const before=document.activeElement;let page=null,offset=0,request=null,done=false,resolve;
  const result=new Promise(callback=>resolve=callback),button=(key,action,disabled=false)=>'<button class="button" type="button" data-draft-records="'+action+'"'+(disabled?' disabled':'')+'>'+esc(text(key))+'</button>';
  const close=position=>{if(done)return;done=true;request?.abort();signal?.removeEventListener('abort',abort);dialog.close();dialog.remove();if(before?.isConnected)before.focus({preventScroll:true});resolve(position);},abort=()=>close(null);
  const render=(busy=false,error='')=>{
   dialog.innerHTML='<h2 id="draft-records-title" tabindex="-1">'+esc(text('recordsTitle'))+'</h2><p>'+esc(text('recordsDescription'))+'</p><div class="record-draft-rows">'+(busy?'<p role="status">'+esc(text('loading'))+'</p>':(page?.items??[]).map(item=>'<section class="record-draft-row"><h3>'+esc(item.title||text('untitled'))+'</h3>'+button(item.recovered?'recordRecovered':'review','select-'+item.position,item.recovered)+'</section>').join(''))+'</div><nav class="inline-actions" aria-label="'+esc(text('recordsPages'))+'">'+button('recordsPrevious','previous',busy||offset===0)+button('recordsNext','next',busy||!page||offset+page.items.length>=page.total)+'</nav><p role="alert">'+esc(error)+'</p><div class="dialog-actions">'+(error?button('retry','retry'):'')+button('close','close')+'</div>';
  };
  async function load(next){
   request?.abort();const controller=new AbortController();request=controller;offset=next;render(true);
   try{
    const {draft,revision}=header,value=await api('/api/research/drafts/review/records',{id:draft.id,workspaceId:draft.workspaceId,expectedRevision:revision,offset},{adopt:false,signal:controller.signal});
    if(done||controller.signal.aborted)return;
    if(value?.id!==draft.id||value.workspaceId!==draft.workspaceId||value.revision!==revision||value.offset!==offset||!Number.isSafeInteger(value.total)||value.total<1||!Array.isArray(value.items)||value.items.length>4||!value.items.every((item,i)=>item.position===offset+i&&item.position<value.total&&typeof item.title==='string'&&typeof item.recovered==='boolean'))throw Error(text('invalidPage'));
    page=value;render();dialog.querySelector('h2').focus();
   }catch(error){if(!done&&!controller.signal.aborted)render(false,error.message??text('readFailed'));}
  }
  dialog.oncancel=event=>{event.preventDefault();close(null);};
  dialog.onclick=event=>{const action=event.target.closest('[data-draft-records]')?.dataset.draftRecords;if(action==='close')close(null);else if(action==='next')void load(offset+4);else if(action==='previous')void load(Math.max(0,offset-4));else if(action==='retry')void load(offset);else if(action?.startsWith('select-')){const position=Number(action.slice(7));if(page?.items.some(item=>item.position===position&&!item.recovered))close(position);}};
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){close(null);return result;}
  render(true);dialog.showModal();void load(0);return result;
 };
}

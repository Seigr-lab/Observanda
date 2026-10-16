import {renderProse} from './prose-model.js';
import {t} from './i18n/index.js';
const text=(key,args)=>t('recordDrafts',key,args);

// A checkpoint preview is independent of the editable record. Viewing later
// sections never turns the omitted sections into an empty editable collection.
export function recordDraftPreview({api,esc}){
 return async(result,{signal}={})=>{
  const {draft,revision}=result,dialog=document.createElement('dialog');dialog.className='record-recovery record-draft-preview';
  dialog.setAttribute('aria-labelledby','draft-preview-title');document.body.append(dialog);
  const before=document.activeElement;let offset=0,page=null,request=null,resolve,settled=false;
  const answer=new Promise(done=>{resolve=done;});
  const button=(key,action,disabled=false)=>'<button type="button" class="button" data-preview-'+action+(disabled?' disabled':'')+'>'+esc(text(key))+'</button>';
  const close=accepted=>{if(settled)return;settled=true;request?.abort();dialog.close();dialog.remove();signal?.removeEventListener('abort',cancel);if(before?.isConnected)before.focus({preventScroll:true});resolve(accepted);};
  const cancel=()=>close(false);
  const render=(loading=false,error=null)=>{
   const section=page?.sections;
   dialog.innerHTML='<h2 id="draft-preview-title" tabindex="-1">'+esc(page?.title??draft.titles[0]??text('untitled'))+'</h2><p>'+esc(text('previewDescription'))+'</p><div class="record-draft-preview-content" aria-busy="'+loading+'">'+
    (loading?'<p role="status">'+esc(text('previewLoading'))+'</p>':error?'<p role="alert">'+esc(error)+'</p>'+button('previewRetry','retry'):
     (page?.body!==null?renderProse(page?.body??''):'')+(section?.values??[]).map(value=>'<section><h3>'+esc(value.title)+'</h3>'+renderProse(value.body)+'</section>').join(''))+'</div>'+
    '<nav class="inline-actions" aria-label="'+esc(text('previewNavigation'))+'">'+button('previewPrevious','previous',loading||offset===0)+button('previewNext','next',loading||!section||section.offset+section.values.length>=section.total)+(section?'<span role="status">'+esc(text('previewRange',{first:section.total?section.offset+1:0,last:section.offset+section.values.length,total:section.total}))+'</span>':'')+
    (section?.total?'<label>'+esc(text('previewGoTo'))+' <input type="number" data-preview-position min="1" max="'+section.total+'" required value="'+(offset+1)+'"></label>'+button('previewGo','go',loading):'')+'</nav>'+
    '<div class="dialog-actions">'+button('previewBack','back')+button('previewRecover','recover',loading||!!error)+'</div>';
  };
  async function load(next){
   request?.abort();const controller=new AbortController();request=controller;offset=next;render(true);
   try{
    const plan=result.reviewPlan,value=await api(plan?'/api/research/drafts/review/content':'/api/research/drafts/content',plan?{id:plan.id,workspaceId:plan.workspaceId,expectedRevision:plan.revision,offset}:{id:draft.id,workspaceId:draft.workspaceId,expectedRevision:revision,offset},{adopt:false,signal:controller.signal});
    if(settled||controller.signal.aborted)return;
    if(value?.id!==draft.id||value.workspaceId!==draft.workspaceId||value.revision!==revision||value.sections?.offset!==offset||!Array.isArray(value.sections.values)||value.sections.values.length>4||!Number.isSafeInteger(value.sections.total))throw Error(text('invalidPage'));
    page=value;render();dialog.querySelector('h2').focus();
   }catch(error){if(!settled&&!controller.signal.aborted){render(false,error.message??text('readFailed'));dialog.querySelector('[role="alert"]')?.scrollIntoView({block:'nearest'});}}
  }
  dialog.oncancel=event=>{event.preventDefault();close(false);};
  dialog.onclick=event=>{
   if(event.target.closest('[data-preview-back]'))close(false);
   else if(event.target.closest('[data-preview-recover]'))close(true);
   else if(event.target.closest('[data-preview-next]'))void load(offset+4);
   else if(event.target.closest('[data-preview-previous]'))void load(Math.max(0,offset-4));
   else if(event.target.closest('[data-preview-retry]'))void load(offset);
   else if(event.target.closest('[data-preview-go]')){const input=dialog.querySelector('[data-preview-position]');if(input.reportValidity())void load(Number(input.value)-1);}
  };
  signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted){close(false);return answer;}
  render(true);dialog.showModal();void load(0);return answer;
 };
}

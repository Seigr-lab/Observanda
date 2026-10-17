import {t} from './i18n/index.js';
import {revisionId} from './revision-model.js';
const text=(key,args)=>t('configurationEditor',key,args);

// Choice pages are views over one immutable saved/checkpoint field schema.
// The selected scalar remains visible independently of the current page.
export function customFieldChoices({api,esc,lifecycle}){
 let base=null,value=null,changed=null,container=null,page=null,error=null,busy=false,query='',epoch=0,controller=null,timer=null;
 const selected=()=>value?.value??'';
 function release(){epoch++;controller?.abort();controller=null;clearTimeout(timer);timer=null;container=null;}
 function fields(next,selectedValue,onChange){
  release();base=next;value=selectedValue;changed=onChange;page=null;error=null;busy=false;query='';
  return '<div data-custom-choice-window><input data-custom-choice-selected readonly value="'+esc(selected())+'"><label class="field">'+esc(text('searchChoices'))+'<input data-custom-choice-search maxlength="160" value=""></label><div data-custom-choice-results></div></div>';
 }
 function paint(){
  if(!container?.isConnected)return;
  const selectedInput=container.querySelector('[data-custom-choice-selected]');if(selectedInput)selectedInput.value=selected();
  const host=container.querySelector('[data-custom-choice-results]');host.innerHTML='<p role="status">'+esc(error?.message??(busy?text('loading'):page?.total?text('range',{first:page.offset+1,last:page.offset+page.items.length,total:page.total}):text('noChoices')))+'</p>'+
   '<div class="inline-actions">'+(page?.items??[]).map(item=>'<button type="button" class="button" data-custom-choice="'+esc(item)+'" aria-pressed="'+(item===selected())+'">'+esc(item)+'</button>').join('')+'</div><div class="inline-actions"><button type="button" class="button" data-custom-choice-page="previous" '+(busy||!page?.offset?'disabled':'')+'>'+esc(text('previous'))+'</button><button type="button" class="button" data-custom-choice-page="next" '+(busy||page?.next==null?'disabled':'')+'>'+esc(text('next'))+'</button>'+(error?'<button type="button" class="button" data-custom-choice-page="retry">'+esc(text('retry'))+'</button>':'')+'<button type="button" class="button" data-custom-choice-clear>'+esc(text('clearChoice'))+'</button></div>';
 }
 async function load(offset=0){
  const request=++epoch,context=lifecycle.context();controller?.abort();controller=new AbortController();busy=true;error=null;paint();
  const command={workspaceId:base.workspaceId,recordId:base.recordId,storageRevision:base.storageRevision,field:base.field,schemaRevision:base.definition.schemaRevision,offset,query,...(Object.hasOwn(base,'editRevision')?{editRevision:base.editRevision}:{})};
  try{
   const response=await api('/api/research/records/values/choices',command,{adopt:false,signal:controller.signal});
   if(request!==epoch||context!==lifecycle.context())return;
   if(response.workspaceId!==command.workspaceId||response.recordId!==command.recordId||(Object.hasOwn(command,'editRevision')?response.editRevision!==command.editRevision:response.storageRevision!==command.storageRevision)||response.field!==command.field||response.schemaRevision!==command.schemaRevision||!Array.isArray(response.items)||response.items.length>32||response.items.some(item=>typeof item!=='string'||item.length>160)||!Number.isSafeInteger(response.total)||!Number.isSafeInteger(response.offset)||response.offset<0||response.offset+response.items.length>response.total||response.next!==null&&(!Number.isSafeInteger(response.next)||response.next<=response.offset))throw Error(text('invalid'));
   page=response;
  }catch(reason){if(request===epoch&&context===lifecycle.context()&&reason.name!=='AbortError')error=reason;}
  finally{if(request===epoch&&context===lifecycle.context()){busy=false;paint();}}
 }
 function bind(root){
  container=root.querySelector('[data-custom-choice-window]');if(!container)return;
  container.oninput=event=>{if(!event.target.hasAttribute('data-custom-choice-search'))return;event.stopPropagation();query=event.target.value;clearTimeout(timer);timer=setTimeout(()=>void load(),200);};
  container.onclick=event=>{
   const target=event.target.closest('button');if(!target||!container.contains(target))return;
   if(target.hasAttribute('data-custom-choice')||target.hasAttribute('data-custom-choice-clear')){event.stopPropagation();value.value=target.hasAttribute('data-custom-choice-clear')?'':target.dataset.customChoice;changed();paint();return;}
   if(target.dataset.customChoicePage){event.stopPropagation();void load(target.dataset.customChoicePage==='next'?page.next:target.dataset.customChoicePage==='previous'?Math.max(0,page.offset-32):page?.offset??0);}
  };
  paint();void load();
 }
 return {fields,bind,release,supported:definition=>definition?.type==='select'&&revisionId(definition.schemaRevision)&&Number.isSafeInteger(definition.choiceCount)};
}

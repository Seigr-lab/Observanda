import {configurationDocumentClient} from './configuration-document-client.js';
import {enabledLabBookTypes} from './feature-modules.js';
import {RECORD_TYPES} from './record-types.js';
import {t} from './i18n/index.js';

export function configurationTypeChoices({state,api,esc,showDialog}){
 let notebook=null,options=null,page=null,error=null,busy=false,controller=null,epoch=0,search='';
 const instance=crypto.randomUUID(),client=configurationDocumentClient({state,api});
 const text=(key,args)=>t('configurationEditor',key,args);
 const root=()=>document.querySelector('#dialog[open] [data-configuration-type-choices="'+instance+'"]');
 function stop(){if(root())document.querySelector('#dialog').close();epoch++;controller?.abort();controller=null;client.stop();notebook=options=page=error=null;busy=false;search='';}
 function view(){
  const labels=page?.rows??[];
  const custom=row=>'<button type="button" class="record-type-option" aria-label="'+esc(t('recordAuthoring','createType',{type:row.value.label.toLowerCase()}))+'" data-action="configuration-type-select" data-key="'+esc(row.key)+'" '+(busy?'disabled':'')+'><strong>'+esc(row.value.label)+'</strong><span>'+esc(row.value.description)+'</span></button>';
  return '<div data-configuration-type-choices="'+instance+'"><h2 id="dialog-title">'+esc(options.title)+'</h2>'+(options.description?'<p>'+esc(options.description)+'</p>':'')+
   '<label class="field">'+esc(text('search'))+'<input data-configuration-type-search maxlength="160" value="'+esc(search)+'"></label><div class="record-type-grid">'+labels.map(custom).join('')+'</div>'+
   '<p role="status">'+esc(error?.message??(busy?text('loading'):page?.total?text('range',{first:page.offset+1,last:page.offset+page.rows.length,total:page.total}):text('noTypes')))+'</p>'+
   '<div class="inline-actions"><button type="button" class="button" data-action="configuration-type-previous" '+(busy||!page?.offset?'disabled':'')+'>'+esc(text('previous'))+'</button><button type="button" class="button" data-action="configuration-type-next" '+(busy||page?.next==null?'disabled':'')+'>'+esc(text('next'))+'</button>'+(error?'<button type="button" class="button" data-action="configuration-type-retry">'+esc(text('retry'))+'</button>':'')+'</div>'+
   '<details '+(!labels.length?'open':'')+'><summary>'+esc(t('recordAuthoring','generalTypes'))+'</summary><div class="record-type-grid">'+RECORD_TYPES.map(value=>'<button type="button" class="record-type-option" aria-label="'+esc(t('recordAuthoring','createType',{type:value.label.toLowerCase()}))+'" data-action="configuration-type-general" data-type="'+value.id+'"><strong>'+esc(value.label)+'</strong><span>'+esc(value.description)+'</span></button>').join('')+'</div></details>'+
   '<div class="dialog-actions">'+(options.starters?'<button type="button" class="button" data-action="starter-library" data-notebook="'+notebook.id+'">'+esc(t('recordStarters','library'))+'</button>':'')+'<button type="button" class="button" data-action="close-dialog">'+esc(text('cancel'))+'</button></div></div>';
 }
 function paint(){if(!options)return;const focused=root()?.querySelector('[data-configuration-type-search]')===document.activeElement,selection=focused?[document.activeElement.selectionStart,document.activeElement.selectionEnd]:null;showDialog(view());if(focused){const input=root()?.querySelector('[data-configuration-type-search]');input?.focus();input?.setSelectionRange(...selection);}}
 async function load(offset=0,{open=false}={}){
  const request=++epoch;controller?.abort();controller=new AbortController();busy=true;error=null;paint();
  try{
   if(open)await client.open({workspaceId:state.book.id,projectId:notebook.projectId,notebookId:notebook.id,slot:'configuration'},{signal:controller.signal,saved:true});
   const result=await client.window('sections',{enabled:true,allowedProfiles:enabledLabBookTypes(state.dashboardSettings).map(profile=>profile.id),offset,limit:20,search,signal:controller.signal});
   if(request===epoch)page=result;
  }catch(reason){if(request===epoch&&reason.name!=='AbortError')error=reason;}
  finally{if(request===epoch){busy=false;paint();}}
 }
 async function open(value,input){stop();notebook=value;options=input;await load(0,{open:true});}
 async function action(control){
  if(!control.dataset.action?.startsWith('configuration-type-')||!root()?.contains(control))return false;
  const name=control.dataset.action;
  if(name==='configuration-type-general'){const callback=options.onChoose,book=notebook;stop();await callback({type:control.dataset.type,notebookId:book.id});return true;}
  if(busy)return true;
  if(name==='configuration-type-select'){
   const row=page?.rows.find(row=>row.key===control.dataset.key);if(!row)return true;
   const choice={type:'note',notebookId:notebook.id,section:{...row.value,configurationPin:client.descriptor().configurationPin,sectionId:row.key}},callback=options.onChoose;
   // The saved pin stays captured even if another author edits this type.
   await callback(choice);stop();return true;
  }
  await load(name==='configuration-type-next'?page.next:name==='configuration-type-previous'?Math.max(0,page.offset-20):page?.offset??0,{open:!client.descriptor()});return true;
 }
 function input(element){if(!element.hasAttribute('data-configuration-type-search')||!root()?.contains(element))return false;search=element.value;void load();return true;}
 return {open,action,input,stop};
}

import {configurationDocumentClient} from './configuration-document-client.js';
import {enabledLabBookTypes} from './feature-modules.js';
import {RECORD_TYPES} from './record-types.js';
import {recordTypePresentation} from './record-type-presentation.js';
import {t} from './i18n/index.js';
import {templateText} from './custom-field-presentation.js';

export function configurationTypeChoices({state,api,esc,showDialog}){
 let notebook=null,options=null,page=null,error=null,busy=false,controller=null,epoch=0,search='',shown=false;
 const instance=crypto.randomUUID(),client=configurationDocumentClient({state,api});
 const text=(key,args)=>t('configurationEditor',key,args);
 const root=()=>document.querySelector('#dialog[open] [data-configuration-type-choices="'+instance+'"]');
 function stop(){if(root())document.querySelector('#dialog').close();epoch++;controller?.abort();controller=null;client.stop();notebook=options=page=error=null;busy=false;search='';shown=false;}
 const matches=(label,description)=>!search.trim()||[label,description].some(value=>typeof value==='string'&&value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
 function view(){
  const labels=page?.rows??[],orderedTypes=[...RECORD_TYPES.map(recordTypePresentation)].filter(value=>matches(value.label,value.description)).sort((a,b)=>['note','observation'].indexOf(a.id)<0?(['note','observation'].includes(b.id)?1:0):['note','observation'].indexOf(b.id)<0?-1:['note','observation'].indexOf(a.id)-['note','observation'].indexOf(b.id));
  const custom=row=>'<button type="button" class="record-type-option" aria-label="'+esc(t('recordAuthoring','createType',{type:templateText(row.value.label).toLocaleLowerCase()}))+'" data-action="configuration-type-select" data-key="'+esc(row.key)+'" '+(busy?'disabled':'')+'><strong>'+esc(templateText(row.value.label))+'</strong><span>'+esc(templateText(row.value.description))+'</span></button>';
  return '<div data-configuration-type-choices="'+instance+'"><h2 id="dialog-title">'+esc(options.title)+'</h2>'+(options.description?'<p>'+esc(options.description)+'</p>':'')+
   (labels.length||search?'<label class="field">'+esc(text('search'))+'<input data-configuration-type-search maxlength="160" value="'+esc(search)+'"></label><div class="record-type-grid">'+labels.map(custom).join('')+'</div>':'')+
   (busy||error||page?.total||search?'<p role="status">'+esc(error?.message??(busy?text('loading'):page?.total?text('range',{first:page.offset+1,last:page.offset+page.rows.length,total:page.total}):text(search.trim()?'noMatches':'noTypes')))+'</p>':'')+
   (page?.total>20||error?'<div class="inline-actions"><button type="button" class="button" data-action="configuration-type-previous" '+(busy||!page?.offset?'disabled':'')+'>'+esc(text('previous'))+'</button><button type="button" class="button" data-action="configuration-type-next" '+(busy||page?.next==null?'disabled':'')+'>'+esc(text('next'))+'</button>'+(error?'<button type="button" class="button" data-action="configuration-type-retry">'+esc(text('retry'))+'</button>':'')+'</div>':'')+
   (orderedTypes.length?'<details '+(!labels.length||search.trim()?'open':'')+'><summary>'+esc(t('recordAuthoring','generalTypes'))+'</summary><div class="record-type-grid">'+orderedTypes.map(value=>'<button type="button" class="record-type-option" aria-label="'+esc(t('recordAuthoring','createType',{type:value.label.toLowerCase()}))+'" data-action="configuration-type-general" data-type="'+value.id+'"><strong>'+esc(value.label)+'</strong><span>'+esc(value.description)+'</span></button>').join('')+'</div></details>':'')+
   '<div class="dialog-actions">'+(options.starters?'<button type="button" class="button" data-action="starter-library" data-notebook="'+notebook.id+'">'+esc(t('recordStarters','library'))+'</button>':'')+'<button type="button" class="button" data-action="close-dialog">'+esc(text('cancel'))+'</button></div></div>';
 }
 // Once shown, a closed or replaced dialog ends this chooser; a late page never reopens it.
 function paint(){if(!options)return;if(shown&&!root()){stop();return;}const focused=root()?.querySelector('[data-configuration-type-search]')===document.activeElement,selection=focused?[document.activeElement.selectionStart,document.activeElement.selectionEnd]:null;showDialog(view());shown=true;if(focused){const input=root()?.querySelector('[data-configuration-type-search]');input?.focus();input?.setSelectionRange(...selection);}}
 async function load(offset=0,{open=false}={}){
  const request=++epoch;controller?.abort();controller=new AbortController();busy=true;error=null;paint();
  try{
   if(open)await client.open({workspaceId:state.book.id,projectId:notebook.projectId,notebookId:notebook.id,slot:'configuration'},{signal:controller.signal,saved:true});
   if(request!==epoch||!root())return;
   const selectors={available:true,allowedProfiles:enabledLabBookTypes(state.dashboardSettings).map(profile=>profile.id),signal:controller.signal};
   // Stored labels are canonical; a search reads every active type and matches the translated text shown.
   let result;if(!search.trim())result=await client.window('sections',{...selectors,offset,limit:20});
   else{const found=[];for(let at=0;at!==null&&request===epoch;){const part=await client.window('sections',{...selectors,offset:at,limit:32});found.push(...part.rows.filter(row=>matches(templateText(row.value.label),templateText(row.value.description))));at=part.next;}
    result={rows:found.slice(offset,offset+20),total:found.length,offset,next:offset+20<found.length?offset+20:null};}
   if(request===epoch)page=result;
  }catch(reason){if(request===epoch&&reason.name!=='AbortError')error=reason;}
  finally{if(request===epoch){busy=false;if(root())paint();else stop();}}
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

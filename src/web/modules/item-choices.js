import {t} from '../i18n/index.js';
import {moduleForEntity,enabledModule} from '../feature-modules.js';
import {moduleItemPages,validModuleSummary} from './item-pages.js';
const tr=(key,values)=>t('moduleCurrent',key,values);
export function moduleItemChoices(services,{current,changed,draw,moduleId,fields=()=>[],includeLinks=true}){
 const {api,state,esc,field,showDialog}=services;
 let session=null,timer=null,labelRequest=null,labelKey=null,labelError=null,labels=new Map(),generation=0;
 const identity=()=>JSON.stringify([state.storage?.contextId,state.book?.id,current()?.id]);
 const active=()=>state.page==='module'&&state.moduleId===moduleId&&!state.access?.locked&&!state.storageUnavailable;
 const owner=item=>moduleForEntity({type:item.type,data:{}},[]);
 const fieldValue=(config,draft=current())=>config.get?config.get(draft):draft?.data[config.key];
 const selectable=item=>{const module=owner(item),field=session?.field,value=field&&fieldValue(field);return item.id!==current()?.id&&(field?item.type===field.type&&(!field.multiple||!value?.includes(item.id)):module&&enabledModule(state.dashboardSettings,module.id));};
 const title=id=>{const item=labels.get(id);return item?item.title:labels.has(id)?tr('unavailable'):labelError?tr('labelsUnavailable'):tr('loading');};
 function choiceField(key,label){const config=fields(current()).find(f=>f.key===key);if(!config)return '';const value=fieldValue(config);return `<button type="button" class="button" data-action="module-choice-field" data-field="${esc(key)}" aria-label="${esc(label)}">${esc(!config.multiple&&value?title(value):label)}</button><span data-module-label-error></span>`;}
 const button=()=>`<button type="button" class="button" data-action="module-choice-open">${esc(tr('choose'))}</button><span data-module-label-error></span>`;
 function linkContent(reference){
  const item=labels.get(reference.id),module=item&&owner(item);
  return item?`<button type="button" class="text-button" data-action="module-open" data-module-id="${esc(module?.id??'')}" data-module-path="${esc(item.openType+'/'+item.openId)}" ${module&&enabledModule(state.dashboardSettings,module.id)?'':'disabled'}>${esc(item.title)}</button>`:`<span>${esc(labels.has(reference.id)?tr('unavailable'):labelError?tr('labelsUnavailable'):tr('loading'))}</span>`;
 }
 const link=reference=>`<span data-module-label-link="${esc(reference.id)}" data-module-label-type="${esc(reference.type)}">${linkContent(reference)}</span>`;
 const label=id=>`<span data-module-item-title="${esc(id)}">${esc(title(id))}</span>`;
 function paintLabels(){
  for(const node of document.querySelectorAll('[data-module-label-link]'))node.innerHTML=linkContent({id:node.dataset.moduleLabelLink,type:node.dataset.moduleLabelType});
  for(const node of document.querySelectorAll('[data-module-item-title]'))node.textContent=title(node.dataset.moduleItemTitle);
  for(const node of document.querySelectorAll('[data-action="module-choice-field"]')){const config=fields(current()).find(f=>f.key===node.dataset.field),value=config&&fieldValue(config);if(config)node.textContent=!config.multiple&&value?title(value):node.getAttribute('aria-label');}
  let shown=false;for(const node of document.querySelectorAll('[data-module-label-error]')){node.innerHTML=labelError&&!shown?`<span role="alert">${esc(tr('labelsUnavailable'))}</span><button type="button" class="button" data-action="module-choice-retry-labels">${esc(tr('retryLabels'))}</button>`:'';shown=true;}
 }
 function stopPicker(){clearTimeout(timer);if(session){session.pages.clear();session.dialog.removeEventListener('close',stopPicker);}session=null;}
 function stop(){stopPicker();labelRequest?.abort();labelRequest=null;generation++;labelKey=null;labelError=null;labels.clear();}
 function valid(s){return session===s&&s.identity===identity()&&active()&&s.dialog.open&&s.root.isConnected;}
 function paint(){
  const s=session;if(!s||!valid(s))return;
  s.root.innerHTML=s.pages.view(item=>`<article class="module-item"><h3>${esc(item.title)}</h3><p>${esc(owner(item)?.label??item.type)}</p><button type="button" class="button" data-action="module-choice-select" data-id="${item.id}" ${selectable(item)?'':'disabled'}>${esc(tr('select',{title:item.title}))}</button></article>`);
 }
 async function bind(){
  if(!active()){stop();return;}if(session&&!valid(session))stopPicker();
  const refs=[...(includeLinks?current()?.data.links??[]:[]),...fields(current()).flatMap(f=>{const value=fieldValue(f);return (f.multiple?value??[]:value?[value]:[]).map(id=>({workspaceId:state.book.id,type:f.type,id}));}),...[...document.querySelectorAll('[data-module-label-link]')].map(n=>({workspaceId:state.book.id,type:n.dataset.moduleLabelType,id:n.dataset.moduleLabelLink}))].filter(r=>!['record','project','notebook'].includes(r.type)&&r.workspaceId===state.book.id),key=identity()+JSON.stringify(refs);
  if(labelKey===key){paintLabels();return;}labelKey=key;labelError=null;labelRequest?.abort();labelRequest=new AbortController();const request=++generation;
  const visible=new Set(refs.map(r=>r.id));for(const id of labels.keys())if(!visible.has(id))labels.delete(id);
  try{
   const ids=[...new Set(refs.map(r=>r.id))];
   for(let offset=0;offset<ids.length;offset+=25){
    const selected=ids.slice(offset,offset+25),result=await api('/api/modules/labels',{workspaceId:state.book.id,ids:selected},{signal:labelRequest.signal});
    if(request!==generation||!active()||labelKey!==key)return;
    if(result.workspaceId!==state.book.id||!Array.isArray(result.items)||!Array.isArray(result.missing)||result.items.length+result.missing.length!==selected.length||new Set([...result.items.map(i=>i.id),...result.missing]).size!==selected.length||result.items.some(i=>!validModuleSummary(i)||!selected.includes(i.id))||result.missing.some(id=>!selected.includes(id)))throw Error(tr('invalid'));
    for(const item of result.items)labels.set(item.id,item);for(const id of result.missing)labels.set(id,null);
   }
   if(ids.length)paintLabels();
  }catch(error){if(request===generation&&active()&&error.name!=='AbortError'){labelError=error;paintLabels();}}
 }
 async function action(node){
  if(!node.dataset.action?.startsWith('module-choice-'))return false;
  if(node.dataset.action==='module-choice-retry-labels'){labelKey=null;await bind();return true;}
  if(['module-choice-open','module-choice-field'].includes(node.dataset.action)){
   stopPicker();const draft=current();if(!draft)return true;
   const fieldConfig=node.dataset.action==='module-choice-field'?fields(draft).find(f=>f.key===node.dataset.field):null;if(node.dataset.action==='module-choice-field'&&!fieldConfig)return true;
   showDialog(`<h2 id="dialog-title">${esc(tr('choose'))}</h2>${field(esc(tr('search')),`<input type="search" data-module-choice-search maxlength="256">`)}<div data-module-choice-results></div><div class="dialog-actions"><button class="button" type="button" data-action="module-choice-cancel">${esc(tr('cancel'))}</button></div>`);
   const root=document.querySelector('[data-module-choice-results]'),dialog=root.closest('dialog');
   session={draft,field:fieldConfig,identity:identity(),root,dialog,pages:moduleItemPages({api,workspaceId:state.book.id,esc,draw:paint,prefix:'choice',action:'module-choice-page'})};dialog.addEventListener('close',stopPicker);
   await session.pages.load(fieldConfig?{type:fieldConfig.type,...fieldConfig.query}:undefined);return true;
  }
  const s=session;if(!s||!valid(s)){stopPicker();return true;}
  if(node.dataset.action==='module-choice-cancel'){s.dialog.close();stopPicker();document.querySelector('[data-action="module-choice-open"]')?.focus();}
  else if(node.dataset.action==='module-choice-page')await s.pages.action(node.dataset.command);
  else if(node.dataset.action==='module-choice-select'){
   const item=s.pages.page?.items.find(i=>i.id===node.dataset.id);if(!item||!selectable(item)||current()!==s.draft)return true;
   if(s.field?.select){
    node.disabled=true;
    try{const apply=await s.field.select(item,s.draft);if(!valid(s)||current()!==s.draft)return true;apply();}
    catch(error){if(valid(s))services.notify(error.message,true);return true;}finally{if(node.isConnected)node.disabled=false;}
   }else if(s.field){if(s.field.multiple)s.draft.data[s.field.key].push(item.id);else s.draft.data[s.field.key]=item.id;}
   else {const ref={workspaceId:state.book.id,type:item.type,id:item.id};if(!s.draft.data.links.some(r=>r.id===ref.id&&r.type===ref.type&&r.workspaceId===ref.workspaceId))s.draft.data.links.push(ref);}
   const fieldKey=s.field?.key;s.dialog.close();stopPicker();labelKey=null;labels.set(item.id,item);changed();draw();document.querySelector(fieldKey?'[data-field="'+fieldKey+'"][data-action="module-choice-field"]':'[data-action="module-choice-open"]')?.focus();
  }
  return true;
 }
 function input(node){
  if(!node.hasAttribute('data-module-choice-search'))return false;const s=session;if(!s||!valid(s))return true;
  clearTimeout(timer);const query=node.value;timer=setTimeout(()=>{if(valid(s))void s.pages.load({type:s.field?.type??null,...s.field?.query,query,status:''});},180);return true;
 }
 return {button,field:choiceField,title,label,link,bind,action,input,stop};
}

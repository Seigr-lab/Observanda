import {moduleReferencesUI} from './references-ui.js';
import {t} from '../i18n/index.js';
import {researchKindLabel} from '../research-reference.js';
import {projectUsesTool} from '../project-tools.js';
import {scopePath,parseScope,scopeControl,ownerOf,ownerLabel,scopedItems} from './scope.js';
import {moduleForEntity,enabledModule} from '../feature-modules.js';
import {displayValue,fieldLabel} from '../data-registry.js';
import {moduleRecovery} from './recovery.js';
import {moduleRecoveryView} from './recovery-ui.js';
import {moduleHistoryUI} from './history-ui.js';
import {validModuleRevision} from './revision.js';
import {applyModulePatch,applyModuleDomainReceipt} from './patch.js';
import {moduleItemPages} from './item-pages.js';
import {moduleItemChoices} from './item-choices.js';
// Common editing lifecycle; feature definitions own their fields and commands.
const tr=(key,values)=>t('moduleReferences',key,values);
const currentText=(key,values)=>t('moduleCurrent',key,values);

export async function moduleEditor(services,definition){
 const {state,api,esc,field,option,render,notify}=services;
 let snapshot=definition.paged?{workspaceId:state.book.id,revision:0,entities:[],partial:true}:(await api('/api/modules/data')).data,disposed=false,busy=false,error=null,query='',filter='',section='details',operation=null,pending=null;
 let initialized=false,openController=null,openGeneration=0,failedId=null,searchTimer=null;
 const identity=()=>JSON.stringify([state.storage?.contextId,state.book?.id,state.moduleId,state.modulePath]);
 function cancelReads(){clearTimeout(searchTimer);itemPages?.cancel();if(openController){openGeneration++;openController.abort();openController=null;busy=false;}}
 let scopeId=null,recursive=true,listQueryKey=null;
 const route=path=>definition.scoped?scopePath(scopeId,path):path;
 const conflicts=new Map();
 const disclosures=new Map();
 const drafts=new Map();let currentId=null,listType=definition.initialType??definition.types[0].id;
 function drawList(){
  if(!initialized||disposed||currentId||state.page!=='module'||state.moduleId!==definition.id)return;
  const input=document.activeElement?.matches('[data-module-search],[data-module-list-input]')?document.activeElement:null,start=input?.selectionStart,end=input?.selectionEnd;
  render();if(input){const next=input.hasAttribute('data-module-list-input')?document.querySelector('[data-module-list-input="'+CSS.escape(input.dataset.moduleListInput)+'"]'):document.querySelector('[data-module-search]');next?.focus({preventScroll:true});if(start!==null&&next?.setSelectionRange)next.setSelectionRange(start,end);}
 }
 function recoveryView(){return '<div data-module-recovery>'+moduleRecoveryView(recovery,{esc,button})+'</div>';}
 function drawRecovery(){
  if(!initialized||disposed||state.page!=='module'||state.moduleId!==definition.id)return;
  const host=document.querySelector('[data-module-recovery]');if(!host)return;
  const focused=host.contains(document.activeElement)?document.activeElement:null,command=focused?.dataset.command,id=focused?.dataset.id;
  const html=moduleRecoveryView(recovery,{esc,button});if(host.innerHTML===html)return;host.innerHTML=html;
  if(command){const next=[...host.querySelectorAll('[data-command]')].find(node=>!node.disabled&&node.dataset.command===command&&node.dataset.id===id);next?.focus({preventScroll:true});}
 }
 const itemPages=definition.paged?moduleItemPages({api,workspaceId:state.book.id,esc,draw:drawList}):null;
 const listQuery=()=>({type:listType,query,status:filter,...(definition.listQuery?.(listType)??{}),...(definition.scoped?{moduleId:definition.id,projectId:scopeId,recursive}:{})});
 const loadItems=()=>{const options=listQuery();listQueryKey=JSON.stringify(options);return itemPages.load(options);};
 if(itemPages)await loadItems();
 const historyPages=moduleHistoryUI({api,esc,draw:()=>{if(!disposed)render();},current:()=>drafts.get(currentId)});
 let recoveryReady=false;
 const recovery=await moduleRecovery({api,workspaceId:state.book.id,moduleId:definition.id,onStatus:()=>{status();if(recoveryReady&&!disposed&&!busy&&!currentId&&drafts.size&&recovery.canPark())void releaseDrafts();},onChange:()=>{if(recoveryReady)drawRecovery();}});recoveryReady=true;
 const operationDirty=()=>!!operation&&JSON.stringify(operation.values)!==JSON.stringify(operation.base);
 const checkpoint=()=>recovery.schedule([...drafts.values()].filter(d=>dirty(d)||d.id===currentId&&operationDirty()&&definition.recoverOperation).map(d=>d.id===currentId&&operationDirty()&&definition.recoverOperation?{...d,operation}:d));
 const references=moduleReferencesUI(services,{moduleId:definition.id,current:()=>drafts.get(currentId),changed:change,draw:()=>render()});
 const itemChoices=definition.paged?moduleItemChoices(services,{moduleId:definition.id,fields:draft=>definition.itemFields?.(draft)??[],current:()=>drafts.get(currentId),changed:change,draw:()=>{if(!disposed)render();}}):null;
 const all=type=>(definition.availableItems?definition.availableItems(snapshot.entities,state.book):definition.scoped?snapshot.entities.filter(e=>projectUsesTool(state.book,ownerOf(e,snapshot.entities),moduleForEntity(e,snapshot.entities)?.id??definition.id)):snapshot.entities).filter(e=>!type||e.type===type);
 const get=id=>snapshot.entities.find(e=>e.id===id);
 function adopt(data){
  snapshot=data;
  for(const draft of drafts.values())if(!dirty(draft)){
   const latest=get(draft.id);if(latest){draft.expectedRevision=latest.revision;draft.base=structuredClone(latest.data);draft.data=structuredClone(latest.data);}
  }
 }
 const context={get itemsPage(){return itemPages?.page;},get scopeId(){return scopeId;},get creationScopeId(){return projectUsesTool(state.book,scopeId,definition.id)?scopeId:null;},get recursive(){return recursive;},ownerField:(label='Owner location')=>field(label,`<select data-module-field="projectId">${[['',state.book.title+' / Workspace'],...state.book.projects.filter(p=>projectUsesTool(state.book,p.id,definition.id)||p.id===context.current?.data.projectId).map(p=>[p.id,ownerLabel(state.book,p.id)])].map(([id,label])=>option(id,label,ownerOf(context.current,snapshot.entities)??'')).join('')}</select>`),disclosure,openDisclosure,services,all,get,esc,field,option,button,edit,refresh,command,openOperation,links,referenceFields,recordField:references.recordField,history,select,input,area,check,change,draw:()=>render(),get current(){return drafts.get(currentId);},get operation(){return operation;},get section(){return section;},list,get snapshot(){return snapshot;}};
 context.itemField=(key,label)=>itemChoices.field(key,label);context.itemLabel=id=>itemChoices.label(id);context.bindItemLabels=()=>itemChoices?.bind();
 context.edit=switchEdit;
 definition.setup?.(context);
 function disclosure(key){
  const id=currentId+':'+key;
  return 'data-module-disclosure="'+esc(id)+'"'+(disclosures.get(id)?' open':'');
 }
 function openDisclosure(key){const id=currentId+':'+key;disclosures.set(id,true);for(const node of document.querySelectorAll('[data-module-disclosure]'))if(node.dataset.moduleDisclosure===id)node.open=true;}
 const navigation=()=>definition.showTabs?.(context)===false?'':`<nav class="module-tabs" aria-label="${esc(definition.label)}">${definition.types.map(t=>button(t.label,'list',`data-type="${t.id}" aria-current="${t.id===listType?'page':'false'}"`)).join('')}</nav>`;
 function button(label,command,attrs='',style=''){return `<button type="button" class="button ${style}" data-action="module-command" data-command="${command}" ${attrs}>${esc(label)}</button>`;}
 function input(key,label,type='text',extra=''){const d=context.current?.data??{};return field(label,`<input data-module-field="${esc(key)}" type="${type}" value="${esc(d[key]??'')}" ${extra}>`);}
 function area(key,label){const d=context.current;return services.documents.field({key:definition.id+':'+d.id+':'+key,label,value:d.data[key]??'',maxCharacters:d.type==='category'?10000:100000,set:value=>{d.data[key]=value;change();}});}
 function select(key,label,choices){return field(label,`<select data-module-field="${esc(key)}">${choices.map(([id,title])=>option(id,title,context.current?.data[key]??'')).join('')}</select>`);}
 function check(key,label){return `<label class="checkbox"><input type="checkbox" data-module-field="${esc(key)}" ${context.current?.data[key]?'checked':''}><span>${esc(label)}</span></label>`;}
 function dirty(d){return JSON.stringify(d.data)!==JSON.stringify(d.base);}
 function change(){error=null;checkpoint();status();}
 function status(){if(disposed||state.page!=='module'||state.moduleId!==definition.id)return;const workbench=document.querySelector('.module-workbench');if(workbench){workbench.inert=busy;workbench.setAttribute('aria-busy',String(busy));for(const form of workbench.querySelectorAll('form')){if(busy)form.dataset.busy='true';else delete form.dataset.busy;if(busy&&recovery.canPark())form.dataset.navigationReady='true';else delete form.dataset.navigationReady;}}const recoveryNode=document.querySelector('[data-recovery-status]');if(recoveryNode)recoveryNode.textContent=recovery.error?'Recovery checkpoint could not save. Keep this page open and retry.':'';const node=document.querySelector('[data-module-status]');if(node)node.textContent=busy?'Saving...':[...drafts.values()].some(dirty)||operationDirty()?'Unsaved changes':context.current?.expectedRevision===null?'':'Saved';}
 function releaseClean(keep=null){
  for(const [id,draft] of drafts)if(id!==keep&&!dirty(draft))drafts.delete(id);
  if(definition.paged)snapshot={...snapshot,entities:snapshot.entities.filter(e=>e.id===keep||drafts.has(e.id))};
  for(const key of disclosures.keys())if(!drafts.has(key.split(':')[0]))disclosures.delete(key);
 }
 async function releaseDrafts(){
  if(!drafts.size)return true;
  checkpoint();
  // Release only a durable checkpoint, synchronously. Waiting and refreshing
  // its recovery listing must never disable navigation or replace newer input.
  if(!recovery.parkSaved()){void recovery.flush();return true;}
  drafts.clear();currentId=null;operation=null;conflicts.clear();disclosures.clear();historyPages.clear();
  if(definition.paged)snapshot={...snapshot,entities:[]};
  void recovery.refresh();return true;
 }
 async function list(type=listType){if(!await releaseDrafts())return;cancelReads();historyPages.clear();currentId=null;operation=null;failedId=null;releaseClean();listType=type;state.modulePath=route(definition.listPath?.(type,context)??type);query='';filter='';if(itemPages)void loadItems();render();}
 async function switchEdit(id,type,initial={}){if(!drafts.has(id)&&!await releaseDrafts())return;edit(id,type,initial);}
 function edit(id,type,initial={},{draw=true}={}){
  // A list response must never replace an editor after its input has focus.
  clearTimeout(searchTimer);itemPages?.cancel();
  historyPages.clear();
  const entity=get(id);
  if(!drafts.has(id)){
   const blank=entity?entity.data:definition.blank(type,context);
   // Defaults describe an untouched form, not a user-authored draft. Supplied
   // content and subsequent edits still receive encrypted recovery checkpoints.
   drafts.set(id,{id,type:entity?.type??type,expectedRevision:entity?.revision??null,base:structuredClone(blank),data:entity?structuredClone(blank):{...structuredClone(blank),...structuredClone(initial)}});
  }
  currentId=id;listType=drafts.get(id).type;checkpoint();state.modulePath=route(listType+'/'+id);section=definition.openSection?.(context.current)??'details';error=null;operation=null;if(draw)render();
 }
 async function openExisting(id,type,{refresh=false,background=false}={}){
  if(background&&(busy||openController||drafts.has(id)&&dirty(drafts.get(id))))return;
  if(!drafts.has(id)&&!await releaseDrafts())return;
  if(!definition.paged){edit(id,type);return;}
  if(drafts.has(id)&&(!refresh||drafts.get(id).expectedRevision===null)){edit(id,type);return;}
  const ticket=++openGeneration,contextKey=identity();openController?.abort();openController=new AbortController();let changed=false;if(!background){busy=true;failedId=null;error=null;status();}
  try{
   const value=await api('/api/modules/item',{workspaceId:state.book.id,id},{signal:openController.signal});
   if(ticket!==openGeneration||disposed||contextKey!==identity())return;
   if(value?.workspaceId!==state.book.id||!validModuleRevision(value.revision)||value.entity?.id!==id||value.entity.type!==type||!Number.isSafeInteger(value.entity.revision)||!value.entity.data)throw Error(currentText('invalid'));
   // A refresh may finish after typing or a save has begun. Retain the form
   // and its base revision so a subsequent save can detect a competing edit.
   if(background&&(busy||drafts.has(id)&&dirty(drafts.get(id))||document.activeElement?.closest('[data-module-form]')||drafts.get(id)?.expectedRevision>=value.entity.revision))return;
   changed=true;releaseClean(id);adopt({...snapshot,revision:value.revision,revisions:value.revisions,entities:[...snapshot.entities.filter(e=>e.id!==id),value.entity]});const previousSection=section;edit(id,type,{},{draw:false});if(refresh)section=previousSection;
  }catch(e){if(!background&&ticket===openGeneration&&!disposed&&contextKey===identity()&&e.name!=='AbortError'){failedId=id;error=e;}}
  finally{if(ticket===openGeneration){if(!background)busy=false;openController=null;if(!disposed&&(!background||changed))render();status();}}
 }
 async function create(type=listType,initial={}){
  try{
   const descriptor=definition.types.find(t=>t.id===type);if(!descriptor)throw new Error('This item type is unavailable.');
   if(definition.canCreate?.(descriptor,context)===false)return;
   if(!await releaseDrafts())return;
   await definition.prepareCreate?.(type,context);edit(crypto.randomUUID(),type,initial);
  }catch(e){error=e;if(!disposed)render();}
 }
 async function refresh(){if(itemPages){if(currentId&&context.current.expectedRevision!==null)await openExisting(currentId,context.current.type,{refresh:true});else await loadItems();return;}adopt((await api('/api/modules/data')).data);error=null;if(!disposed)render();}
 async function activate({background=false}={}){
  if(!itemPages){await refresh();return;}
  const path=definition.scoped?parseScope(state.modulePath??''): {path:state.modulePath??''};if(definition.scoped)scopeId=path.projectId;
  const [type,id]=path.path.split('/'),known=definition.types.some(t=>t.id===type);
  if(known&&id){if(openController||failedId===id)return;await openExisting(id,type,{refresh:true,background});return;}
  if(!await releaseDrafts())return;currentId=null;releaseClean();if(known&&type!==listType){listType=type;query='';filter='';}await loadItems();
 }
 async function command(action,payload,{savedDraft=null}={}){
  if(disposed)throw new DOMException('','AbortError');
  if(busy)throw new Error('A save is already in progress.');
  const signature=JSON.stringify({action,payload});
  if(!pending||pending.signature!==signature)pending={signature,commandId:crypto.randomUUID()};
  const commandId=pending.commandId,base=snapshot,workspaceId=base.workspaceId;
  busy=true;error=null;status();
  try{
   await recovery.flush();if(disposed)throw new DOMException('','AbortError');
   const finishSaved=savedDraft?recovery.completionFor(savedDraft):null;
   const result=await api('/api/modules/command?compact=1',{workspaceId,commandId,action,payload});
   const data=definition.paged&&result.revisions?applyModuleDomainReceipt(base,result):definition.paged&&result.modulePatch?applyModulePatch({...base,revision:result.modulePatch.baseRevision},result.modulePatch):result.modulePatch?(applyModulePatch(base,result.modulePatch)??(await api('/api/modules/data')).data):result.data;
   if(definition.paged&&(result.modulePatch?.workspaceId??result.workspaceId)!==workspaceId)throw Error(currentText('invalid'));
   if(disposed){await finishSaved?.();return {...result,data};}
   adopt(data);if(!definition.paged)state.moduleData=data;pending=null;await definition.afterCommand?.(context);return {...result,data};
  }catch(e){error=e;throw e;}
  finally{busy=false;status();}
 }
 async function saveDraft(d){
  if(definition.scoped&&!(definition.entityAvailable?.(d,context)??projectUsesTool(state.book,ownerOf(d,snapshot.entities),definition.id)))throw new Error('Enable this tool for the owner project before saving.');
  await definition.beforeSave?.(d,context);
  const captured=structuredClone(d.data),creating=d.expectedRevision===null,request=definition.saveCommand?.({...d,data:captured},context)??{action:d.type+'.save',payload:{id:d.id,expectedRevision:d.expectedRevision,data:captured}},result=await command(request.action,request.payload,{savedDraft:{id:d.id,data:captured}});
  if(disposed)return;
  const saved=result.data.entities.find(e=>e.id===d.id);
  d.expectedRevision=saved.revision;d.base=structuredClone(saved.data);
  if(JSON.stringify(d.data)===JSON.stringify(captured))d.data=structuredClone(saved.data);section=definition.savedSection?.(d,creating)??section;checkpoint();
 }
 function openOperation(kind,values){operation={kind,values:structuredClone(values),base:structuredClone(values)};section='stock';error=null;render();}
 function candidates(){
  return [
   ...all().flatMap(e=>{const module=moduleForEntity(e,all());return module?[{type:e.type,id:e.id,title:e.data.name??e.data.title,...module.reference?.(e,all()),moduleId:module.id,enabled:enabledModule(state.dashboardSettings,module.id)}]:[]})
  ];
 }
 function links(refs){return refs.map(ref=>{
  if(ref.workspaceId!==state.book.id)return `<span class="module-link">${esc(tr('missingItem',{type:researchKindLabel(ref.type)}))}</span>`;
  if(ref.type==='record')return `<span class="module-link">${references.recordLink(ref.id)}<small>${esc(researchKindLabel(ref.type))}</small></span>`;
  if(itemChoices&&!['project','notebook'].includes(ref.type))return `<span class="module-link">${itemChoices.link(ref)}</span>`;
  const structural={project:state.book.projects,notebook:state.book.notebooks}[ref.type]?.find(item=>item.id===ref.id),target=structural??candidates().find(c=>c.type===ref.type&&c.id===ref.id),title=target?.title??tr('missingItem',{type:ref.type});
  const action={project:'open-project',notebook:'filter-notebook',record:'edit-entry'}[ref.type];
  return `<span class="module-link">${target&&target.enabled!==false?`<button type="button" class="text-button" data-action="${action??'module-open'}" data-id="${ref.id}" data-module-id="${target?.moduleId??''}" data-module-path="${target?.path??ref.type+'/'+ref.id}">${esc(title)}</button>`:esc(title)}<small>${esc(researchKindLabel(ref.type))}</small></span>`;
 }).join('');}
 function referenceFields(refs=context.current.data.links){
  if(itemChoices)return `<section class="module-block"><h2>${esc(tr('heading'))}</h2><div class="module-link-list">${refs.map((ref,i)=>`<div>${links([ref])}${button(tr('remove'),'remove-link',`data-index="${i}"`,'subtle')}</div>`).join('')||'<p class="muted">'+esc(tr('empty'))+'</p>'}</div>${references.researchButton()}${itemChoices.button()}</section>`;
  return `<section class="module-block"><h2>${esc(tr('heading'))}</h2><div class="module-link-list">${refs.map((ref,i)=>`<div>${links([ref])}${button(tr('remove'),'remove-link',`data-index="${i}"`,'subtle')}</div>`).join('')||'<p class="muted">'+esc(tr('empty'))+'</p>'}</div>${references.researchButton()}<div class="module-inline">${field(esc(tr('moduleItem')),`<select data-link-choice><option value="">${esc(tr('chooseItem'))}</option>${candidates().filter(c=>c.enabled!==false&&c.id!==currentId&&!refs.some(l=>l.id===c.id&&l.type===c.type)).map(c=>`<option value="${c.type+':'+c.id}">${esc(c.title)} / ${esc(c.type)}</option>`).join('')}</select>`)}${button(tr('add'),'add-link')}</div></section>`;
 }

 function history(){return historyPages.view();}
 function view(path){
  if(definition.scoped){const parsed=parseScope(path);scopeId=parsed.projectId;path=parsed.path||definition.initialType||definition.types[0].id;}
  // Other feature editors may save the same shared entity. Adopt the newer
  // snapshot without replacing any dirty drafts or rebuilding navigation.
  if(!definition.paged&&state.moduleData?.workspaceId===snapshot.workspaceId&&state.moduleData.revision>snapshot.revision)adopt(state.moduleData);
  path=definition.resolvePath?.(path,context)??path;
  for(const node of document.querySelectorAll('.module-workbench [data-module-disclosure]'))disclosures.set(node.dataset.moduleDisclosure,node.open);
  if(path&&path!==listType+'/'+currentId){
   if(definition.paged){
    const [type,id]=path.split('/');
    if(id&&definition.types.some(t=>t.id===type)&&!drafts.has(id)){
     if(!busy&&failedId!==id)void openExisting(id,type);
     return `<section class="module-workbench"><h1>${esc(definition.label)}</h1>${error?`<p role="alert">${esc(error.message)}</p>${button(currentText('retry'),'open-item-retry',`data-id="${esc(id)}" data-type="${type}"`)}`:`<p role="status">${esc(currentText('loadingItem'))}</p>`}${recoveryView()}</section>`;
    }
   }
   const [type,id]=path.split('/');if(definition.types.some(t=>t.id===type)){listType=type;if(id&&id!==currentId){const entity=get(id);if(entity&&!drafts.has(id))drafts.set(id,{id,type:entity.type,expectedRevision:entity.revision,base:structuredClone(entity.data),data:structuredClone(entity.data)});currentId=entity||drafts.has(id)?id:null;if(currentId)section=definition.openSection?.(context.current)??'details';}else if(!id)currentId=null;}
  }
  if(definition.scoped&&scopeId&&!state.book.projects.some(p=>p.id===scopeId))return '<section class="module-empty"><h1>Location unavailable</h1><p>Choose an existing location from Projects.</p></section>';
  const d=drafts.get(currentId),type=definition.types.find(t=>t.id===(d?.type??listType)),unsaved=[...drafts.values()].filter(dirty);
  if(itemPages&&!d&&listQueryKey!==JSON.stringify(listQuery())){listQueryKey=JSON.stringify(listQuery());queueMicrotask(()=>{if(!disposed&&state.page==='module'&&state.moduleId===definition.id)void loadItems();});}
  if(d&&definition.scoped&&!(definition.entityAvailable?.(d,context)??projectUsesTool(state.book,ownerOf(d,snapshot.entities),definition.id)))return '<section class="panel"><h1>Project tool disabled</h1><p>Enable this tool for its owner project in Preferences to open the saved item.</p><button class="button" data-action="dashboard-settings">Manage modules</button></section>';
  return `<div class="module-workbench" aria-busy="${busy}" ${busy?'inert':''}><header class="module-heading"><div><p class="eyebrow">${esc(definition.label)}</p><h1>${esc(d?(d.data.name||d.data.title||'New '+type.singular):(definition.listTitle?.(type,context)??type.label))}</h1></div><div class="module-actions">${d?button(definition.backLabel?.(d)??'Back to '+type.label.toLowerCase(),'list'):button('New '+type.singular,'new',definition.canCreate?.(type,context)===false?'disabled':'','primary')}${button('Refresh','refresh')}</div></header>
   ${navigation()}
   ${definition.scoped?(definition.scopeControl?.(context)??scopeControl(state.book,scopeId,esc,{recursive,moduleId:definition.id})):''}${definition.tools?.(context)??''}
   ${error?`<div class="module-error" role="alert"><strong>${esc(error.message??'Save interrupted. Your draft is retained.')}</strong>${(error.details??[]).map(e=>'<p>'+esc(e.field)+'</p>').join('')}${error.code==='MODULE_CHANGED'&&!operation?button('Compare saved version','compare'):''}</div>`:''}
   <p class="module-recovery-status" data-recovery-status role="status"></p>
   ${recoveryView()}
   ${unsaved.length?`<div class="module-drafts">Drafts: ${unsaved.map(d=>button(d.data.name||d.data.title||'New '+d.type,'edit',`data-id="${d.id}" data-type="${d.type}"`,'subtle')).join('')}</div>`:''}
   ${d?editor(d,type):listing(type)+(definition.extraList?.(type,context)??'')}
   </div>`;
 }
 function listing(type){
  if(itemPages)return `${definition.listTools?.(type,context)??''}${field(esc(currentText('search')),`<input type="search" data-module-search maxlength="256" value="${esc(query)}">`)}${type.statuses?field(esc(currentText('status')),`<select data-module-filter>${option('',currentText('allStatuses'),filter)}${type.statuses.map(([id,title])=>option(id,title,filter)).join('')}</select>`):''}${itemPages.view(e=>`<article class="module-item">${definition.summaryCard?.(e,context)??`<h2>${esc(e.title)}</h2>${e.status?`<p>${esc(type.statuses?.find(([id])=>id===e.status)?.[1]??e.status)}</p>`:''}`}${button(currentText('open',{name:type.singular}),'edit',`data-id="${e.id}" data-type="${e.type}"`)}</article>`)}`;
  const items=(definition.scoped&&type.id!=='category'?(definition.scopeItems??scopedItems)(state.book,all(),scopeId,recursive).filter(e=>e.type===type.id):all(type.id)).filter(e=>definition.filterItem?.(e,context)!==false).filter(e=>(!query||JSON.stringify(e.data).toLowerCase().includes(query.toLowerCase()))&&(!filter||e.data.status===filter));
  return `${definition.listTools?.(type,context)??''}<div class="module-list-tools">${field('Search '+type.label.toLowerCase(),`<input type="search" data-module-search value="${esc(query)}" placeholder="Search...">`)}${type.statuses?field('Status',`<select data-module-filter>${[['','All'],...type.statuses].map(([id,label])=>option(id,label,filter)).join('')}</select>`):''}<span>${items.length} ${esc(items.length===1?type.singular:type.label.toLowerCase())}</span></div><div class="module-collection">${items.map(e=>`<article class="module-item">${definition.scoped&&e.type!=='category'?`<p class="operation-owner">${esc(definition.ownerLabel?.(e,context)??ownerLabel(state.book,ownerOf(e,snapshot.entities)))}</p>`:''}${definition.card(e,context)}<div class="module-item-actions">${button('Open '+type.singular,'edit',`data-id="${e.id}"`)}<small>Revision ${e.revision}</small></div></article>`).join('')||`<div class="module-empty"><h2>${query||filter?'No matching '+type.label.toLowerCase():'Create your first '+type.singular}</h2><p>${esc(type.empty)}</p></div>`}</div>`;
 }
 function compareFields(d){
  const latest=get(d.id)?.data??{},base=d.base??{};
  return [...new Set([...Object.keys(base),...Object.keys(d.data),...Object.keys(latest)])].map(key=>{
   const local=JSON.stringify(d.data[key])!==JSON.stringify(base[key]),remote=JSON.stringify(latest[key])!==JSON.stringify(base[key]);
   return {key,local,remote,conflict:local&&remote&&JSON.stringify(d.data[key])!==JSON.stringify(latest[key]),mine:d.data[key],saved:latest[key]};
  });
 }
 function comparison(d){
  const fields=compareFields(d),overlap=fields.filter(f=>f.conflict),ready=overlap.every(f=>conflicts.has(f.key));
  return `<section class="module-block"><h2>Review competing changes</h2><p>Changes to different fields are combined. Choose which version to keep for each conflicting field.</p>
   <div class="module-compare">${fields.filter(f=>f.local||f.remote).map(f=>`<article><h3>${esc(fieldLabel(f.key))}</h3>${f.conflict?`<label class="module-conflict-choice"><input type="radio" name="conflict-${esc(f.key)}" data-conflict-field="${esc(f.key)}" value="mine" ${conflicts.get(f.key)==='mine'?'checked':''}>Use my edit</label>${displayValue(f.mine,esc)}<label class="module-conflict-choice"><input type="radio" name="conflict-${esc(f.key)}" data-conflict-field="${esc(f.key)}" value="saved" ${conflicts.get(f.key)==='saved'?'checked':''}>Use saved edit</label>${displayValue(f.saved,esc)}`:`<p class="muted">${f.local?'Your change':'Saved change'} will be retained.</p>${displayValue(f.local?f.mine:f.saved,esc)}`}</article>`).join('')}</div>
   <div class="module-actions">${button('Apply selected changes','rebase',ready?'':'disabled')}${button('Use saved version','discard')}</div></section>`;
 }
 function editor(d,type){
  return `<nav class="module-subtabs" aria-label="Item tools">${[['details','Details'],...(definition.sections?.(d)??[]),['history','History']].map(([id,label])=>button(label,'section',`data-section="${id}" aria-current="${section===id?'page':'false'}"`)).join('')}</nav>
  ${section==='compare'?comparison(d):section==='history'?history(d.id):section!=='details'?definition.section?.(section,context)??'':`<form data-module-form class="module-editor"><div class="module-form-content">${definition.form(d,context)}</div><footer class="module-save"><span data-module-status>${dirty(d)?'Unsaved changes':d.expectedRevision===null?'':'Saved'}</span><div>${button('Discard edits','discard')}<button class="button primary" type="submit" ${busy||definition.readOnly?.(d)?'disabled':''}>Save ${esc(type.singular)}</button></div></footer></form>`}`;
 }
 async function action(name,buttonNode){
  const a=buttonNode.dataset;
  if(busy)return;
  if(!definition.paged&&state.moduleData?.workspaceId===snapshot.workspaceId&&state.moduleData.revision>snapshot.revision)adopt(state.moduleData);
  if(itemPages&&await itemPages.action(name))return;
  if(name==='open-item-retry'){await openExisting(a.id,a.type,{refresh:true});return;}
  if(name.startsWith('recovery-')){
   if(name==='recovery-refresh')await recovery.refresh();
   else if(name==='recovery-retry')await recovery.retry();
   else if(name==='recovery-previous'||name==='recovery-next'){const cursor=recovery.page?.[name==='recovery-previous'?'previousCursor':'nextCursor'];if(cursor)await recovery.load(cursor);}
   if(!disposed)(document.querySelector('.module-recovery [data-command="'+name+'"]:not(:disabled)')??document.querySelector('.module-recovery [data-command="recovery-refresh"]'))?.focus();
   return;
  }
  if(await historyPages.action(name,buttonNode))return;
  if(operation&&JSON.stringify(operation.values)!==JSON.stringify(operation.base)&&['new','edit','list','section'].includes(name)){error={message:'Finish this stock operation, or use Cancel to discard it.'};render();return;}
  if(name==='recover'){
   if(!await releaseDrafts())return;
   busy=true;status();try{
   const values=await recovery.restore(a.id);
   if(operationDirty()||values.some(d=>!definition.types.some(t=>t.id===d.type)||drafts.has(d.id)&&dirty(drafts.get(d.id))))throw new Error('Keep or save the open draft before restoring this checkpoint.');
   const operations=values.filter(d=>d.operation);
   if(operations.length>1||operations.some(d=>!definition.recoverOperation?.(d)))throw new Error('This recovery operation is unavailable. Its checkpoint has been kept.');
   for(const draft of values){const {operation:op,...entity}=draft;drafts.set(entity.id,structuredClone(entity));}
   const selected=operations[0]??values[0];
   if(selected)edit(selected.id,selected.type);
   if(operations.length){operation=structuredClone(operations[0].operation);section='stock';}
   checkpoint();await recovery.flush();if(recovery.error)throw recovery.error;
   await recovery.remove(a.id);render();
   }finally{busy=false;if(!disposed)render();status();}
  }
  else if(name==='remove-recovery'){await recovery.remove(a.id);render();}
  else if(name==='cancel-operation'){operation=null;error=null;checkpoint();render();}
  else if(name==='new')await create();
  else if(name==='edit')await openExisting(a.id,a.type??get(a.id)?.type??listType);
  else if(name==='list')await list(a.type??listType);
  else if(name==='section'){
   section=a.section;operation=null;
   if(section==='history')await historyPages.open(currentId);else historyPages.clear();
   render();
  }
  else if(name==='refresh')await refresh();
  else if(name==='compare'){await refresh();conflicts.clear();section='compare';render();}
  else if(name==='rebase'){
   const d=context.current,latest=get(d.id),fields=compareFields(d);
   if(fields.some(f=>f.conflict&&!conflicts.has(f.key)))return;
   d.data=Object.fromEntries(fields.map(f=>[f.key,structuredClone(f.conflict?(conflicts.get(f.key)==='mine'?f.mine:f.saved):f.local?f.mine:f.saved)]).filter(([,value])=>value!==undefined));
   d.expectedRevision=latest?.revision??null;d.base=structuredClone(latest?.data??null);error=null;section='details';change();render();
  }
  else if(name==='discard'){const latest=get(currentId);drafts.delete(currentId);checkpoint();if(latest){if(itemPages)await openExisting(latest.id,latest.type,{refresh:true});else edit(latest.id,latest.type);}else {currentId=null;state.modulePath=route(listType);render();}}
  else if(name==='add-link'){const value=document.querySelector('[data-link-choice]').value;if(value){const [type,id]=value.split(':');context.current.data.links.push({workspaceId:state.book.id,type,id});change();render();}}
  else if(name==='remove-link'){context.current.data.links.splice(Number(a.index),1);change();render();}
  else {try{await definition.action?.(name,buttonNode,context);}catch(e){error=e;if(!disposed)render();}}
 }
 function inputEvent(el){
  if(itemChoices?.input(el))return true;
  if(references.input(el))return true;
  if(definition.scoped&&el.matches('[data-operation-scope],[data-operation-descendants]')){const value=el.value,checked=el.checked,scope=el.hasAttribute('data-operation-scope');void (async()=>{if(!await releaseDrafts())return;if(scope)scopeId=value||null;else recursive=checked;state.modulePath=route(listType);currentId=null;render();})();return true;}
  if(el.dataset.conflictField){conflicts.set(el.dataset.conflictField,el.value);render();return true;}
  if(el.matches('[data-module-search],[data-module-filter]')){
   if(el.hasAttribute('data-module-search'))query=el.value;else filter=el.value;
   if(itemPages){clearTimeout(searchTimer);searchTimer=setTimeout(()=>void loadItems(),180);return true;}
   const start=el.selectionStart,key=el.hasAttribute('data-module-search')?'data-module-search':'data-module-filter';render();const next=document.querySelector('['+key+']');next?.focus();if(start!==null&&next?.setSelectionRange)next.setSelectionRange(start,start);return true;
  }
  if(definition.listInput?.(el,context)){if(itemPages){clearTimeout(searchTimer);searchTimer=setTimeout(()=>void loadItems(),180);}else render();return true;}
  if(el.dataset.moduleField){const d=context.current;d.data[el.dataset.moduleField]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.dataset.moduleField==='projectId'?(el.value||null):el.value;definition.input?.(el,context);change();return true;}
  if(el.dataset.operationField&&operation){operation.values[el.dataset.operationField]=el.value;definition.operationInput?.(el,context);change();return true;}
  if(definition.input?.(el,context)){change();return true;}return false;
 }
 async function submit(form){
  try{
   if(form.dataset.operation){await definition.submit?.(form,context);operation=null;}
   else await saveDraft(context.current);
   if(disposed)return;
   checkpoint();await recovery.flush();if(!disposed){render();notify('Saved.');}
  }catch(e){
   if(form.dataset.operation&&e.code==='MODULE_CHANGED'&&definition.operationConflictMessage){
    try{if(definition.paged){const latest=await api('/api/modules/item',{workspaceId:state.book.id,id:currentId});adopt({...snapshot,revision:latest.revision,entities:[latest.entity]});await definition.afterCommand?.(context);}else adopt((await api('/api/modules/data')).data);}catch{}
    error={code:e.code,message:definition.operationConflictMessage};
   }else error=e;
   if(!disposed)render();
  }
 }
 initialized=true;
 return {navigation,view,action,create,input:inputEvent,submit,bind(){references.bind();void itemChoices?.bind();definition.bind?.(context);},deactivate(){cancelReads();references.stop();itemChoices?.stop();definition.deactivate?.(context);},referenceAction:async node=>await itemChoices?.action(node)||references.action(node),activate,needsNavigationGuard:()=>operationDirty()||[...drafts.values()].some(dirty)&&!recovery.canPark(),isDirty:()=>[...drafts.values()].some(dirty)||!!operation&&JSON.stringify(operation.values)!==JSON.stringify(operation.base),
  async save(){if(operation)throw new Error('Finish or cancel the stock operation before leaving.');for(const d of drafts.values())if(dirty(d))await saveDraft(d);if(disposed)return;checkpoint();await recovery.flush();if(!disposed)render();},
  async discard(){drafts.clear();currentId=null;operation=null;state.modulePath=route(listType);checkpoint();if(!disposed)render();await recovery.flush();},
  dispose(){definition.dispose?.(context);historyPages.clear();references.stop();itemChoices?.stop();itemPages?.clear();clearTimeout(searchTimer);openController?.abort();openGeneration++;disposed=true;recovery.stop();drafts.clear();snapshot=null;}
 };
}

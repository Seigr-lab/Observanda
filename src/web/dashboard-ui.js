import './i18n/catalogues/dashboardEditors.js';
import {dashboardPinnedItem} from './dashboard-collection-client.js';
import {figurePreviews} from './figure-preview.js';
import {dashboardSelection,dashboardScopeLabel} from './dashboard-scope.js';
import {moduleSettings} from './module-settings.js';
import {modulePreferences,templatePreferences} from './module-preferences.js';
import {cardInspector,bindCardInspector} from './dashboard-inspector.js';
import {ux} from './experience-ui.js';
import {FEATURE_MODULES,enabledModule} from './feature-modules.js';
import {validDashboard,createPanel,panelSpan} from './dashboard-model.js';
import {dashboardDesktop} from './dashboard-desktop.js';
import {cardIcon} from './dashboard-cards.js';
import {workspaceData,workspaceFeatures} from './workspace-features.js';
import {createDataSession,providerFields,displayValue} from './data-registry.js';
import {dashboardLibraryUI} from './dashboard-library-ui.js';
import {dashboardChoiceUI} from './dashboard-choice-ui.js';
import {t} from './i18n/index.js';
const dt=(key,parameters)=>t('dashboardEditors',key,parameters);


// The dashboard owns layout, not feature data. Providers own their data,
// fields, filtering controls and optional specialised renderers.
export function dashboardUI({state,api,esc,field,option,render,notify,onChange,access=operation=>operation()}){
 const settings=moduleSettings({state,api,esc,field,option,render,notify,onChange});
 let saved=null,draft=null,etag=null,pending=null,saveTimer=null,saveError=null,viewId=null;
 let retained=null,submission=null,watchTimer=null,watchGeneration=0;
 const bodyMarkup=new WeakMap(),plots=new WeakMap(),previews=figurePreviews();
 let selectedCard=null,inspectorTab='content',fieldGroup='details',inspectorPosition={},disposeInspector=()=>{},viewsOpen=false;
 const cardPages=new Map();
 let lastPage=null,session=null,dispose=()=>{};
 const copy=v=>structuredClone(v),equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const context=()=>({contextId:state.storage?.contextId,book:state.book,projectOwner:state.projectOwner,etag:state.etag,outline:Boolean(state.workspaceOutline),notebookCounts:state.workspaceOutline?.notebookCounts,moduleData:state.moduleData?.workspaceId===state.book?.id?state.moduleData:null,enabledModules:state.dashboardSettings?.enabledModules}),active=()=>draft.views.find(v=>v.id===viewId)??draft.views.find(v=>v.id===draft.defaultId);
 const isDirty=()=>Boolean(saved&&draft&&!equal(saved,draft));
 const reference=p=>p.source??{provider:p.tool,key:null};
 const provider=p=>workspaceData.get(reference(p).provider);
 const attrs=source=>esc(JSON.stringify(source));
 const visible=()=>['workspace','dashboard-settings','templates'].includes(state.page);
 const button=(label,action,extra='',cls='')=>`<button class="desk-button ${cls}" data-action="${action}" ${extra}>${label}</button>`;
 const actionAttrs=action=>Object.entries(action.data??(action.id?{id:action.id}:{})).filter(([key,value])=>/^[a-zA-Z][a-zA-Z0-9]*$/.test(key)&&['string','number','boolean'].includes(typeof value)).map(([key,value])=>'data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())+'="'+esc(value)+'"').join(' ');
 const iconButton=(icon,label,action,extra='')=>button(cardIcon(icon),action,`aria-label="${esc(label)}" title="${esc(label)}" ${extra}`,'desk-icon');
 const library=dashboardLibraryUI({registry:workspaceData,context,session:()=>session,api,access,esc,button,iconButton,shortcuts:()=>draft.shortcuts,
  closedCards:()=>active().panels.filter(p=>p.hidden&&moduleVisible(p)).map(panel=>({source:reference(panel),label:title(panel),description:t('dashboardLibrary','closedDescription'),restore:panel.id,icon:provider(panel)?.icon}))});
 const choiceUI=dashboardChoiceUI({api,esc,access,onChange:()=>refreshInspector()});
 function status(){
  const node=document.querySelector('#desk-save-state');
  if(node){node.textContent=saveError?(saveError.code==='DASHBOARD_CHANGED'?t('pendingSettings','conflict'):t('pendingSettings','failed')):pending||isDirty()?t('pendingSettings','retaining'):'';node.classList.toggle('desk-error',Boolean(saveError));node.closest('.desk-save-message').hidden=!node.textContent;}
  const recovery=document.querySelector('#desk-save-recovery');if(recovery){recovery.hidden=!saveError;recovery.querySelector('[data-action="dashboard-save-retry"]').hidden=!saveError;recovery.querySelector('[data-action="dashboard-reload"]').textContent=t('pendingSettings','discard');}
  onChange();
 }
 function watch(){
  clearTimeout(watchTimer);const generation=watchGeneration;
  if(!retained)return;
  watchTimer=setTimeout(async()=>{
   try{
    const result=await api('/api/dashboard/pending');if(generation!==watchGeneration)return;
    // A different window may have added to or discarded the retained edit.
    // Display that state before permitting actions on its command identity.
    // An in-flight local edit keeps its own revision and conflict protection.
    if(!pending&&!submission&&!isDirty()){
     const selected=result.pending??await api('/api/dashboard');
     if(generation!==watchGeneration)return;
     if(!pending&&!submission&&!isDirty()){
      const changed=!equal(draft,selected.settings);retained=result.pending;
      if(changed){saved=copy(selected.settings);draft=copy(saved);etag=selected.etag;state.dashboardSettings=draft;selectedCard=null;await workspaceFeatures.configure(draft.enabledModules);if(generation!==watchGeneration)return;render();}
      saveError=retained?.error?{code:retained.error}:null;
     }
    }
    status();
   }
   catch(error){if(generation!==watchGeneration)return;saveError=error;status();}
   if(generation===watchGeneration)watch();
  },1000);
 }
 async function load(){
  choiceUI.close();settings.reset();previews.release();cardPages.clear();library.close();
  clearTimeout(saveTimer);if(pending)await pending;
  watchGeneration++;clearTimeout(watchTimer);
  retained=state.access?.encrypted?(await api('/api/dashboard/pending')).pending:null;
  const selected=retained??await api('/api/dashboard');saved=copy(selected.settings);draft=copy(saved);etag=selected.etag;viewId=saved.defaultId;selectedCard=null;submission=null;saveError=retained?.error?{code:retained.error}:null;state.dashboardSettings=saved;watch();
  session?.close();
  await workspaceFeatures.configure(saved.enabledModules);
  session=createDataSession(workspaceData,{context,api,access,onChange:()=>{
   if(!visible())return;
   refreshCards();library.refresh();
   if(selectedCard){
    refreshInspector(false,true);
   }
  }});

 }
 async function save(){
  clearTimeout(saveTimer);
  if(pending){await pending;return save();}if(!isDirty()&&!submission)return;
  const submitted=copy(submission?.settings??draft);
  if(!validDashboard(submitted)){saveError=new Error(dt("invalidDashboard"));status();throw saveError;}
  watchGeneration++;clearTimeout(watchTimer);
  pending=(async()=>{
   try{
    let result;
    if(state.access?.encrypted){
     submission??={id:crypto.randomUUID(),settings:submitted,etag};
     const response=await api('/api/dashboard/pending',{action:'save',...submission});retained=response.pending;
     result=response.accepted;submission=null;watch();
    }else result=await api('/api/dashboard',{settings:submitted,etag});
    saved=copy(result.settings);etag=result.etag;state.dashboardSettings=draft;
    if(equal(draft,submitted))draft=copy(saved);saveError=null;
   }catch(error){saveError=error;throw error;}
   finally{pending=null;watch();status();}
  })();
  status();await pending;if(isDirty())return save();
 }
 function autosave(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>save().catch(()=>status()),350);status();}
 async function discard(){clearTimeout(saveTimer);if(pending)try{await pending;}catch{}watchGeneration++;clearTimeout(watchTimer);try{if(retained)await api('/api/dashboard/pending',{action:'discard',id:retained.id});retained=null;submission=null;const result=await api('/api/dashboard');saved=copy(result.settings);draft=copy(saved);etag=result.etag;saveError=null;state.dashboardSettings=draft;await workspaceFeatures.configure(draft.enabledModules);status();}finally{watch();}}
 function changed(redraw=true,focus=null){state.dashboardSettings=draft;autosave();if(redraw||state.workspaceOutline&&!supportsOutline()){render();if(focus)document.querySelector(focus)?.focus({preventScroll:true});}else refreshCards();}
 function cardPage(panel){const signature=JSON.stringify([state.book.id,state.etag,reference(panel),panel.config,panel.options,panel.count]);let value=cardPages.get(panel.id);if(value?.signature!==signature){value={signature,cursor:null};cardPages.set(panel.id,value);}return value;}
 function read(panel){
  if(panel.config.workspaceId&&panel.config.workspaceId!==state.book.id)return {status:'foreign',items:[]};
  const ref=reference(panel),result=session.read(ref.provider,{...context(),legacyConfig:panel.config,dataSlot:'card:'+panel.id,recordLimit:Math.min(100,panel.count),recordKey:ref.key,recordCursor:cardPage(panel).cursor},panel.options);
  return {...result,items:ref.key===null?result.items:result.items.filter(i=>dashboardPinnedItem(i,ref.key,state.book.id))};
 }
 function title(panel){return panel.config.title||(reference(panel).key!==null?read(panel).items[0]?.title:null)||provider(panel)?.label||dt("unavailableData");}
 function fieldKeys(panel,items){
  const p=provider(panel);
  return panel.fields??p?.views?.find(v=>v.id===panel.presentation)?.defaultFields??p?.defaultFields??providerFields(p??{},items).map(f=>f.key).filter(k=>!['id','title','name'].includes(k)).slice(0,4);
 }
 function itemMarkup(item,panel){
  const p=provider(panel),view=p?.views?.find(v=>v.id===panel.presentation),fields=fieldKeys(panel,[item]),descriptors=providerFields(p??{},[item]),action=item.action;
  const heading=action?button(esc(item.title),action.name,actionAttrs(action),'desk-link'):`<strong>${esc(item.title)}</strong>`;
  const special=view?view.render({item,esc,context:context(),options:panel.options,panelId:panel.id}):'';
  return `<article class="desk-item">${heading}${item.subtitle?'<small>'+esc(item.subtitle)+'</small>':''}${special}<dl class="desk-fields">${fields.map(key=>`<div><dt>${esc(descriptors.find(f=>f.key===key)?.label??key)}</dt><dd>${(()=>{const field=descriptors.find(f=>f.key===key);return field?.format?field.format(item.data[key],{esc,context:context(),item}):displayValue(item.data[key],esc);})()}</dd></div>`).join('')}</dl></article>`;
 }
 function content(panel){
  try{
   const result=read(panel),actions=provider(panel)?.actions?.(context(),panel)??[];
   const paging=result.data?.cursor&&(result.data.nextCursor||result.data.previousCursor)?`<footer class="desk-card-pages"><span>${esc(t('dashboardPaging','range',{first:result.data.offset+1,last:result.data.offset+result.items.length,total:result.data.total}))}</span>${button(esc(t('dashboardPaging','previous')),'dashboard-page-previous',`data-id="${panel.id}" ${result.data.previousCursor?'':'disabled'}`)}${button(esc(t('dashboardPaging','next')),'dashboard-page-next',`data-id="${panel.id}" ${result.data.nextCursor?'':'disabled'}`)}</footer>`:'';
   const scope=provider(panel)?.scoped?'<p class="desk-data-scope">'+esc(dashboardScopeLabel(state.book,panel.options,panel.config,result.data?.scopeProjects))+'</p>':'';
   const footer=actions.length?'<footer class="desk-card-actions">'+actions.map(a=>button(esc(a.label),a.name,actionAttrs(a),'desk-link')).join('')+'</footer>':'';
   if(result.status==='missing')return `<p class="desk-empty">${esc(dt("featureUnavailable"))}</p>`;
   if(result.status==='foreign')return `<p class="desk-empty">${esc(dt("foreignWorkspace"))}</p>`;
   if(result.status==='loading')return `<p class="desk-empty" role="status">${esc(dt("loadingData"))}</p>`;
   if(result.status==='error')return '<p class="desk-empty">'+esc(result.error?.message||dt("loadDataFailed"))+'</p>'+button(esc(dt("retry")),'dashboard-retry-data',`data-provider="${reference(panel).provider}"`);
   if(!result.items.length)return scope+'<p class="desk-empty">'+(reference(panel).key===null?esc(ux(Boolean(panel.config?.tag||panel.config?.recordType&&panel.config.recordType!=='all'||panel.config?.status&&panel.config.status!=='all')?'noMatches':'noItems')):esc(dt("itemUnavailable")))+'</p>'+footer;
   return scope+result.items.slice(0,panel.count).map(item=>itemMarkup(item,panel)).join('')+(paging|| (result.items.length>panel.count?`<footer>${button(state.workspaceOutline&&result.data?.total!==undefined?esc(dt("showMore")):esc(dt('showMoreCount',{count:result.items.length-panel.count})),'dashboard-more',`data-id="${panel.id}"`)}</footer>`:''))+footer;
  }catch{return `<p class="desk-empty">${esc(dt("cardFailed"))}</p>`;}
 }
 function inspector(){
  const panel=active().panels.find(p=>p.id===selectedCard&&!p.hidden&&moduleVisible(p));if(!panel){choiceUI.close();return '';}
  if(inspectorTab!=='content')choiceUI.close();
  const result=read(panel);
  return cardInspector({panel,provider:provider(panel),items:result.items,loadedData:result.data,selected:fieldKeys(panel,result.items),title:title(panel),context:context(),tab:inspectorTab,fieldGroup,esc,button,iconButton,choiceUI});
 }
 function refreshInspector(resetScroll=false,fromData=false){
  const slot=document.querySelector('#desk-inspector-slot');if(!slot)return;
  const focused=document.activeElement,owned=Boolean(focused?.closest('.desk-inspector'));
  // Incoming card data must not replace a field under the user's caret. Number
  // inputs cannot restore native selection ranges; a redraw can append digits
  // to the old value. Explicit tab/choice actions still rebuild the inspector.
  if(fromData&&owned&&focused.matches('input[data-desk-property],input[data-desk-option],textarea')&&focused.type!=='checkbox')return;
  const attribute=owned?['data-desk-field','data-desk-property','data-desk-option','data-desk-field-group','data-tab','data-desk-choice-search','data-desk-choice-action'].find(key=>focused.hasAttribute(key)):null;
  const value=attribute?focused.getAttribute(attribute):null,choice=focused?.getAttribute('data-desk-choice'),choiceKey=focused?.getAttribute('data-desk-choice-key');
  const caret=owned&&typeof focused.selectionStart==='number'?[focused.selectionStart,focused.selectionEnd]:null;
  disposeInspector();if(resetScroll)inspectorPosition.scrollTop=0;slot.innerHTML=inspector();disposeInspector=bindCardInspector(slot.firstElementChild,inspectorPosition);
  if(attribute){
   let next=[...document.querySelectorAll('.desk-inspector ['+attribute+']')].find(el=>el.getAttribute(attribute)===value&&el.getAttribute('data-desk-choice')===choice&&el.getAttribute('data-desk-choice-key')===choiceKey);
   if(attribute==='data-desk-choice-action'&&(!next||next.disabled))next=document.querySelector('.desk-choice-pages button:not([disabled])')??document.querySelector('[data-desk-choice-search]');
   next?.focus({preventScroll:true});if(next&&caret)next.setSelectionRange(...caret);
  }
 }

 // Selection is ephemeral UI state. Keep the desktop and its live content mounted.
 function selectCard(id){
  choiceUI.close();selectedCard=id;inspectorPosition={};
  document.querySelectorAll('.desk-card').forEach(node=>{
   const selected=node.dataset.deskCard===id;
   node.classList.toggle('is-selected',selected);
   node.querySelector('[data-action="dashboard-inspector"]').setAttribute('aria-expanded',String(selected));
  });
  refreshInspector();
 }

 function card(panel){
  const label=title(panel);
  return `<section class="desk-card ${selectedCard===panel.id?'is-selected':''}" data-desk-card="${panel.id}" data-span="${panelSpan(panel.width)}" data-column="${panel.column??''}" data-height="${panel.height}" aria-label="${esc(label)}">
   <header><button class="desk-move" data-desk-move="${panel.id}" aria-label="${esc(dt('moveCard',{title:label}))}" aria-describedby="desk-drag-help">${cardIcon('grip')}<h2>${esc(label)}</h2></button>
   ${iconButton('settings',dt('settingsForCard',{title:label}),'dashboard-inspector',`data-id="${panel.id}" aria-controls="desk-inspector-slot" aria-expanded="${selectedCard===panel.id}"`)}
   ${iconButton('close',dt('closeCard',{title:label}),'dashboard-close',`data-id="${panel.id}"`)}</header>
   <div data-dashboard-body="${panel.id}">${content(panel)}</div>
   <button class="desk-resize" data-desk-resize="${panel.id}" aria-label="${esc(dt('resizeCard',{title:label}))}" title="${esc(dt('resizeHelp'))}">${cardIcon('resize')}</button>
  </section>`;
 }
 function mountPlots(panel,node){
  const view=provider(panel)?.views?.find(v=>v.id===panel.presentation);if(!view?.figure)return;
  const items=read(panel).items;
  for(const host of node.querySelectorAll('[data-desk-figure]')){
   const item=items.find(i=>i.key===host.dataset.deskFigure);if(!item)continue;
   const figure=view.figure({item,options:panel.options}),signature=JSON.stringify(figure);
   if(plots.get(host)===signature)continue;
   plots.set(host,signature);previews.mount(host,figure,'dashboard-'+panel.id);
  }
 }
 function refreshCards(){
  if(!draft)return;
  for(const panel of active().panels){
   const node=document.querySelector('[data-desk-card="'+panel.id+'"]');if(!node)continue;
   node.dataset.span=panelSpan(panel.width);node.dataset.column=panel.column??'';node.dataset.height=panel.height;
   node.querySelector('h2').textContent=title(panel);
   node.setAttribute('aria-label',title(panel));
   for(const [action,key] of [['dashboard-inspector','settingsForCard'],['dashboard-close','closeCard']]){
    const control=node.querySelector('[data-action="'+action+'"]');control.setAttribute('aria-label',dt(key,{title:title(panel)}));control.title=dt(key,{title:title(panel)});
   }
   node.querySelector('[data-desk-move]').setAttribute('aria-label',dt('moveCard',{title:title(panel)}));
   node.querySelector('[data-desk-resize]').setAttribute('aria-label',dt('resizeCard',{title:title(panel)}));
   const body=node.querySelector('[data-dashboard-body]'),html=content(panel);if(bodyMarkup.get(body)!==html){body.innerHTML=html;bodyMarkup.set(body,html);}
   mountPlots(panel,body);const page=cardPages.get(panel.id);if(page?.focusAction&&read(panel).status==='ready'){const next=body.querySelector('[data-action="'+page.focusAction+'"]');(next?.disabled?body.querySelector('.desk-card-pages button:not([disabled])'):next)?.focus({preventScroll:true});delete page.focusAction;}
  }previews.prune();status();
 }
 const moduleVisible=p=>!p.moduleId||enabledModule(draft,p.moduleId);
 function shortcutButton(shortcut){
  const p=workspaceData.get(shortcut.source.provider);
  const result=shortcut.source.key===null||shortcut.workspaceId&&shortcut.workspaceId!==state.book.id?null:session.read(shortcut.source.provider,{...context(),dataSlot:'shortcut:'+shortcut.id,recordKey:shortcut.source.key,recordLimit:1});
  const label=(shortcut.source.key!==null?result?.items.find(i=>i.key===shortcut.source.key)?.title:null)||p?.label||dt("unavailableData");
  return `<span class="desk-shortcut">${button(cardIcon(p?.icon)+'<span>'+esc(label)+'</span>','dashboard-add',`data-desk-tool="${attrs(shortcut.source)}" data-source="${attrs(shortcut.source)}" data-workspace="${shortcut.workspaceId??''}" data-label="${esc(label)}" title="${esc(dt('addCardHelp',{title:label}))}"`)}</span>`;
 }
 function view(){
  if(!draft||!state.book)return `<p>${esc(dt("openWorkspace"))}</p>`;
  const v=active();
  if(!v.panels.some(p=>p.id===selectedCard&&!p.hidden&&moduleVisible(p)))selectedCard=null;
  return `<section class="desk-workspace">
   <div class="desk-heading"><h1>${esc(dt("dashboard"))}</h1><div>${draft.views.length>1?`<label class="desk-view-label">${esc(dt("view"))}<select data-desk-view>${draft.views.map(item=>`<option value="${item.id}" ${item.id===v.id?'selected':''}>${esc(item.name)}</option>`).join('')}</select></label>`:''}${button(esc(dt("views")),'dashboard-views',`aria-expanded="${viewsOpen}"`)}</div></div>
   ${viewsOpen?`<section class="desk-view-options" aria-label="${esc(dt("dashboardViews"))}"><label>${esc(dt("viewName"))}<input data-desk-name value="${esc(v.name)}" maxlength="80"></label><label><input type="checkbox" data-desk-default ${draft.defaultId===v.id?'checked':''}> ${esc(dt("defaultView"))}</label>${button(esc(dt("newView")),'dashboard-new-view')}${button(esc(dt("duplicateView")),'dashboard-copy-view')}${draft.views.length>1?button(esc(dt("removeView")),'dashboard-remove-view'):''}</section>`:''}
   ${!state.book.projects.length?'<section class="first-work"><h2>'+esc(ux('firstTitle'))+'</h2><p>'+esc(ux('firstHelp'))+'</p><div class="inline-actions">'+button(esc(ux('createProject')),'new-project','','button primary')+button(esc(ux('tools')),'tools')+button(esc(ux('help')),'help-open','data-topic="getting-started"')+'</div></section>':'<div class="inline-actions">'+button(esc(ux('writeRecord')),'new-entry','','button primary')+button(esc(ux('find')),'entries')+button(esc(ux('tools')),'tools')+'</div>'}
   <details data-disclosure="dashboard-customization"><summary>${esc(ux('customize'))}</summary><div class="desk-toolbar" aria-label="${esc(dt("addCardsRegion"))}">${button(esc(dt("addCards")),'dashboard-library',`aria-expanded="${library.isOpen()}" aria-controls="desk-library-slot"`,'desk-add-cards')}<div class="desk-shortcuts" aria-label="${esc(dt("quickAdd"))}">${draft.shortcuts.filter(moduleVisible).map(shortcutButton).join('')}</div>${active().panels.some(p=>p.hidden)?button(esc(dt("restoreCards")),'dashboard-closed'):''}</div>
   <div id="desk-library-slot">${library.view()}</div></details>
   <div class="desk-save-message"><span id="desk-save-state" role="status"></span><span id="desk-save-recovery" hidden>${button(esc(dt("retry")),'dashboard-save-retry')}${button(esc(dt("reloadLayout")),'dashboard-reload')}</span></div>
   <div class="desk-stage"><div class="desk-desktop" aria-label="${esc(dt("dashboardCards"))}">${v.panels.filter(p=>!p.hidden&&moduleVisible(p)).map(card).join('')}${v.panels.every(p=>p.hidden||!moduleVisible(p))?`<p class="desk-empty-desktop">${esc(dt("emptyDesktop"))}</p>`:''}</div>
   <div id="desk-inspector-slot">${inspector()}</div></div>
   <p id="desk-drag-help" class="website-visually-hidden">${esc(dt("dragHelp"))}</p><p id="desk-move-status" class="website-visually-hidden" role="status"></p>
  </section>`;
 }
 const announce=text=>{const node=document.querySelector('#desk-move-status');if(node)node.textContent=text;};
 function reorder(id,before,column){
  const v=active(),panel=v.panels.find(p=>p.id===id);if(!panel)return;
  v.panels=v.panels.filter(p=>p!==panel);const index=v.panels.findIndex(p=>p.id===before);
  panel.column=column;v.panels.splice(index<0?v.panels.length:index,0,panel);
  changed(true,'[data-desk-move="'+id+'"]');announce(dt("cardMoved"));
 }
 function add(source,before=null,column=null,restore=null,workspaceId=null){
  const v=active();let panel=restore?v.panels.find(p=>p.id===restore):v.panels.find(p=>p.hidden&&equal(reference(p),source)&&(!p.config.workspaceId||p.config.workspaceId===state.book.id));
  if(!panel){panel=createPanel(source.provider,crypto.randomUUID());panel.source=source;panel.moduleId=workspaceData.get(source.provider)?.moduleId??null;panel.config.workspaceId=workspaceId||(source.key!==null?state.book.id:null);panel.presentation=workspaceData.get(source.provider)?.defaultView??'summary';v.panels.push(panel);}
  panel.hidden=false;if(column!==null)panel.column=column;
  library.close();
  if(before)reorder(panel.id,before,panel.column);else changed(true,'[data-desk-move="'+panel.id+'"]');
  announce(dt("cardAdded"));document.querySelector('[data-desk-card="'+panel.id+'"]')?.scrollIntoView({block:'nearest'});
 }
 function bind(){
  if(!visible()){library.close();choiceUI.close();}
  for(const id of cardPages.keys())if(!draft?.views.some(view=>view.panels.some(p=>p.id===id)))cardPages.delete(id);
  session?.retainSlots(new Set(['default',...(draft?active().panels.filter(p=>!p.hidden&&moduleVisible(p)).map(p=>'card:'+p.id):[]),...(draft?.shortcuts??[]).map(s=>'shortcut:'+s.id)]));
  settings.bind({refresh:['dashboard-settings','templates'].includes(state.page)&&lastPage!==state.page});
  dispose();dispose=()=>{};disposeInspector();disposeInspector=()=>{};const returned=visible()&&!['workspace','dashboard-settings','templates'].includes(lastPage);lastPage=state.page;if(!visible()||!draft)return;if(returned)session.invalidate(undefined,{retainData:true});
  const root=document.querySelector('.desk-desktop'),sources=document.querySelector('.desk-workspace'),toolbar=document.querySelector('.desk-toolbar');
  if(sources)sources.onkeydown=event=>{
   if(event.key==='Escape'&&event.target.closest('.desk-inspector')){
    event.preventDefault();const button=document.querySelector('[data-action="dashboard-inspector-close"]');if(button)action(button);
   }
  };
  for(const panel of active().panels){const body=root?.querySelector('[data-dashboard-body="'+panel.id+'"]');if(body)bodyMarkup.set(body,content(panel));}
  dispose=dashboardDesktop({root,toolbar,sources,announce,
   add:(encoded,before,column,restore,workspaceId)=>add(JSON.parse(encoded),before,column,restore,workspaceId),
   move:reorder,resize:(id,width,height)=>{const p=active().panels.find(p=>p.id===id);if(!p)return;p.width=width;p.height=height;if(p.column!==null)p.column=Math.min(p.column,12-width);changed(true,'[data-desk-resize="'+id+'"]');}
  });
  previews.prune();for(const panel of active().panels){const node=root?.querySelector('[data-desk-card="'+panel.id+'"]');if(node)mountPlots(panel,node);}
  disposeInspector=bindCardInspector(document.querySelector('.desk-inspector'),inspectorPosition);status();
 }

 function modulesView(templates=false){return (templates?templatePreferences:modulePreferences)({settings:draft,esc,error:id=>workspaceFeatures.error(id),configuration:module=>settings.view(module)});}
 function settingsStatus(){return '<div class="desk-save-message" hidden><span id="desk-save-state" role="status"></span><span id="desk-save-recovery" hidden>'+button(esc(dt("retry")),'dashboard-save-retry')+button(esc(dt("reloadLayout")),'dashboard-reload')+'</span></div>';}

 function input(el){
  if(choiceUI.input(el))return true;
  if(settings.input(el))return true;
  if(el.hasAttribute('data-desk-module')){
   const id=el.dataset.deskModule,checked=el.checked;
   if(!checked&&settings.hasDirtyWithin(id)){el.checked=true;notify(dt("saveBeforeDisable"));return true;}
   el.disabled=true;
   (async()=>{
    draft.enabledModules=checked?[...new Set([...draft.enabledModules,id])]:draft.enabledModules.filter(value=>value!==id);
    state.dashboardSettings=draft;void save().catch(()=>status());await workspaceFeatures.configure(draft.enabledModules);session?.invalidate();
    render();document.querySelector('[data-desk-module="'+id+'"]')?.focus({preventScroll:true});
   })().catch(error=>{el.disabled=false;el.checked=!checked;notify(error.message);});return true;
  }

  if(el.hasAttribute('data-desk-field-group')){fieldGroup=el.value;refreshInspector();document.querySelector('[data-desk-field-group]')?.focus({preventScroll:true});return true;}
  if(library.input(el))return true;
  if(el.hasAttribute('data-desk-view')){viewId=el.value;selectedCard=null;render();return true;}
  if(el.hasAttribute('data-desk-name')){if(el.value.trim()){active().name=el.value;autosave();}return true;}
  if(el.hasAttribute('data-desk-default')){draft.defaultId=active().id;changed();return true;}
  const p=draft&&active().panels.find(p=>p.id===el.dataset.id);if(!p)return false;
  if(el.hasAttribute('data-desk-property')){
   const key=el.dataset.deskProperty;
   if(key==='title')p.config.title=el.value;
   else if(key==='presentation')p.presentation=el.value;
   else if(['width','count'].includes(key)){if(!el.checkValidity()||!el.value)return true;p[key]=Number(el.value);if(key==='width'&&p.column!==null)p.column=Math.min(p.column,12-p.width);}
   changed(false);
   const heading=document.querySelector('.desk-inspector h2');if(heading)heading.textContent=title(p);
   if(key==='presentation')refreshInspector();
   if(key==='width'){const percent=Math.round(p.width/12*100);el.setAttribute('aria-valuetext',dt('widthPercent',{percent}));const output=document.querySelector('[data-desk-width-label]');if(output)output.textContent=percent+'%';}
   return true;
  }
  if(el.hasAttribute('data-desk-option')){
   const key=el.dataset.deskOption;
   if(el.type==='number'&&(!el.value||!el.checkValidity()))return true;
   if(provider(p)?.scoped)Object.assign(p.options,dashboardSelection(p.options,p.config));
   const definitions=typeof provider(p)?.settings==='function'?provider(p).settings(context(),p.options,p):provider(p)?.settings??[];
   if(el.hasAttribute('data-desk-choice')){
    const selected=new Set(p.options[key]??definitions.find(s=>s.key===key)?.default??[]);
    if(el.checked)selected.add(el.value);else selected.delete(el.value);
    p.options[key]=[...selected];
   }else p.options[key]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;
   // Concrete source IDs belong to this workspace; they must not silently widen elsewhere.
   if(['projectIds','notebookIds','resourceIds'].includes(key))p.config.workspaceId=state.book.id;
   provider(p)?.optionsChanged?.(p.options,key,context());
   changed(false);
   if(el.tagName==='SELECT'||el.type==='checkbox')refreshInspector();
   return true;
  }
  if(el.hasAttribute('data-desk-field')){const fields=new Set(fieldKeys(p,read(p).items));if(el.checked)fields.add(el.dataset.deskField);else fields.delete(el.dataset.deskField);p.fields=[...fields];changed(false);return true;}
  return false;
 }
 async function action(el){
  if(await settings.action(el))return true;
  const name=el.dataset.action;if(name!=='templates'&&!name?.startsWith('dashboard-'))return false;
  if(await library.action(el)||await choiceUI.action(el))return true;
  if(name==='dashboard-inspector'){
   if(selectedCard===el.dataset.id){selectCard(null);el.focus({preventScroll:true});return true;}
   selectCard(el.dataset.id);document.querySelector('.desk-inspector [aria-pressed="true"]')?.focus({preventScroll:true});return true;
  }
  if(name==='dashboard-inspector-close'){const id=selectedCard;selectCard(null);document.querySelector('[data-action="dashboard-inspector"][data-id="'+id+'"]')?.focus({preventScroll:true});return true;}
  if(name==='dashboard-inspector-tab'){inspectorTab=el.dataset.tab;refreshInspector(true);document.querySelector('[data-tab="'+inspectorTab+'"]')?.focus({preventScroll:true});return true;}
  if(name==='dashboard-views'){viewsOpen=!viewsOpen;render();return true;}
  if(name==='dashboard-settings'||name==='templates'){state.page=name;render();return true;}
  if(name==='dashboard-library'||name==='dashboard-library-close'){if(name==='dashboard-library'&&!library.isOpen())library.open();else library.close();render();return true;}
  if(name==='dashboard-closed'){library.open('closed');render();return true;}
  if(name==='dashboard-add'){add(JSON.parse(el.dataset.source),null,null,el.dataset.restore,el.dataset.workspace||null);return true;}
  if(name==='dashboard-pin'){
   const source=JSON.parse(el.dataset.source),existing=draft.shortcuts.find(s=>equal(s.source,source)&&(!s.workspaceId||s.workspaceId===state.book.id));
   if(existing)draft.shortcuts=draft.shortcuts.filter(s=>s!==existing);else draft.shortcuts.push({id:crypto.randomUUID(),moduleId:workspaceData.get(source.provider)?.moduleId??null,source,workspaceId:source.key!==null?state.book.id:null});
   changed();return true;
  }
  if(name==='dashboard-unpin'){draft.shortcuts=draft.shortcuts.filter(s=>s.id!==el.dataset.id);changed();return true;}
  if(name==='dashboard-retry-data'){await session.retry(el.dataset.provider);return true;}
  if(name==='dashboard-save-retry'){if(retained?.error){retained=(await api('/api/dashboard/pending',{action:'retry',id:retained.id})).pending;saveError=null;watch();status();}else await save();return true;}
  if(name==='dashboard-reload'){await discard();render();return true;}
  const v=active(),p=v.panels.find(p=>p.id===el.dataset.id);
  if(name==='dashboard-new-view'||name==='dashboard-copy-view'){const next=name==='dashboard-new-view'?{id:crypto.randomUUID(),name:'New view',panels:[]}:copy(v);next.id=crypto.randomUUID();if(name==='dashboard-copy-view'){next.name=v.name.slice(0,74)+' copy';next.panels.forEach(p=>p.id=crypto.randomUUID());}draft.views.push(next);viewId=next.id;selectedCard=null;changed();return true;}
  if(name==='dashboard-remove-view'&&draft.views.length>1){draft.views=draft.views.filter(item=>item!==v);viewId=draft.views[0].id;selectedCard=null;if(draft.defaultId===v.id)draft.defaultId=viewId;changed();return true;}
  if(!p)return true;
  if(name==='dashboard-close'){p.hidden=true;if(selectedCard===p.id)selectedCard=null;changed();announce(dt("cardClosed"));return true;}
  if(name==='dashboard-unpin-item'){p.source={...reference(p),key:null};changed(false);refreshInspector();return true;}
  if(name==='dashboard-copy'){const next=copy(p);next.id=crypto.randomUUID();next.column=null;v.panels.splice(v.panels.indexOf(p)+1,0,next);}
  if(name==='dashboard-natural'){p.height=0;changed(false);return true;}
  if(name==='dashboard-fields-reset'){p.fields=null;changed(false);refreshInspector(true);return true;}
  if(name==='dashboard-page-next'||name==='dashboard-page-previous'){const result=read(p),page=cardPage(p);if(result.status!=='ready')return true;const cursor=name.endsWith('next')?result.data?.nextCursor:result.data?.previousCursor;if(!cursor)return true;page.cursor=cursor;page.focusAction=name;refreshCards();return true;}
  if(name==='dashboard-more')p.count+=6;
  changed();return true;
 }
 async function enableModule(id){
  if(!draft)throw Error(dt("openBeforeEnable"));
  for(let module=FEATURE_MODULES.find(value=>value.id===id);module;module=FEATURE_MODULES.find(value=>value.id===module.parentId))if(!draft.enabledModules.includes(module.id))draft.enabledModules.push(module.id);
  state.dashboardSettings=draft;await save();await workspaceFeatures.configure(draft.enabledModules);session?.invalidate();
 }
 function supportsOutline(){
  if(!draft)return true;
  const supported=new Set(['records','projects','notebooks','workspace','sections','contributors','relations','figures','files','media','samples','analyses','lab-events','laboratory']);
  const accepts=id=>supported.has(id)||workspaceData.get(id)?.metadataOnly===true;
  return active().panels.filter(p=>!p.hidden&&moduleVisible(p)).every(p=>accepts(reference(p).provider))&&
   draft.shortcuts.every(s=>s.source.key===null||accepts(s.source.provider));
 }
 return {supportsOutline,enableModule,releaseData:()=>{watchGeneration++;clearTimeout(watchTimer);choiceUI.close();library.close();session?.close();session=null;cardPages.clear();previews.release();},refreshData:()=>session?.invalidate(undefined,{retainData:true}),load,flushAutosave:save,save:async()=>{await save();await settings.save();},discard:async()=>{await settings.discard();await discard();},isDirty:()=>isDirty()||settings.isDirty(),needsNavigationGuard:()=>settings.isDirty(),saveNavigation:()=>settings.save(),discardNavigation:()=>settings.discard(),view,preferences:()=>modulesView()+settingsStatus(),templates:()=>modulesView(true)+settingsStatus(),action,input,bind};
}

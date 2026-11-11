import {feedItemEditor} from './website-feed-item-editor.js';
import {confirmAction} from './confirm-action.js';
import {websiteSearchChoices} from './website-files-picker-refinements.js';
import {operationProgress} from './operation-progress-ui.js';

const hasFilter=criteria=>Object.keys(criteria??{}).length>0;
export function websiteFileFeeds({t,request,refresh,report}){
 let current=null,recovery=null;
 function close(){if(current){const dialog=current;current=null;dialog.close();}}
 function suspend(){if(current?.authorDraft)recovery=current.authorDraft();close();}
 function clear(){recovery=null;close();}
 async function open({site,page,blocks,feedId,trigger}){
  close();
  const pin={siteId:site.id,expectedRevision:site.revision,path:page};
  const data=await request('feed/read',pin);
  if(!document.querySelector('link[data-sheet="website-file-feeds"]')){
   const css=document.createElement('link');css.rel='stylesheet';css.href='/website-file-feeds.css';css.dataset.sheet='website-file-feeds';document.head.append(css);
  }
  const dialog=document.createElement('dialog');current=dialog;dialog.className='website-author-dialog website-feed-dialog';dialog.dataset.websiteFeedDialog='';
  function el(tag,parent,text){
   const node=document.createElement(tag);if(text!==undefined)node.textContent=text;(parent??dialog).append(node);return node;
  }
  function field(parent,key,tag){
   const label=el('label',parent,t(key)),control=el(tag,label);return control;
  }
  function btn(parent,key,fn){const b=el('button',parent,t(key));b.className='button';b.type='button';b.onclick=fn;return b;}
  function radios(parent,key,choices){
   const group=el('fieldset',parent);el('legend',group,t(key));const row=el('div',group);row.className='website-feed-choices';
   for(const [value,label] of choices){const tile=el('label',row),input=el('input',tile);input.type='radio';input.name=key;input.value=value;el('span',tile,t(label));}
   return {group,value:()=>group.querySelector(':checked')?.value,set(value){for(const input of group.elements)input.checked=input.value===value;}};
  }
  const header=el('header',dialog),h=el('h2',header,t('feedEditor'));h.id='website-feed-heading';dialog.setAttribute('aria-labelledby',h.id);
  el('p',header,site.name+' · '+page).className='muted';
  const form=el('form');form.className='website-feed-form';
  const body=el('div',form);body.className='website-feed-scroll';
  const editing=el('fieldset',body);editing.className='website-feed-editing';
  const titles=el('div',editing);titles.className='website-feed-titles';
  const list=field(titles,'feedOnPage','select');list.dataset.feedSelect='';list.add(new Option(t('feedNew'),''));
  for(const feed of data.feeds)list.add(new Option(feed.heading||t('feedEditor'),feed.id));
  const heading=field(titles,'feedHeading','input');heading.dataset.feedHeading='';heading.maxLength=200;
  const capacity=el('p',editing);capacity.hidden=true;capacity.setAttribute('role','status');
  const scope=radios(editing,'feedScope',[['all','feedAll'],['filtered','feedFiltered']]);
  el('p',editing,t('feedScopeHelp')).className='muted';
  const filters=el('div',editing);filters.className='website-feed-filters';
  const direct=el('div',filters);direct.className='website-feed-query';
  const ruleControls=new Map();
  for(const [key,label,type] of [
   ['search','pickerSearch','search'],['searchField','pickerSearchField','select'],['filter','pickerFilter','select'],
   ['dateFrom','pickerFromDate','date'],['dateTo','pickerToDate','date'],['sort','pickerSort','select'],
  ]){
   const control=field(direct,label,type==='select'?'select':'input');control.dataset.feedCriterion=key;
   if(type==='select')for(const [value,name] of Object.entries(websiteSearchChoices[key]))control.add(new Option(t(name),value));
   else{control.type=type;if(type==='search')control.maxLength=160;}
   ruleControls.set(key,control);
  }
  const presets=el('details',filters);presets.dataset.feedPresets='';el('summary',presets,t('feedFindSearch'));
  const find=field(presets,'feedFindSearch','input');find.type='search';find.maxLength=160;
  const findButton=btn(presets,'pickerFind',()=>loadSearches(null,true));
  const saved=field(presets,'feedSavedFilter','select');saved.dataset.feedSavedSearch='';
  const summary=el('dl',filters);summary.className='website-feed-criteria';
  const nav=el('div',presets);nav.className='inline-actions';
  const previous=btn(nav,'prevPage',()=>loadSearches(cursors.at(-2))),next=btn(nav,'nextPage',()=>loadSearches(after));
  const template=radios(editing,'feedTemplate',[['full','placementFull'],['card','placementCard'],['custom','feedCustom']]);
  // What a card shows besides its title.
  const cardBox=el('fieldset',editing);cardBox.dataset.feedCard='';el('legend',cardBox,t('feedCardShows'));
  const cardChecks=new Map(['date','type','excerpt'].map(key=>{const label=el('label',cardBox),box=el('input',label);box.type='checkbox';box.value=key;box.dataset.feedCardField=key;el('span',label,t('feedCard_'+key));box.onchange=()=>{dirty=true;};return [key,box];}));
  const cardFields=()=>[...cardChecks].filter(([,box])=>box.checked).map(([key])=>key);
  const setCardFields=values=>{for(const [key,box] of cardChecks)box.checked=(values??[]).includes(key);};
  const custom=el('div',editing);custom.className='website-feed-custom';const item=feedItemEditor(custom,{t,changed:()=>{dirty=true;}});
  const paging=el('div',editing);paging.className='website-feed-paging';
  const layout=radios(paging,'feedLayout',[['list','feedList'],['grid','feedGrid']]);
  const size=field(paging,'feedPageSize','input');size.type='number';size.min='1';size.max='100';size.step='1';size.required=true;size.dataset.feedPageSize='';
  const position=field(editing,'feedPosition','select');position.dataset.feedPosition='';
  position.add(new Option(t('feedKeepPosition'),'keep'));position.add(new Option(t('pickerStart'),'start'));
  const blockPositions=blocks.map((text,i)=>new Option(t('feedBefore',{name:text,number:i+1}),String(i)));position.append(...blockPositions);
  position.add(new Option(t('pickerEnd'),'end'));
  const actions=el('footer',form),status=el('p',actions);status.setAttribute('role','status');
  const remove=btn(actions,'feedRemove',()=>write(true));remove.classList.add('website-feed-remove');const cancelButton=btn(actions,'cancel',cancel);
  const apply=el('button',actions,t('feedSave'));apply.type='submit';apply.className='button primary';apply.dataset.feedApply='';
  let selected='',selectedCriteria=null,filterName='',cursors=[],after=null,dirty=false,loading=false,saving=false,searchEpoch=0;
  dialog.authorDraft=()=>dirty&&!saving?{siteId:site.id,page,selected,heading:heading.value,scope:scope.value(),criteria:selectedCriteria,template:template.value(),layout:layout.value(),size:size.value,itemHTML:item.get(),arrangement:item.draft(),cardFields:cardFields()}:null;
  function showCriteria(){
   const labels={search:'pickerSearch',searchField:'pickerSearchField',filter:'pickerFilter',dateFrom:'pickerFromDate',dateTo:'pickerToDate',dateKnowledge:'pickerDate',recordType:'pickerType',status:'pickerStatus',tags:'pickerTags',projectId:'pickerProject',notebookId:'pickerBook',sort:'pickerSort',tagMode:'pickerTags'};
   summary.replaceChildren();
   for(const [key,value] of Object.entries(selectedCriteria??{})){
    if(!labels[key]||!value||value==='all'&&key!=='search'||key==='sort'&&value==='default'||Array.isArray(value)&&!value.length)continue;
    el('dt',summary,t(labels[key]));el('dd',summary,Array.isArray(value)?value.join(', '):String(value));
   }
   summary.hidden=!summary.children.length;
  }
  function fillRule(){
   for(const [key,control] of ruleControls)control.value=selectedCriteria?.[key]??(control.tagName==='SELECT'?control.options[0].value:'');
  }
  function changeRule(){
   const next={...selectedCriteria};
   for(const [key,control] of ruleControls){
    const value=control.value.trim();
    if(value&&!(control.tagName==='SELECT'&&value===control.options[0].value))next[key]=value;else delete next[key];
   }
   selectedCriteria=hasFilter(next)?next:null;
   saved.value='';filterName='';if(saved.options[0])saved.options[0].textContent=t('feedChooseSearch');
   dirty=true;showCriteria();message();
  }
  direct.oninput=changeRule;
  function paint(){
   custom.hidden=template.value()!=='custom';cardBox.hidden=template.value()!=='card';filters.hidden=scope.value()!=='filtered';
   remove.hidden=!selected;remove.disabled=loading||saving;cancelButton.disabled=saving;apply.disabled=loading||saving||(!filters.hidden&&!selectedCriteria);
   nav.hidden=cursors.length<2&&after===null;previous.disabled=cursors.length<2;next.disabled=after===null;
   status.hidden=!status.textContent;
  }
  function message(text=''){status.textContent=text;paint();}
  async function cancel(){if(!saving&&(!dirty||await confirmAction(t('discardConfirm'),{action:'discard'})))close();}
  function fail(error){if(current===dialog){message(error.message||t('failed'));}}
  async function loadSearches(cursor=null,reset=false){
   const epoch=++searchEpoch;
   try{
    const result=await request('library/saved-searches/list',{siteId:site.id,after:cursor??'',query:find.value.trim()});
    if(current!==dialog||epoch!==searchEpoch)return;
    const index=cursors.indexOf(cursor);cursors=reset||index<0&&cursor===null?[cursor]:index<0?[...cursors,cursor]:cursors.slice(0,index+1);
    after=result.next;const previousValue=saved.value;saved.replaceChildren();
    saved.add(new Option(selectedCriteria?(filterName||t('feedCurrentFilter')):t('feedChooseSearch'),'',true,true));
    for(const search of result.items){const option=new Option(search.name,search.id);option.feedCriteria=search.criteria;saved.add(option);}
    if(previousValue&&[...saved.options].some(o=>o.value===previousValue))saved.value=previousValue;
    showCriteria();
    message(!result.items.length&&!selectedCriteria?t('feedNoSearch'):'');
   }catch(error){fail(error);}
  }
  async function choose(id){
   const feed=id?(await request('feed/read',{...pin,feedId:id})).feed:null;
   if(current!==dialog)return;
   searchEpoch++;selected=id;list.value=id;selectedCriteria=hasFilter(feed?.criteria)?feed.criteria:null;filterName='';
   heading.value=feed?.heading??'';scope.set(selectedCriteria?'filtered':'all');template.set(feed?.template??'full');layout.set(feed?.layout??'list');setCardFields(feed?.cardFields);
   capacity.hidden=feed?.unavailable!=='capacity';capacity.textContent=capacity.hidden?'':t('feedCapacity');
   size.value=String(feed?.pageSize??12);position.options[0].disabled=!id;position.value=id?'keep':'end';
   item.set(feed?.itemHTML);find.value='';cursors=[];after=null;saved.replaceChildren();dirty=false;fillRule();showCriteria();message();
   if(selectedCriteria&&presets.open)await loadSearches(null,true);
  }
  async function write(deleting){
   if(saving||loading||!deleting&&!form.reportValidity()||deleting&&!await confirmAction(t('feedRemoveConfirm'),{action:'remove'}))return;
   const payload={...pin,feedId:selected||null};
   if(!deleting){
    if(scope.value()==='filtered'&&!selectedCriteria){message(t('feedChooseSearch'));return;}
    Object.assign(payload,{heading:heading.value.trim(),criteria:scope.value()==='filtered'?selectedCriteria:{},template:template.value(),layout:layout.value(),pageSize:size.valueAsNumber});
    if(payload.template==='custom')payload.itemHTML=item.forSave();
    if(payload.template==='card')payload.cardFields=cardFields();
    if(position.value!=='keep')payload.position=['start','end'].includes(position.value)?position.value:{before:Number(position.value)};
   }
   saving=true;editing.disabled=list.disabled=true;paint();
   const progress=deleting?null:operationProgress({host:body,stageText:t,title:()=>t('feedSave'),compact:true,disableControls:false});
   try{
    const value=await request(deleting?'feed/remove':'feed/save',payload,progress?{onProgress:progress.update}:undefined);
    if(current===dialog){close();refresh(value);}
   }catch(error){fail(error);}finally{progress?.close();saving=false;editing.disabled=list.disabled=false;paint();}
  }
  form.onsubmit=e=>{e.preventDefault();void write(false).catch(fail);};
  form.oninput=e=>{if(e.target!==find)dirty=true;};form.onchange=paint;
  list.onchange=async()=>{
   if(dirty&&!await confirmAction(t('discardConfirm'),{action:'discard'})){list.value=selected;return;}
   loading=true;editing.disabled=list.disabled=true;paint();try{await choose(list.value);}catch(error){list.value=selected;fail(error);}finally{loading=false;editing.disabled=list.disabled=false;paint();}
  };
  scope.group.onchange=paint;
  presets.ontoggle=()=>{if(presets.open&&!saved.options.length)void loadSearches(null,true);};
  saved.onchange=()=>{const opt=saved.selectedOptions[0];if(opt?.feedCriteria){selectedCriteria=opt.feedCriteria;filterName=opt.textContent;saved.options[0].textContent=filterName;fillRule();}showCriteria();paint();};
  find.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();findButton.click();}};
  dialog.addEventListener('cancel',event=>{event.preventDefault();cancel();});
  dialog.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopPropagation();if(!saving&&!loading)form.requestSubmit();}});
  dialog.addEventListener('close',()=>{if(current===dialog)current=null;dialog.remove();if(trigger?.isConnected)trigger.focus();},{once:true});
  document.body.append(dialog);dialog.showModal();loading=true;editing.disabled=list.disabled=true;paint();
  try{
   const pending=recovery?.siteId===site.id&&recovery.page===page?recovery:null;
   const restore=pending&&await confirmAction(t('feedRestoreDraft'),{action:'restore'});if(pending)recovery=null;
   await choose(restore?(data.feeds.some(f=>f.id===pending.selected)?pending.selected:''):feedId??'');
   if(restore&&current===dialog){
    heading.value=pending.heading;scope.set(pending.scope);selectedCriteria=pending.criteria;template.set(pending.template);layout.set(pending.layout);setCardFields(pending.cardFields);
    size.value=pending.size;item.set(pending.itemHTML,pending.arrangement);dirty=true;fillRule();if(pending.scope==='filtered'&&presets.open)await loadSearches(null,true);
   }
  }catch(error){close();report(error);}finally{loading=false;editing.disabled=list.disabled=false;paint();if(current===dialog)(selected?list:heading).focus();}
 }
 return {open,suspend,clear};
}

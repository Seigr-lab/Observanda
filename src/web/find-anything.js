// Find anything (Ctrl+K): one search over the places in the navigation, the settings
// categories, the tools and the records of this workspace, as an accelerator beside
// the navigation (docs/ui-overhaul/2026-11-25-consistency-design.md, rule 6). Every
// entry carries the same label and action as the control it stands for, so choosing
// it does exactly what that control does. The list follows the WAI-ARIA combobox
// pattern: the search field controls a listbox of grouped options.
import {t} from './i18n/index.js';
import {moduleLabel} from './module-presentation.js';
import {enabledModule} from './feature-modules.js';
import {discoverableTools} from './tool-directory-ui.js';
import {preferenceCategories} from './preferences-ui.js';
import {viewQuery} from './record-view-model.js';
import {collectionRecords,recordCollectionRoute,recordCollectionCommand} from './record-collection-client.js';
import {dashboardRecordAction} from './dashboard-collection-client.js';

const RECORD_LIMIT=8,STATIC_LIMIT=6,DELAY=200;
const text=(key,args)=>t('navigation',key,args);
const terms=query=>query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
const matches=(label,words)=>{const value=label.toLocaleLowerCase();return words.every(word=>value.includes(word));};
const rank=(label,words)=>label.toLocaleLowerCase().startsWith(words[0])?0:1;

export function findAnything({state,api,esc,run}){
 let dialog=null,opener=null,entries=[],active=-1,records=[],recordStatus='idle',generation=0,timer=null,controller=null;
 // The navigation's own controls, read from the side menu as it is drawn now.
 function places(){
  const seen=new Set();
  return [...document.querySelectorAll('#main-navigation button[data-action], #main-navigation a[data-action]')].flatMap(control=>{
   const label=(control.getAttribute('aria-label')||control.textContent).trim().replace(/\s+/g,' ');
   const key=control.dataset.action+'|'+(control.dataset.id??control.dataset.moduleId??'')+'|'+label;
   if(!label||seen.has(key)||control.dataset.action==='new-project')return [];seen.add(key);
   return [{group:'places',label,action:{...control.dataset}}];
  });
 }
 function settings(){return preferenceCategories(state.dashboardSettings).map(({id,label})=>({group:'settings',label,action:{action:id}}));}
 // A tool that is turned off is still found by name; choosing it opens Tools at that
 // tool, where it can be turned on. Nothing is turned on by searching.
 function tools(){return discoverableTools().map(module=>{const label=moduleLabel(module);return enabledModule(state.dashboardSettings,module.id)?{group:'tools',label,action:{action:'tool-launch',moduleId:module.id}}:{group:'tools',label,detail:text('findToolOff'),action:{action:'tools',toolQuery:label}};});}
 function local(query){
  const words=terms(query);if(!words.length)return [];
  return ['places','settings','tools'].flatMap(group=>{
   const items=(group==='places'?places():group==='settings'?settings():tools()).filter(item=>matches(item.label,words));
   return items.sort((a,b)=>rank(a.label,words)-rank(b.label,words)).slice(0,STATIC_LIMIT);
  });
 }
 // Records are searched where Find work searches them: the whole workspace, in
 // project stores when the workspace keeps its records there.
 async function searchRecords(query){
  const mine=++generation;controller?.abort();clearTimeout(timer);records=[];
  if(query.trim().length<2||!state.book){recordStatus='idle';paint();return;}
  recordStatus='searching';paint();
  timer=setTimeout(async()=>{
   controller=new AbortController();
   const scope={...state,project:null,notebook:'all',search:query.trim(),filter:'all',recordBrowse:null};
   try{
    const aggregate=collectionRecords(scope),route=aggregate?recordCollectionRoute(scope):'/api/research/records/query';
    const command=aggregate?recordCollectionCommand(scope,{limit:RECORD_LIMIT}):{workspaceId:state.book.id,query:viewQuery(scope),cursor:null,limit:RECORD_LIMIT};
    const data=await api(route,command,{adopt:false,signal:controller.signal});
    if(mine!==generation)return;
    records=(Array.isArray(data?.records)?data.records:[]).slice(0,RECORD_LIMIT).map(record=>{const target=dashboardRecordAction(record);return {group:'records',label:record.title||text('findUntitled'),action:{action:target.name,...(target.id?{id:target.id}:{}),...Object.fromEntries(Object.entries(target.data??{}).map(([key,value])=>[key,String(value)]))}};});
    recordStatus='done';
   }catch(error){if(error?.name==='AbortError'||mine!==generation)return;recordStatus='failed';}
   paint();
  },DELAY);
 }
 function build(){
  dialog=document.createElement('dialog');dialog.className='find-anything';dialog.setAttribute('aria-labelledby','find-anything-title');
  dialog.innerHTML='<form method="dialog" class="find-anything-form" role="search"><h2 id="find-anything-title"></h2><input type="text" id="find-anything-input" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="find-anything-results" autocomplete="off" spellcheck="false"><p class="find-anything-status muted" role="status" aria-live="polite"></p><ul id="find-anything-results" role="listbox"></ul></form>';
  const input=dialog.querySelector('input');
  input.addEventListener('input',()=>{active=-1;void searchRecords(input.value);paint();});
  input.addEventListener('keydown',event=>{
   if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(!entries.length)return;active=(active+(event.key==='ArrowDown'?1:-1)+entries.length)%entries.length;paint();}
   else if(event.key==='Enter'){event.preventDefault();if(entries.length)void choose(entries[Math.max(active,0)]);}
  });
  dialog.addEventListener('click',event=>{const option=event.target.closest('[role=option]');if(option)void choose(entries[Number(option.dataset.index)]);else if(event.target===dialog)dialog.close();});
  dialog.addEventListener('close',()=>{generation++;controller?.abort();clearTimeout(timer);const target=opener;opener=null;if(target?.isConnected&&!choosing)target.focus();});
  document.body.append(dialog);
 }
 let choosing=false;
 // Choosing an entry closes the search and runs the same action as the control it names.
 async function choose(entry){
  if(!entry)return;choosing=true;dialog.close();choosing=false;
  const control=document.createElement('button');control.type='button';for(const [key,value] of Object.entries(entry.action))control.dataset[key]=value;
  await run(control);
 }
 function paint(){
  if(!dialog)return;
  const input=dialog.querySelector('input'),list=dialog.querySelector('[role=listbox]'),status=dialog.querySelector('[role=status]'),query=input.value;
  entries=[...local(query),...records];if(active>=entries.length)active=entries.length-1;
  let html='',group='';
  entries.forEach((entry,index)=>{
   if(entry.group!==group){group=entry.group;html+='<li role="presentation" class="find-anything-group">'+esc(text('findGroup_'+group))+'</li>';}
   html+='<li role="option" id="find-anything-option-'+index+'" data-index="'+index+'" aria-selected="'+(index===active)+'">'+esc(entry.label)+(entry.detail?' <span class="find-anything-detail">'+esc(entry.detail)+'</span>':'')+'</li>';
  });
  list.innerHTML=html;
  input.setAttribute('aria-expanded',String(entries.length>0));
  if(active>=0){input.setAttribute('aria-activedescendant','find-anything-option-'+active);list.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');
  status.textContent=!query.trim()?text('findHint'):recordStatus==='searching'&&!entries.length?text('findSearching'):recordStatus==='failed'?text('findRecordsFailed'):entries.length?text('findCount',{count:entries.length}):text('findNone',{query:query.trim()});
 }
 function open(trigger=document.activeElement){
  if(!dialog)build();
  opener=trigger instanceof HTMLElement?trigger:null;
  dialog.querySelector('h2').textContent=text('find');
  const input=dialog.querySelector('input');input.setAttribute('aria-label',text('find'));input.placeholder=text('findPlaceholder');input.value='';
  records=[];recordStatus='idle';active=-1;paint();
  if(!dialog.open)dialog.showModal();input.focus();
 }
 return {open,isOpen:()=>Boolean(dialog?.open)};
}

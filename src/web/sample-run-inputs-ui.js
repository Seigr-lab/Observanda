import {t,language as appLanguage} from './i18n/index.js';
import {qualityText as tr} from './modules/resource-quality-presentation.js';

// Lots and equipment used in an analysis run. The server observes their
// readiness when the analysis is created (src/sample-run-quality.js); this
// component only chooses exact saved revisions: qualified equipment, or a
// recorded use of a qualified stock lot.
const MAX_INPUTS=64;
export function sampleRunInputsUI({state,api,esc,field,option}){
 let selected=[],search='',page=null,lot=null,uses=null,loading=false,error=null,controller=null,generation=0,timer=null;
 const button=(key,action,attrs='')=>`<button type="button" class="button" data-action="${action}" ${attrs}>${esc(tr(key))}</button>`;
 const full=()=>selected.length>=MAX_INPUTS;
 const useLabel=e=>`${e.data.delta} ${e.data.unit} · ${e.data.reason} · ${new Date(e.createdAt).toLocaleString(appLanguage())}`;
 function reset(){controller?.abort();controller=null;clearTimeout(timer);generation++;selected=[];search='';page=null;lot=null;uses=null;loading=false;error=null;}
 function view(){
  return `<fieldset data-lab-run-inputs><legend>${esc(tr('runInputs'))}</legend><p class="muted">${esc(tr('selectTracked'))}</p><div data-lab-run-selected></div><div data-lab-run-search>${field(esc(tr('search')),'<input type="search" id="lab-run-search" maxlength="256">')}</div><div data-lab-run-surface></div></fieldset>`;
 }
 function pager(current){
  if(!current)return '';
  return `<div class="section-bar">${['previous','next'].map(direction=>button(direction,'lab-run-page',`data-direction="${direction}" ${loading||!current[direction+'Cursor']?'disabled':''}`)).join('')}</div>`;
 }
 function results(){
  const rows=(page?.items??[]).filter(v=>v.type==='resource'&&['lot','equipment'].includes(v.qualityKind));
  if(page&&!rows.length)return `<p>${esc(tr('noMatches'))}</p>`;
  return rows.map(v=>{
   const added=selected.some(item=>item.id===v.id),lotItem=v.qualityKind==='lot';
   const kind=lotItem?tr('useLot')+' · '+tr('lotNumber')+' '+v.lotNumber:tr('equipment');
   const control=lotItem?button('selectMovement','lab-run-lot',`data-id="${v.id}" ${full()?'disabled':''} aria-label="${esc(tr('selectMovement')+': '+v.title)}"`)
    :button('add','lab-run-add',`data-id="${v.id}" ${added||full()?'disabled':''} aria-label="${esc(tr('add')+': '+v.title)}"`);
   return `<p data-lab-run-item="${v.id}"><strong>${esc(v.title)}</strong> · ${esc(kind)} ${control}</p>`;
  }).join('');
 }
 function usesView(){
  const rows=(uses?.items??[]).filter(e=>e.type==='movement'&&e.data.resourceId===lot.id&&e.data.useKind==='used'&&e.data.qualityAtUse&&!selected.some(item=>item.id===e.id));
  return `<p><strong>${esc(tr('useLot'))}</strong> · ${esc(lot.title+' · '+tr('lotNumber')+' '+lot.lotNumber)}</p>${uses?(rows.length?field(esc(tr('selectMovement')),`<select id="lab-run-use">${rows.map(e=>option(e.id,useLabel(e),rows[0].id)).join('')}</select>`)+button('add','lab-run-add-use',full()?'disabled':''):`<p>${esc(tr('noMatches'))}</p>`):''}${pager(uses)}${button('otherItem','lab-run-other')}`;
 }
 function draw(){
  const root=document.querySelector('[data-lab-run-inputs]');if(!root)return;
  const active=document.activeElement,action=root.contains(active)?active.dataset.action:null,direction=active?.dataset.direction,id=active?.dataset.id;
  root.querySelector('[data-lab-run-selected]').innerHTML=selected.length?`<ul>${selected.map(item=>`<li>${esc(item.label)} ${button('removeInput','lab-run-remove',`data-id="${item.id}" aria-label="${esc(tr('removeInput')+': '+item.label)}"`)}</li>`).join('')}</ul>`:'';
  root.querySelector('[data-lab-run-search]').hidden=!!lot;
  root.querySelector('[data-lab-run-surface]').innerHTML=`${error?`<p role="alert">${esc(error.message)}</p>`:''}${loading?`<p role="status">${esc(t('sampleAnalysis','loading'))}</p>`:''}${lot?usesView():results()+pager(page)}`;
  if(action){const selector=`[data-action="${action}"]${direction?`[data-direction="${direction}"]`:''}${id?`[data-id="${id}"]`:''}:not(:disabled)`;(root.querySelector(selector)??(lot?root.querySelector('[data-action="lab-run-other"]'):root.querySelector('#lab-run-search')))?.focus();}
 }
 async function load(cursor=null){
  const n=++generation,request=lot?['/api/modules/inventory/ledger',{workspaceId:state.book.id,resourceId:lot.id,kind:'movements',cursor,limit:25}]:['/api/modules/items',{workspaceId:state.book.id,type:'resource',query:search,cursor,limit:25}];
  controller?.abort();controller=new AbortController();loading=true;error=null;draw();
  try{
   const value=await api(request[0],request[1],{adopt:false,signal:controller.signal});
   if(n!==generation)return;
   if(value?.workspaceId!==state.book.id||!Array.isArray(value.items))throw Error(t('sampleAnalysis','unavailable'));
   if(lot)uses=value;else page=value;
  }catch(e){if(n!==generation||e?.name==='AbortError')return;error=e;}
  finally{if(n===generation){loading=false;draw();}}
 }
 async function action(node){
  const name=node.dataset.action,id=node.dataset.id;
  if(!name.startsWith('lab-run-'))return false;
  if(name==='lab-run-page'){const current=lot?uses:page,cursor=current?.[node.dataset.direction+'Cursor'];if(cursor)await load(cursor);}
  else if(name==='lab-run-add'){
   const v=page?.items.find(item=>item.id===id);
   if(!v||v.qualityKind!=='equipment')throw Error(tr('selectTracked'));
   if(!full()&&!selected.some(item=>item.id===v.id))selected.push({kind:'equipment',id:v.id,revision:v.revision,label:v.title});draw();
  }
  else if(name==='lab-run-lot'){const v=page?.items.find(item=>item.id===id);if(!v||v.qualityKind!=='lot')throw Error(tr('selectTracked'));lot={id:v.id,title:v.title,lotNumber:v.lotNumber};uses=null;await load();}
  else if(name==='lab-run-add-use'){
   const choice=document.querySelector('#lab-run-use')?.value,e=uses?.items.find(item=>item.id===choice);
   if(!e)throw Error(tr('selectFirst'));
   if(!full()&&!selected.some(item=>item.id===e.id))selected.push({kind:'movement',id:e.id,revision:e.revision,label:lot.title+' · '+tr('lotNumber')+' '+lot.lotNumber+' · '+useLabel(e)});
   lot=null;uses=null;draw();document.querySelector('#lab-run-search')?.focus();
  }
  else if(name==='lab-run-other'){controller?.abort();generation++;lot=null;uses=null;loading=false;error=null;draw();document.querySelector('#lab-run-search')?.focus();}
  else if(name==='lab-run-remove'){selected=selected.filter(item=>item.id!==id);draw();}
  return true;
 }
 function input(el){
  if(el.id!=='lab-run-search')return false;
  search=el.value;clearTimeout(timer);timer=setTimeout(()=>void load(),180);return true;
 }
 // The command carries only stable identities; readiness is observed by the server.
 const value=()=>selected.length?selected.map(({kind,id,revision})=>({kind,id,revision})):null;
 return {view,draw,load,action,input,reset,value};
}

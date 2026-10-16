import {t} from './i18n/index.js';
const text=(key,parameters)=>t('dashboardChoices',key,parameters);
// Each inspector setting owns one page of choices. Closing or changing scope
// cancels discovery; late replies cannot populate another card or workspace.
export function dashboardChoiceUI({api,esc,onChange,access=operation=>operation()}){
 let identity='';const states=new Map();
 const stop=current=>{clearTimeout(current.timer);current.controller?.abort();current.controller=null;};
 const close=()=>{for(const current of states.values())stop(current);states.clear();identity='';};
 async function load(current,unlock=false){
  stop(current);if(states.get(current.setting.key)!==current)return;
  const request=new AbortController();current.controller=request;current.status='loading';
  try{
   const run=()=>{request.signal.throwIfAborted();return current.setting.loadChoices({api,context:current.context,panel:current.panel,search:current.search,cursor:current.cursor,signal:request.signal});};
   const result=await (unlock?access(run):run());
   if(request.signal.aborted||states.get(current.setting.key)!==current)return;
   current.result=result;current.status='ready';
  }catch(error){if(request.signal.aborted||states.get(current.setting.key)!==current)return;current.status='error';current.result=null;}
  if(states.get(current.setting.key)===current&&!request.signal.aborted){current.controller=null;onChange();}
 }
 function view(setting,panel,context){
  const signature=JSON.stringify([context.book.id,context.etag,panel.id,panel.config,panel.options]);
  if(identity!==signature){close();identity=signature;}
  let state=states.get(setting.key);
  if(!state){state={setting,panel:structuredClone(panel),context,search:'',cursor:null,result:null,status:'loading',controller:null,timer:null};states.set(setting.key,state);void load(state);}
  const {result,status,search}=state,value=panel.options[setting.key]??panel.config[setting.key]??setting.default??(setting.multiple?[]:setting.defaultChoice.value);
  const choices=setting.multiple?[...(result?.items??[])]:[setting.defaultChoice,...(result?.items??[])];
  if(setting.multiple){for(const id of value)if(!choices.some(c=>c.value===id))choices.push(result?.selected?.find(c=>c.value===id)??{value:id,label:text(status==='ready'?'unavailable':'selected')});}
  else if(!choices.some(choice=>choice.value===value))choices.splice(1,0,result?.selected??{value,label:text(status==='ready'?'unavailable':'selected')});
  const button=(key,action,disabled=false)=>`<button type="button" class="desk-button" data-action="dashboard-choice-${action}" data-desk-choice-action="${action}" data-desk-choice-key="${esc(setting.key)}" aria-disabled="${status==='loading'||disabled}" ${disabled?'disabled':''}>${esc(text(key))}</button>`;
  return `<div class="desk-choice-lookup">${setting.multiple?`<fieldset class="desk-multi-choice"><legend>${esc(setting.label)}</legend><div>${choices.map(choice=>`<label><input type="checkbox" data-desk-option="${esc(setting.key)}" data-id="${panel.id}" data-desk-choice="${esc(choice.value)}" value="${esc(choice.value)}" ${value.includes(choice.value)?'checked':''}><span>${esc(choice.label)}</span></label>`).join('')}</div></fieldset>`:`<label>${esc(setting.label)}<select aria-label="${esc(setting.label)}" data-desk-option="${esc(setting.key)}" data-id="${panel.id}">${choices.map(choice=>`<option value="${esc(choice.value)}" ${choice.value===value?'selected':''}>${esc(choice.label)}</option>`).join('')}</select></label>`}
   <label>${esc(setting.searchLabel)}<input type="search" data-desk-choice-search="${esc(setting.key)}" data-desk-choice-key="${esc(setting.key)}" maxlength="160" value="${esc(search)}"></label>
   <div class="desk-choice-status" role="status">${esc(status==='loading'?text('loading'):status==='error'?text('error'):result.total?text('range',{first:result.offset+1,last:result.offset+result.items.length,total:result.total}):text('empty'))}</div>
   ${status==='error'?button('retry','retry'):result?.previousCursor||result?.nextCursor?`<div class="desk-choice-pages">${button('previous','previous',!result.previousCursor)}${button('next','next',!result.nextCursor)}</div>`:''}
  </div>`;
 }
 function input(el){
  const state=states.get(el.dataset.deskChoiceKey);if(!el.hasAttribute('data-desk-choice-search')||!state)return false;
  stop(state);state.search=el.value;state.cursor=null;state.result=null;state.status='loading';state.timer=setTimeout(()=>load(state),180);onChange();return true;
 }
 async function action(el){
  const state=states.get(el.dataset.deskChoiceKey);if(!el.dataset.action?.startsWith('dashboard-choice-')||!state)return false;
  const name=el.dataset.action.slice('dashboard-choice-'.length);
  if(name==='next'||name==='previous'){
   if(state.status!=='ready')return true;
   const cursor=state.result?.[name+'Cursor'];if(!cursor)return true;state.cursor=cursor;
  }else if(name!=='retry')return false;
  const request=load(state,name==='retry');onChange();await request;return true;
 }
 return {view,input,action,close};
}

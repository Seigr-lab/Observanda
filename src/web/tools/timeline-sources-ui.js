import {t} from '../i18n/index.js';
import {validTimelineSource} from './timeline-source.js';
const tr=(key,values)=>t('timeline',key,values);
export function timelineSourcesUI({api,state,esc,access=operation=>operation()}){
 const lists=new Map();let identity='',current=null;
 const node=kind=>document.querySelector('[data-timeline-choices="'+kind+'"]');
 const stop=list=>{list.controller?.abort();clearTimeout(list.timer);};
 const close=()=>{for(const list of lists.values())stop(list);lists.clear();identity='';current=null;};
 function paint(list){
  const root=node(list.kind);if(!root)return;
  const selected=current.data[list.kind],items=[...(list.result?.items??[])];
  for(const value of selected)if(!items.some(item=>item.value===value))items.push(list.result?.selected.find(item=>item.value===value)??{value,label:tr('selectedSource')});
  root.querySelector('[data-source-items]').innerHTML=items.map(item=>'<label class="checkbox"><input type="checkbox" data-timeline-source="'+list.kind+'" value="'+esc(item.value)+'" '+(selected.includes(item.value)?'checked':'')+'>'+esc(item.label)+'</label>').join('');
  root.querySelector('[data-source-status]').textContent=tr(list.status==='error'?'sourceFailed':list.status==='loading'?'sourceLoading':list.result.total?'sourceRange':'sourceEmpty',list.result?{first:list.result.offset+1,last:list.result.offset+list.result.items.length,total:list.result.total}:{});
  const button=(key,command,disabled=false)=>'<button type="button" class="button" data-action="module-command" data-command="timeline-source-'+command+'" data-source-kind="'+list.kind+'" '+(disabled?'disabled':'')+'>'+esc(tr(key))+'</button>';
  root.querySelector('[data-source-actions]').innerHTML=list.status==='error'?button('sourceRetry','retry'):list.result?.previousCursor||list.result?.nextCursor?button('sourcePrevious','previous',list.status==='loading'||!list.result.previousCursor)+button('sourceNext','next',list.status==='loading'||!list.result.nextCursor):'';
 }
 async function load(list,unlock=false){
  stop(list);const controller=new AbortController();list.controller=controller;list.status='loading';paint(list);
  const valid=()=>!controller.signal.aborted&&lists.get(list.kind)===list&&!!node(list.kind);
  try{
   const run=()=>{controller.signal.throwIfAborted();return api('/api/projects/'+(state.projectOwner?.projectId?state.projectOwner.projectId+'/':'')+'timeline-collection/choices',{workspaceId:state.book.id,kind:list.kind,selected:current.data[list.kind],search:list.search,cursor:list.cursor,limit:25},{adopt:false,signal:controller.signal});};
   const result=await (unlock?access(run):run());if(!valid())return;
   const choices=items=>Array.isArray(items)&&items.every(item=>item&&Object.keys(item).sort().join()==='label,value'&&validTimelineSource(item.value)&&typeof item.label==='string')&&new Set(items.map(item=>item.value)).size===items.length;
   if(result?.workspaceId!==state.book.id||!choices(result.items)||result.items.length>25||!choices(result.selected)||result.selected.length>current.data[list.kind].length||result.selected.some(item=>!current.data[list.kind].includes(item.value))||!Number.isSafeInteger(result.total)||result.total<0||!Number.isSafeInteger(result.offset)||result.offset<0||result.offset>result.total||result.items.length!==Math.min(25,result.total-result.offset)||![result.nextCursor,result.previousCursor].every(value=>value===null||typeof value==='string'&&!!value))throw Error('TIMELINE_RESPONSE');
   list.result=result;list.status='ready';
  }catch(error){if(!valid())return;list.result=null;list.status='error';}
  finally{if(valid()){list.controller=null;paint(list);}}
 }
 function bind(draft){
  const next=JSON.stringify([state.storage?.contextId,state.book.id,draft.id]);if(identity!==next){close();identity=next;}current=draft;
  for(const kind of ['projects','books']){const root=node(kind);if(!root)continue;let list=lists.get(kind);if(!list){list={kind,search:'',cursor:null,result:null,status:'loading'};lists.set(kind,list);void load(list);}else paint(list);}
 }
 function field(kind){return '<fieldset data-timeline-choices="'+kind+'"><legend>'+esc(tr(kind))+'</legend><label>'+esc(tr(kind==='projects'?'searchProjects':'searchBooks'))+'<input type="search" maxlength="160" data-timeline-source-search="'+kind+'"></label><div data-source-items></div><p role="status" tabindex="-1" data-source-status></p><div class="module-actions" data-source-actions></div></fieldset>';}
 function input(el){const list=lists.get(el.dataset.timelineSourceSearch);if(!list)return false;stop(list);list.search=el.value;list.cursor=null;list.result=null;list.status='loading';paint(list);list.timer=setTimeout(()=>load(list),180);return true;}
 async function action(name,button){
  if(!name.startsWith('timeline-source-'))return false;const list=lists.get(button.dataset.sourceKind);if(!list)return true;
  const part=name.slice('timeline-source-'.length);if(part==='next'||part==='previous'){if(list.status!=='ready'||!list.result?.[part+'Cursor'])return true;list.cursor=list.result[part+'Cursor'];}else if(part!=='retry')return false;
  await load(list,part==='retry');if(lists.get(list.kind)===list)node(list.kind)?.querySelector('[data-source-status]')?.focus();return true;
 }
 return {field,bind,input,action,close};
}

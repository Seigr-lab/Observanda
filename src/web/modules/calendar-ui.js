import {projectUsesTool} from '../project-tools.js';
import {parseScope,scopePath,scopeControl,ownerLabel,inScope} from './scope.js';
import {localDate,nextDate} from './calendar-model.js';
import {verifiedCalendarPage} from './calendar-page.js';
import {t} from '../i18n/index.js';
const tr=(key,values)=>t('calendar',key,values),empty=()=>({sources:[],events:[],days:[],total:0});
import {calendarDetails} from './calendar-details.js';
import {researchId} from '../research-reference.js';
import {validModuleSummary} from './item-pages.js';
export function calendarUI(services,editor){
 const {state,api,esc,render,showDialog,notify}=services;
 const details=calendarDetails(services);
 let data=empty(),month=localDate(new Date()).slice(0,7),mode=window.innerWidth<=650?'agenda':'month',recursive=true,hidden=new Set(),error='',loading=false,loadedKey='',loadingKey='',request=0,disposed=false,last=0,timer=null;
 let selectedDay=localDate(new Date()),focusTarget=null,controller=null,sourceCursor=null,sourceSearch='',searchTimer=null;
 const current=()=>parseScope(state.modulePath);
 const shown=()=>state.page==='module'&&state.moduleId==='planning'&&['','agenda'].includes(current().path);
 const range=()=>{const [y,m]=month.split('-').map(Number);return {from:localDate(new Date(y,m-1,1)),to:localDate(new Date(y,m,1))};};
 const options=()=>({workspaceId:state.book.id,...(mode==='day'?{from:selectedDay,to:nextDate(selectedDay)}:range()),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,mode:mode==='month'?'month':'agenda',projectId:current().projectId,recursive,hidden:[...hidden].sort(),limit:50,sourceCursor,sourceSearch});
 const queryKey=()=>JSON.stringify(options());
 function controls(label,command,attrs='',primary=false){return `<button type="button" class="button ${primary?'primary':''}" data-action="module-command" data-command="${command}" ${attrs}>${esc(label)}</button>`;}
 async function load(refresh=false,cursor=null){
  if(!focusTarget){const node=document.activeElement;if(node?.hasAttribute('data-calendar-source'))focusTarget='[data-calendar-source="'+node.dataset.calendarSource+'"]';else if(node?.matches('[data-calendar-mode]'))focusTarget='[data-calendar-mode]';else if(node?.matches('[data-calendar-month]'))focusTarget='[data-calendar-month]';else if(node?.dataset.command?.startsWith('calendar-page-'))focusTarget='[data-command="'+node.dataset.command+'"]';}
  controller?.abort();controller=new AbortController();
  const token=++request,query=options(),key=JSON.stringify(query),context=state.storage?.contextId;loading=true;loadingKey=key;error='';
  if(shown())render();
  try{const result=await api('/api/calendars/page',{...query,cursor,refresh},{adopt:false,signal:controller.signal});if(disposed||request!==token||context!==state.storage?.contextId)return;data=verifiedCalendarPage(result,state.book.id,query);loadedKey=key;last=Date.now();}
  catch(e){if(request===token&&e.name!=='AbortError'){data=empty();error=e.message;loadedKey=key;last=Date.now();}}
  finally{if(request===token&&!disposed){loading=false;loadingKey='';if(shown())render();}}
 }
 function open(path){state.modulePath=scopePath(current().projectId,path);render();}
 const dayLabel=day=>new Date(day+'T12:00').toLocaleDateString([],{weekday:'long',year:'numeric',month:'long',day:'numeric'});
 function openDay(day){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T12:00Z'))||new Date(day+'T12:00Z').toISOString().slice(0,10)!==day)return;
  selectedDay=day;month=day.slice(0,7);mode='day';sourceCursor=null;focusTarget='[data-day-heading]';render();
 }
 function shiftDay(amount){
  const date=new Date(selectedDay+'T12:00');date.setDate(date.getDate()+amount);openDay(localDate(date));
 }
 function showMonth(){mode='month';sourceCursor=null;focusTarget='[data-command="calendar-open-day"][data-date="'+selectedDay+'"]';render();}
 function eventButton(e,compact=false,detailed=false){
  const source=e.source,formatTime=value=>{
   const date=new Date(value),options={hour:'2-digit',minute:'2-digit'};
   if(detailed&&localDate(date)!==selectedDay)Object.assign(options,{month:'short',day:'numeric'});
   return date.toLocaleString([],options);
  },time=e.allDay?tr('allDay'):formatTime(e.startsAt)+(detailed&&e.endsAt!==e.startsAt?' – '+formatTime(e.endsAt):'');
  return `<button type="button" class="calendar-event ${compact?'compact':''}" data-calendar-colour="${source?.color??'#3958ba'}" data-action="module-command" data-command="calendar-event" data-event-id="${esc(e.id)}" data-source-id="${esc(e.sourceId)}"><span>${esc(time)}</span><strong>${esc(e.title)}</strong>${compact?'':`<small>${esc(source?.name)} · ${esc(e.origin??source?.owner)}${e.type==='task'?' · '+esc(tr('taskDeadline')):e.type==='booking'?' · '+esc(tr('booking')):''}${source?.readOnly?' · '+esc(tr('readOnly')):''}</small>${detailed&&e.location?`<small>${esc(e.location)}</small>`:''}`}</button>`;
 }
 function monthView(selected){
  const {from,to}=range(),first=new Date(from+'T12:00'),offset=(first.getDay()+6)%7,days=Math.round((Date.parse(to)-Date.parse(from))/86400000),today=localDate(new Date());
  const cells=Array.from({length:Math.ceil((offset+days)/7)*7},(_,i)=>{
   if(i<offset||i>=offset+days)return '<div class="calendar-day outside" aria-hidden="true"></div>';
   const day=from.slice(0,8)+String(i-offset+1).padStart(2,'0'),end=nextDate(day);
   const summary=selected.days.find(d=>d.date===day),items=summary?.events??[],more=(summary?.total??0)-items.length;
   return `<section class="calendar-day ${day===today?'today':''}" data-calendar-day="${day}" aria-label="${day}"><button type="button" class="calendar-date" data-action="module-command" data-command="calendar-open-day" data-date="${day}" aria-label="${esc(tr('openDay',{day:dayLabel(day)}))}" ${day===today?'aria-current="date"':''}><time datetime="${day}">${i-offset+1}</time></button>${items.map(e=>eventButton(e,true)).join('')}${more?controls(tr('more',{count:more}),'calendar-open-day',`data-date="${day}"`):''}</section>`;
  }).join('');
  const weekdays=Array.from({length:7},(_,i)=>new Date(2026,0,5+i).toLocaleDateString([],{weekday:'short'}));
  return `<div class="calendar-month">${weekdays.map(d=>`<div class="calendar-weekday">${esc(d)}</div>`).join('')}${cells}</div>`;
 }
 function dayView(events){
  const allDay=events.filter(e=>e.allDay),timed=events.filter(e=>!e.allDay).sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
  return `<div class="calendar-day-plan"><header class="calendar-day-heading"><div><p class="eyebrow">${esc(tr('dayPlan'))}</p><h2 data-day-heading tabindex="-1">${esc(dayLabel(selectedDay))}</h2></div><div class="module-actions">${controls(tr('addEvent'),'calendar-new-event','',true)}${controls(tr('backMonth'),'calendar-month-view')}</div></header>${events.length?`${allDay.length?`<section aria-label="${esc(tr('allDayPlans'))}"><h3>${esc(tr('allDay'))}</h3>${allDay.map(e=>eventButton(e,false,true)).join('')}</section>`:''}${timed.length?`<section aria-label="${esc(tr('scheduledPlans'))}"><h3>${esc(tr('scheduledPlans'))}</h3>${timed.map(e=>eventButton(e,false,true)).join('')}</section>`:''}`:`<div class="calendar-day-empty"><h3>${esc(tr('emptyDay'))}</h3><p>${esc(tr('emptyDayHelp'))}</p></div>`}</div>`;
 }
 function toolbar(count){
  const day=mode==='day';
  return `<div class="calendar-toolbar">${controls(tr(day?'previousDay':'previousMonth'),'calendar-previous')}<label>${esc(tr(day?'date':'month'))}<input type="${day?'date':'month'}" ${day?'data-calendar-date':'data-calendar-month'} value="${day?selectedDay:month}" required></label>${controls(tr(day?'nextDay':'nextMonth'),'calendar-next')}${controls(tr('today'),'calendar-today')}<label>${esc(tr('view'))}<select data-calendar-mode>${['month','agenda','day'].map(value=>`<option value="${value}" ${mode===value?'selected':''}>${esc(tr(value))}</option>`).join('')}</select></label><span role="status">${esc(loading?tr('updating'):tr(count===1?'oneScheduled':'scheduled',{count}))}</span></div>`;
 }
 function navigation(selected){
  if(mode==='month'||!selected.total)return '';
  return `<nav class="module-actions" aria-label="${esc(tr('schedule'))}"><span role="status">${esc(tr('pageRange',{first:selected.offset+1,last:selected.offset+selected.events.length,total:selected.total}))}</span>${controls(tr('previousPage'),'calendar-page-previous',loading||!selected.previousCursor?'disabled':'')}${controls(tr('nextPage'),'calendar-page-next',loading||!selected.nextCursor?'disabled':'')}</nav>`;
 }
 function sourceNavigation(selected){
  const page=selected.sourcePage;if(!page)return '';
  return `<nav class="module-actions" aria-label="${esc(tr('sourcePages'))}"><span role="status">${esc(tr('sourceRange',{first:page.total?page.offset+1:0,last:page.offset+selected.sources.length,total:page.total}))}</span>${controls(tr('previousSources'),'calendar-source-previous',loading||!page.previousCursor?'disabled':'')}${controls(tr('nextSources'),'calendar-source-next',loading||!page.nextCursor?'disabled':'')}</nav>`;
 }
 function overview(){
  const parsed=current(),selected=loadedKey===queryKey()?data:empty(),title=parsed.projectId?ownerLabel(state.book,parsed.projectId):state.book.title;
  const sourceErrorsOutsidePage=(selected.sourceErrors??[]).filter(source=>!selected.sources.some(visible=>visible.id===source.id));
  const sources=selected.sources.map(s=>`<article><label class="checkbox"><input type="checkbox" data-calendar-source="${esc(s.id)}" ${hidden.has(s.id)?'':'checked'}><span class="calendar-dot" data-calendar-colour="${s.color}"></span><strong>${esc(s.name)}</strong></label><small>${esc(s.owner)}${s.readOnly?' · '+esc(tr('readOnly')):''}</small>${s.error?`<p class="calendar-source-error" role="status">${esc(s.error)}</p>`:s.checkedAt?`<small>${esc(tr('updated',{time:new Date(s.checkedAt).toLocaleTimeString()}))}</small>`:''}${s.locked?controls(tr('unlockWorkspace'),'calendar-unlock',`data-id="${s.id}"`):''}</article>`).join('')||'<p>'+esc(tr('noCalendars'))+'</p>';
  const content=mode==='day'?dayView(selected.events):mode==='month'?monthView(selected):`<div class="calendar-agenda">${selected.events.map(e=>`<article><time>${esc(e.allDay?e.startsAt:new Date(e.startsAt).toLocaleDateString())}</time>${eventButton(e)}</article>`).join('')||'<p>'+esc(tr('emptyAgenda'))+'</p>'}</div>`;
  return `<div class="module-workbench calendar-workbench" data-calendar-view="${mode}"><header class="module-heading"><div><p class="eyebrow">${esc(title)}</p><h1>${esc(tr('heading'))}</h1></div><div class="module-actions">${mode==='day'?'':controls(tr('newEvent'),'calendar-new-event','',true)}${controls(tr('manage'),'calendar-manage')}${controls(tr('refresh'),'calendar-refresh',loading?'disabled':'')}</div></header>${editor.navigation()}${scopeControl(state.book,parsed.projectId,esc,{recursive,moduleId:'planning'})}${toolbar(selected.total)}${error?`<p role="alert" class="module-error">${esc(error)}</p>`:''}${sourceErrorsOutsidePage.map(s=>`<p class="calendar-source-error" role="status">${esc(tr('sourceFailed',{name:s.name,error:s.error}))}</p>`).join('')}<div class="calendar-layout"><aside class="calendar-sources" aria-label="${esc(tr('sources'))}"><h2>${esc(tr('sources'))}</h2><label class="field">${esc(tr('searchSources'))}<input type="search" data-calendar-source-search value="${esc(sourceSearch)}"></label>${sources}${sourceNavigation(selected)}<div class="module-actions">${controls(tr('addCalendar'),'calendar-add')}${controls(tr('subscribe'),'calendar-subscribe')}${controls(tr('connect'),'calendar-connect')}</div></aside><section class="calendar-content" aria-label="${esc(tr('schedule'))}">${content}${navigation(selected)}</section></div><p class="muted">${esc(tr('timeZone',{zone:Intl.DateTimeFormat().resolvedOptions().timeZone}))}</p></div>`;
 }
 async function newItem(type,initial={}){open(type);editor.view(state.modulePath);await editor.create(type,initial);}
 return {
  ...editor,
  view(path){return ['', 'agenda'].includes(parseScope(path).path)?overview():editor.view(path);},
  bind(){
   editor.bind();
   if(!shown())return;
   for(const node of document.querySelectorAll('[data-calendar-colour]')){
    const colour=node.dataset.calendarColour;if(!/^#[a-f0-9]{6}$/i.test(colour))continue;
    if(node.classList.contains('calendar-dot'))node.style.backgroundColor=colour;else node.style.setProperty('--calendar-colour',colour);
   }
   for(const cell of document.querySelectorAll('[data-calendar-day]'))cell.ondblclick=event=>{
    if(event.target.closest('button,a,input,select,textarea'))return;
    event.preventDefault();openDay(cell.dataset.calendarDay);
   };
   if(focusTarget&&!loading&&loadedKey===queryKey()){
    const target=document.querySelector(focusTarget);target?.focus({preventScroll:true});if(target?.hasAttribute('data-calendar-source-search'))target.setSelectionRange(target.value.length,target.value.length);target?.scrollIntoView({block:'nearest'});focusTarget=null;
   }
   if(!timer)timer=setInterval(()=>{if(shown()&&!document.hidden&&!loading&&Date.now()-last>=60000)load(false,data.cursor??null);},15000);
   const key=queryKey();if(loadedKey!==key&&loadingKey!==key)void load();
  },
  async activate(options){await editor.activate(options);loadedKey='';if(shown())await load();},
  input(el){
   if(!shown())return editor.input(el);
   if(el.hasAttribute('data-operation-scope')){state.modulePath=scopePath(el.value||null,'agenda');sourceCursor=null;render();return true;}
   if(el.hasAttribute('data-operation-descendants')){recursive=el.checked;sourceCursor=null;render();return true;}
   if(el.hasAttribute('data-calendar-source-search')){sourceSearch=el.value;sourceCursor=null;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{focusTarget='[data-calendar-source-search]';if(shown())render();},250);return true;}
   if(el.hasAttribute('data-calendar-month')){if(/^\d{4}-\d{2}$/.test(el.value)){month=el.value;loadedKey='';sourceCursor=null;render();}return true;}
   if(el.hasAttribute('data-calendar-date')){openDay(el.value);return true;}
   if(el.hasAttribute('data-calendar-mode')){
    if(el.value==='day'){openDay(selectedDay.startsWith(month)?selectedDay:month+'-01');}
    else {mode=el.value;sourceCursor=null;render();}
    return true;
   }
   if(el.hasAttribute('data-calendar-source')){if(el.checked)hidden.delete(el.dataset.calendarSource);else hidden.add(el.dataset.calendarSource);render();return true;}
   return false;
  },
  async action(name,node){
   if(!name.startsWith('calendar-'))return editor.action(name,node);
   if(name==='calendar-refresh'){sourceCursor=null;await load(true);}
   else if(name==='calendar-source-next'||name==='calendar-source-previous'){const cursor=data.sourcePage?.[name.endsWith('next')?'nextCursor':'previousCursor'];if(cursor&&!loading){sourceCursor=cursor;focusTarget='[data-command="'+name+'"]';await load(false,data.cursor??null);}}
   else if(name==='calendar-page-next'||name==='calendar-page-previous'){const cursor=data[name.endsWith('next')?'nextCursor':'previousCursor'];if(cursor&&!loading)await load(false,cursor);}
   else if(name==='calendar-open-day')openDay(node.dataset.date);
   else if(name==='calendar-month-view')showMonth();
   else if(name==='calendar-previous'||name==='calendar-next'){
    const step=name==='calendar-next'?1:-1;
    if(mode==='day')shiftDay(step);
    else {const [y,m]=month.split('-').map(Number);month=localDate(new Date(y,m-1+step,1)).slice(0,7);sourceCursor=null;render();}
   }
   else if(name==='calendar-today'){selectedDay=localDate(new Date());month=selectedDay.slice(0,7);sourceCursor=null;render();}
   else if(name==='calendar-manage')open('calendar');
   else if(name==='calendar-tasks')open('task');
   else if(name==='calendar-bookings')open('booking');
   else if(name==='calendar-new-event'){
    const calendars=data.sources.filter(e=>!e.readOnly&&researchId(e.id)&&projectUsesTool(state.book,e.projectId,'planning')&&inScope(state.book,e.projectId,current().projectId,recursive));
    let preferred=calendars.find(e=>!hidden.has(e.id)&&e.projectId===current().projectId)??calendars.find(e=>!hidden.has(e.id))??calendars[0];
    if(!preferred){
     const workspaceId=state.book.id,path=state.modulePath,context=state.storage?.contextId;
     const reply=await api('/api/modules/items',{workspaceId,type:'calendar',archived:false,moduleId:'planning',projectId:current().projectId,recursive,limit:1},{adopt:false});
     if(disposed||!shown()||state.book.id!==workspaceId||state.modulePath!==path||state.storage?.contextId!==context)return;
     if(reply?.workspaceId!==workspaceId||!Array.isArray(reply.items)||reply.items.length>1||reply.items.some(item=>!validModuleSummary(item)||item.type!=='calendar'))throw Error(tr('invalidPage'));
     preferred=reply.items[0];
    }
    if(!preferred){notify(tr('createCalendarFirst'));await newItem('calendar');}
    else await newItem('event',{calendarId:preferred.id,...(mode==='day'?{startsAt:selectedDay,endsAt:nextDate(selectedDay)}:{})});
   }
   else if(name==='calendar-add')await newItem('calendar');
   else if(name==='calendar-subscribe')await newItem('subscription');
   else if(name==='calendar-connect')await newItem('calendar-connection');
   else if(name==='calendar-event'){
    const e=data.events.find(e=>e.id===node.dataset.eventId&&e.sourceId===node.dataset.sourceId);if(!e)return;
    if(!e.readOnly)open(e.type+'/'+e.id);
    else details.open(e,{...range(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
   }
   else if(name==='calendar-unlock')showDialog(`<form data-module-form data-calendar-unlock="${esc(node.dataset.id)}"><h2 id="dialog-title">${esc(tr('unlockHeading'))}</h2><p>${esc(tr('unlockHelp'))}</p><label class="field">${esc(tr('username'))}<input name="username" autocomplete="username"></label><label class="field">${esc(tr('password'))}<input name="password" type="password" autocomplete="current-password"></label><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">${esc(tr('cancel'))}</button><button class="button primary" type="submit">${esc(tr('unlock'))}</button></div><p data-calendar-unlock-error role="alert"></p></form>`);
  },
  async submit(form,values){
   if(!form.dataset.calendarUnlock){await editor.submit(form,values);loadedKey='';sourceCursor=null;return;}
   try{await api('/api/calendars/unlock',{id:form.dataset.calendarUnlock,username:values.get('username'),password:values.get('password')});form.closest('dialog').close();await load();}
   catch(e){form.querySelector('[data-calendar-unlock-error]').textContent=e.message;}
  },
  deactivate(){details.stop();controller?.abort();clearTimeout(searchTimer);request++;loading=false;loadingKey='';editor.deactivate();},
  dispose(){details.stop();controller?.abort();clearTimeout(searchTimer);disposed=true;request++;clearInterval(timer);data={sources:[],events:[]};editor.dispose();}
 };
}

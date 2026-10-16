import {t} from '../i18n/index.js';
const tr=key=>t('calendarDetails',key);
// Read-only notes are fetched for the opened event, not with the month grid.
export function calendarDetails({state,api,esc,showDialog}){
 let session=null;
 const identity=()=>JSON.stringify([state.storage?.contextId,state.book?.id,state.moduleId,state.modulePath]);
 function stop(){if(session){session.controller?.abort();session.dialog.removeEventListener('close',stop);}session=null;}
 const valid=s=>session===s&&s.identity===identity()&&s.dialog.open&&s.root.isConnected&&!state.access?.locked;
 function paint(s){
  if(!valid(s))return;const e=s.event;
  s.root.innerHTML=`<h2 id="dialog-title">${esc(e.title)}</h2><p>${esc(e.startsAt)} – ${esc(e.endsAt)}</p><p>${esc(e.location??'')}</p>${s.busy?`<p role="status">${esc(tr('loading'))}</p>`:s.error?`<p role="alert">${esc(s.error.message)}</p><button type="button" class="button" data-calendar-details-retry>${esc(tr('retry'))}</button>`:`<p class="calendar-notes">${esc(e.notes??'')}</p>`}<p>${esc(tr('readOnly'))}</p><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">${esc(tr('close'))}</button></div>`;
  s.root.querySelector('[data-calendar-details-retry]')?.addEventListener('click',()=>void load(s));
 }
 async function load(s){
  if(!valid(s))return;s.controller?.abort();s.controller=new AbortController();s.busy=true;s.error=null;paint(s);
  try{
   const {event}=await api('/api/calendars/event',{sourceId:s.event.sourceId,eventId:s.event.id,range:s.range},{signal:s.controller.signal});
   if(!valid(s))return;if(!event||event.id!==s.event.id||event.sourceId!==s.event.sourceId||!event.readOnly||typeof event.title!=='string'||typeof event.startsAt!=='string'||typeof event.endsAt!=='string'||event.notes!==undefined&&typeof event.notes!=='string')throw Error(tr('invalid'));
   s.event=event;
  }catch(error){if(valid(s)&&error.name!=='AbortError')s.error=error;}
  finally{if(valid(s)){s.busy=false;paint(s);}}
 }
 function open(event,range){
  stop();showDialog('<div data-calendar-details></div>');const root=document.querySelector('[data-calendar-details]'),dialog=root.closest('dialog');
  session={identity:identity(),event,range,root,dialog};dialog.addEventListener('close',stop);void load(session);
 }
 return {open,stop};
}

import {m} from './editor-presentation.js';
import {localDate,nextDate} from './calendar-model.js';
const zone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone;
export const calendarTypes=[
 {id:'calendar',get label(){return m('calendars')},get singular(){return m('calendarType')},get empty(){return m('calendarEmpty')}},
 {id:'event',get label(){return m('events')},get singular(){return m('eventType')},get empty(){return m('eventEmpty')}},
 {id:'subscription',get label(){return m('subscriptions')},get singular(){return m('subscriptionType')},get empty(){return m('subscriptionEmpty')}},
 {id:'calendar-connection',get label(){return m('connectedWorkspaces')},get singular(){return m('workspaceConnectionType')},get empty(){return m('connectionEmpty')}}
];
export function calendarBlank(type,c){
 if(type==='calendar')return {name:'',projectId:c.creationScopeId,color:'#3958ba',archived:false};
 if(type==='event')return {title:'',calendarId:'',startsAt:localDate(new Date()),endsAt:nextDate(localDate(new Date())),allDay:true,timeZone:zone(),location:'',notes:'',status:'confirmed'};
 if(type==='subscription')return {name:'',projectId:c.creationScopeId,color:'#976235',url:'',enabled:true};
 if(type==='calendar-connection')return {name:'',projectId:c.creationScopeId,color:'#38786c',path:'',enabled:true};
}
const localTime=v=>{const d=new Date(v);return localDate(d)+'T'+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');};
export function calendarForm(d,c){
 const {input,select,check,field,esc}=c,v=d.data;
 if(d.type==='event')return `<section class="module-block"><h2>${esc(m('eventDetails'))}</h2>${input('title',m('eventTitle'),'text','required maxlength="240"')}${c.itemField('calendarId',m('calendar'))}${check('allDay',m('allDay'))}<div class="form-grid">${['startsAt','endsAt'].map(key=>field(esc(key==='startsAt'?m('starts'):v.allDay?m('exclusiveEnd'):m('ends')),`<input type="${v.allDay?'date':'datetime-local'}" data-event-time="${key}" value="${esc(v.allDay?v[key]:localTime(v[key]))}" required>`)).join('')}${input('location',m('placeLink'))}${select('status',m('status'),[['confirmed',m('statusConfirmed')],['cancelled',m('statusCancelled')]])}</div><p class="muted">${esc(v.allDay?m('endDateHelp'):m('timeZone',{zone:zone()}))}</p>${field(esc(m('eventNotes')),`<textarea rows="4" data-module-field="notes">${esc(v.notes)}</textarea>`)}</section>`;
 return `<section class="module-block"><h2>${esc(calendarTypes.find(t=>t.id===d.type).label)}</h2>${input('name',m('name'),'text','required maxlength="160"')}${c.ownerField()}${input('color',m('calendarColour'),'color')}${d.type==='calendar'?check('archived',m('archiveCalendar')):d.type==='subscription'?`${input('url',m('calendarUrl'),'url','required placeholder="https://..."')}<p class="muted">${esc(m('subscriptionHelp'))}</p>${check('enabled',m('includeSubscription'))}`:`${input('path',m('workspaceFolder'),'text','required')}<p class="muted">${esc(m('calendarConnectionHelp'))}</p>${check('enabled',m('includeWorkspace'))}`}</section>`;
}
export function calendarInput(el,c){
 const v=c.current?.data;if(!v||c.current.type!=='event')return false;
 if(el.dataset.moduleField==='allDay'){
  if(v.allDay){v.startsAt=localDate(v.startsAt);v.endsAt=nextDate(v.startsAt);}
  else {v.startsAt=new Date(v.startsAt+'T09:00').toISOString();v.endsAt=new Date(Date.parse(v.startsAt)+3600000).toISOString();}
  c.draw();return true;
 }
 if(el.dataset.eventTime){const raw=el.value,key=el.dataset.eventTime;
  if(v.allDay)v[key]=raw;else{const d=new Date(raw);el.setCustomValidity(raw&&(!Number.isFinite(d.getTime())||localTime(d)!==raw)?m('validLocalTime'):'');if(Number.isFinite(d.getTime()))v[key]=d.toISOString();}
  v.timeZone=zone();return true;
 }
 return false;
}

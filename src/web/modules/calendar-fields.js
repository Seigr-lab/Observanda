import {localDate,nextDate} from './calendar-model.js';
const zone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone;
export const calendarTypes=[
 {id:'calendar',label:'Calendars',singular:'calendar',empty:'Create calendars for a location, team or shared work.'},
 {id:'event',label:'Events',singular:'event',empty:'Schedule work in one of your calendars.'},
 {id:'subscription',label:'Subscriptions',singular:'subscription',empty:'Add a read-only HTTPS iCalendar subscription from another calendar service.'},
 {id:'calendar-connection',label:'Connected workspaces',singular:'workspace connection',empty:'Combine calendars from another Observanda workspace that you can unlock.'}
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
 if(d.type==='event')return `<section class="module-block"><h2>Event details</h2>${input('title','Event title','text','required maxlength="240"')}${c.itemField('calendarId','Calendar')}${check('allDay','All day')}<div class="form-grid">${['startsAt','endsAt'].map(key=>field(key==='startsAt'?'Starts':v.allDay?'Ends (exclusive date)':'Ends',`<input type="${v.allDay?'date':'datetime-local'}" data-event-time="${key}" value="${esc(v.allDay?v[key]:localTime(v[key]))}" required>`)).join('')}${input('location','Place or meeting link')}${select('status','Status',[['confirmed','Confirmed'],['cancelled','Cancelled']])}</div><p class="muted">${v.allDay?'The end date is the first day after the event.':'Times shown in '+esc(zone())+'.'}</p>${field('Event notes',`<textarea rows="4" data-module-field="notes">${esc(v.notes)}</textarea>`)}</section>`;
 return `<section class="module-block"><h2>${esc(calendarTypes.find(t=>t.id===d.type).label)}</h2>${input('name','Name','text','required maxlength="160"')}${c.ownerField()}${input('color','Calendar colour','color')}${d.type==='calendar'?check('archived','Archive calendar'):d.type==='subscription'?`${input('url','Calendar subscription URL','url','required placeholder="https://..."')}<p class="muted">Read-only iCalendar (ICS). Refreshes while the calendar is open; private subscription URLs stay in this workspace.</p>${check('enabled','Include this subscription')}`:`${input('path','Workspace folder','text','required')}<p class="muted">Save this connection, then unlock it from the calendar overview. Credentials are never saved here.</p>${check('enabled','Include this workspace')}`}</section>`;
}
export function calendarInput(el,c){
 const v=c.current?.data;if(!v||c.current.type!=='event')return false;
 if(el.dataset.moduleField==='allDay'){
  if(v.allDay){v.startsAt=localDate(v.startsAt);v.endsAt=nextDate(v.startsAt);}
  else {v.startsAt=new Date(v.startsAt+'T09:00').toISOString();v.endsAt=new Date(Date.parse(v.startsAt)+3600000).toISOString();}
  c.draw();return true;
 }
 if(el.dataset.eventTime){const raw=el.value,key=el.dataset.eventTime;
  if(v.allDay)v[key]=raw;else{const d=new Date(raw);el.setCustomValidity(raw&&(!Number.isFinite(d.getTime())||localTime(d)!==raw)?'Choose a valid local time.':'');if(Number.isFinite(d.getTime()))v[key]=d.toISOString();}
  v.timeZone=zone();return true;
 }
 return false;
}

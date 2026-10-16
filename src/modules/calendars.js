import {exact,text,date,instant,uuid,requireValue,saved} from './validation.js';
import {checkOwner} from './ownership.js';
const color=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
const owner=v=>v===null||uuid(v);
export function validateCalendar(d){
 requireValue(exact(d,['name','projectId','color','archived'])&&text(d.name,160,true)&&owner(d.projectId)&&color(d.color)&&typeof d.archived==='boolean','Calendar details');
}
export function validateEvent(d){
 requireValue(exact(d,['title','calendarId','startsAt','endsAt','allDay','timeZone','location','notes','status'])&&text(d.title,240,true)&&uuid(d.calendarId)&&typeof d.allDay==='boolean'&&(d.allDay?date(d.startsAt)&&date(d.endsAt):instant(d.startsAt)&&instant(d.endsAt))&&d.startsAt<d.endsAt&&text(d.location,500)&&text(d.notes,100000)&&['confirmed','cancelled'].includes(d.status),'Event details');
 try{new Intl.DateTimeFormat('en',{timeZone:d.timeZone});requireValue(text(d.timeZone,80,true),'Time zone');}catch{requireValue(false,'Time zone');}
}
export function validateSubscription(d){
 requireValue(exact(d,['name','projectId','color','url','enabled'])&&text(d.name,160,true)&&owner(d.projectId)&&color(d.color)&&typeof d.enabled==='boolean'&&text(d.url,4096,true),'Subscription details');
 let url;try{url=new URL(d.url);}catch{requireValue(false,'Enter an HTTPS calendar subscription URL');}
 requireValue(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&(!url.port||url.port==='443'),'Use an HTTPS calendar subscription URL');
}
export function validateConnection(d){
 requireValue(exact(d,['name','projectId','color','path','enabled'])&&text(d.name,160,true)&&owner(d.projectId)&&color(d.color)&&typeof d.enabled==='boolean'&&text(d.path,4096,true),'Connected workspace details');
}
import {calendarConstraintTypes,validateCalendarSource} from './calendar-constraints.js';
const types={calendar:validateCalendar,event:validateEvent,subscription:validateSubscription,'calendar-connection':validateConnection};
export const calendarDefinitions={types,constraintTypes:calendarConstraintTypes,validateSource:validateCalendarSource,validate:[entities=>{
 requireValue(entities.filter(e=>['subscription','calendar-connection'].includes(e.type)&&e.data.enabled).length<=30,'Up to 30 connected calendar sources can be enabled at once');
 for(const e of entities.filter(e=>e.type==='event'))requireValue(entities.some(c=>c.type==='calendar'&&c.id===e.data.calendarId),'Event calendar','MODULE_REFERENCE');
}],commands:Object.fromEntries(Object.entries(types).map(([type,validate])=>[type+'.save',(tx,p)=>{
 const old=saved(tx,p,type);validate(p.data);
 if(type==='event'){const c=tx.get(p.data.calendarId);requireValue(c?.type==='calendar'&&(!c.data.archived||old?.data.calendarId===c.id),'Choose an active calendar','MODULE_REFERENCE');}
 else checkOwner(tx,p.data);
 tx.put(type,p.id,p.data);
}]))};

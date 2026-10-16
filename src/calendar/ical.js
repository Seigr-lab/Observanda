import {wallInstant} from './window.js';
import ICAL from 'ical.js';
import {AppError} from '../errors.js';
// Feed parsing happens in a bounded worker. No shared timezone registry between feeds.
function instant(t,component,key,timeZone){
 if(t.isDate)return t.toString();
 if(t.zone.tzid!=='floating')return t.toJSDate().toISOString();
 const tz=component.getFirstProperty(key)?.getParameter('tzid')||timeZone;
 return wallInstant(t,tz);
}
export function parseCalendar(text,{from,to,timeZone='UTC'}){
 try{
 const boundary=value=>{const [year,month,day]=value.split('-').map(Number);return wallInstant({year,month,day,hour:0,minute:0,second:0},timeZone);};
 const fromInstant=boundary(from),toInstant=boundary(to);
 const component=new ICAL.Component(ICAL.parse(text));
 if(component.name!=='vcalendar')throw new Error('calendar');
 const components=component.getAllSubcomponents('vevent');
 if(components.length>5000)throw new AppError('CALENDAR_LIMIT');
 const masters=components.filter(c=>!c.hasProperty('recurrence-id')),cancelled=new Set(masters.filter(c=>c.getFirstPropertyValue('status')==='CANCELLED').map(c=>c.getFirstPropertyValue('uid'))),events=[],seen=new Set();let steps=0;
 for(const c of masters){
  if(c.getFirstPropertyValue('status')==='CANCELLED')continue;
  const event=new ICAL.Event(c),uid=event.uid;
  if(!uid||seen.has(uid))continue;seen.add(uid);
  for(const exception of components.filter(x=>x.getFirstPropertyValue('uid')===uid&&x.hasProperty('recurrence-id')))event.relateException(new ICAL.Event(exception));
  const iterator=event.iterator();let occurrence;
  while((occurrence=iterator.next())){
   if(++steps>30000)throw new AppError('CALENDAR_LIMIT');
   const info=event.getOccurrenceDetails(occurrence),item=info.item,startsAt=instant(info.startDate,item.component,'dtstart',timeZone),endsAt=instant(info.endDate,item.component,'dtend',timeZone);
   // A moved exception can land beyond the range; use the nominal occurrence to end expansion.
   const nominal=instant(occurrence,c,'dtstart',timeZone);
   if(startsAt<(info.startDate.isDate?to:toInstant)&&(endsAt>(info.startDate.isDate?from:fromInstant)||startsAt===endsAt&&startsAt>=(info.startDate.isDate?from:fromInstant))&&item.component.getFirstPropertyValue('status')!=='CANCELLED')events.push({id:uid+':'+occurrence.toString(),title:item.summary||'Untitled event',startsAt,endsAt,allDay:info.startDate.isDate,location:item.location||'',notes:item.description||'',type:'external'});
   if(events.length>5000)throw new AppError('CALENDAR_LIMIT');
   if(!event.isRecurring()||nominal>=(occurrence.isDate?to:toInstant))break;
  }
 }
 // Detached exceptions are retained even when their original occurrence is beyond this window.
 for(const c of components.filter(c=>c.hasProperty('recurrence-id')&&!cancelled.has(c.getFirstPropertyValue('uid')))){
  const e=new ICAL.Event(c),startsAt=instant(e.startDate,c,'dtstart',timeZone),endsAt=instant(e.endDate,c,'dtend',timeZone),id=e.uid+':'+e.recurrenceId.toString();
  if(c.getFirstPropertyValue('status')!=='CANCELLED'&&startsAt<(e.startDate.isDate?to:toInstant)&&endsAt>(e.startDate.isDate?from:fromInstant)&&!events.some(e=>e.id===id))events.push({id,title:e.summary||'Untitled event',startsAt,endsAt,allDay:e.startDate.isDate,location:e.location||'',notes:e.description||'',type:'external'});
 }
 return events;
 }catch(e){throw e instanceof AppError?e:new AppError('CALENDAR_FORMAT');}
}

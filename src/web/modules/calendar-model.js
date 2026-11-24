import {ownerOf} from './scope.js';
import messages from '../locales/en/calendar.json' with {type:'json'};
export const nextDate=value=>new Date(Date.parse(value+'T12:00:00Z')+86400000).toISOString().slice(0,10);
export const localDate=value=>{const d=new Date(value);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
// The same projection accepts validated originals or their dedicated schedule
// facts. It never mutates them or treats a schedule as an editable original.
export function calendarEntity(book,e,index,source){
  const d=e.data,owner=ownerOf(e,index);
  if(e.type==='calendar'&&!d.archived)source(e.id,d.name,d.color,owner);
  if(e.type==='event'&&d.status!=='cancelled'){
   const calendar=index.get(d.calendarId);
   if(!calendar||calendar.data.archived)return null;
   return {...d,id:e.id,type:e.type,projectId:owner,sourceId:source(calendar.id,calendar.data.name,calendar.data.color,owner)};
  }
  if(e.type==='task'&&d.dueOn&&!['done','cancelled'].includes(d.status))return {id:e.id,type:e.type,title:d.title,projectId:owner,sourceId:source('tasks:'+(owner??'workspace'),messages.taskDeadlines,'#916730',owner),startsAt:d.dueOn,endsAt:nextDate(d.dueOn),allDay:true,location:'',notes:''};
  if(e.type==='booking'&&d.status==='confirmed')return {...d,id:e.id,type:e.type,projectId:owner,sourceId:source('bookings:'+(owner??'workspace'),messages.bookings,'#357968',owner),allDay:false,location:index.get(d.resourceId)?.data.name??''};
  return null;
}

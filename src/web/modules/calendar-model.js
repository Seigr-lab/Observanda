import {projectUsesTool} from '../project-tools.js';
import {ownerOf,ownerLabel,inScope} from './scope.js';
export const nextDate=value=>new Date(Date.parse(value+'T12:00:00Z')+86400000).toISOString().slice(0,10);
export const localDate=value=>{const d=new Date(value);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
export function overlaps(item,from,to){
 if(item.allDay)return item.startsAt<to&&item.endsAt>from;
 return Date.parse(item.startsAt)<new Date(to+'T00:00').getTime()&&(Date.parse(item.endsAt)>new Date(from+'T00:00').getTime()||item.startsAt===item.endsAt&&Date.parse(item.startsAt)>=new Date(from+'T00:00').getTime());
}
export function localCalendar(book,entities){
 const sources=new Map(),events=[],index=new Map(entities.map(e=>[e.id,e]));
 const source=(id,name,color,projectId)=>{if(!sources.has(id))sources.set(id,{id,name,color,projectId,owner:ownerLabel(book,projectId),readOnly:false});return id;};
 for(const e of entities){const event=calendarEntity(book,e,index,source);if(event)events.push(event);}
 return {sources:[...sources.values()],events};
}
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
  if(e.type==='task'&&d.dueOn&&!['done','cancelled'].includes(d.status))return {id:e.id,type:e.type,title:d.title,projectId:owner,sourceId:source('tasks:'+(owner??'workspace'),'Task deadlines','#916730',owner),startsAt:d.dueOn,endsAt:nextDate(d.dueOn),allDay:true,location:'',notes:''};
  if(e.type==='booking'&&d.status==='confirmed')return {...d,id:e.id,type:e.type,projectId:owner,sourceId:source('bookings:'+(owner??'workspace'),'Equipment bookings','#357968',owner),allDay:false,location:index.get(d.resourceId)?.data.name??''};
  return null;
}
export function visibleCalendar(book,data,{projectId=null,recursive=true,hidden=new Set(),from,to}={}){
 const sources=data.sources.filter(s=>projectUsesTool(book,s.projectId,'planning')&&inScope(book,s.projectId,projectId,recursive)),ids=new Set(sources.filter(s=>!hidden.has(s.id)).map(s=>s.id));
 return {sources,events:data.events.filter(e=>ids.has(e.sourceId)&&(!from||overlaps(e,from,to))).sort((a,b)=>a.startsAt.localeCompare(b.startsAt)||a.title.localeCompare(b.title))};
}

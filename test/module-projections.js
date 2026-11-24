import {projectUsesTool} from '../src/web/project-tools.js';
import {ownerOf,ownerLabel,ownerDescriptor,inScope} from '../src/web/modules/scope.js';
import {calendarEntity} from '../src/web/modules/calendar-model.js';
// Test conveniences composed of the product's calendar and scope projections.
function overlaps(item,from,to){
 if(item.allDay)return item.startsAt<to&&item.endsAt>from;
 return Date.parse(item.startsAt)<new Date(to+'T00:00').getTime()&&(Date.parse(item.endsAt)>new Date(from+'T00:00').getTime()||item.startsAt===item.endsAt&&Date.parse(item.startsAt)>=new Date(from+'T00:00').getTime());
}
export function localCalendar(book,entities){
 const sources=new Map(),events=[],index=new Map(entities.map(e=>[e.id,e]));
 const source=(id,name,color,projectId)=>{if(!sources.has(id))sources.set(id,{id,name,color,projectId,owner:ownerLabel(book,projectId),ownerDisplay:ownerDescriptor(book,projectId),readOnly:false});return id;};
 for(const e of entities){const event=calendarEntity(book,e,index,source);if(event)events.push(event);}
 return {sources:[...sources.values()],events};
}
export function visibleCalendar(book,data,{projectId=null,recursive=true,hidden=new Set(),from,to}={}){
 const sources=data.sources.filter(s=>projectUsesTool(book,s.projectId,'planning')&&inScope(book,s.projectId,projectId,recursive)),ids=new Set(sources.filter(s=>!hidden.has(s.id)).map(s=>s.id));
 return {sources,events:data.events.filter(e=>ids.has(e.sourceId)&&(!from||overlaps(e,from,to))).sort((a,b)=>a.startsAt.localeCompare(b.startsAt)||a.title.localeCompare(b.title))};
}
export function toolItems(book,entities,moduleId){
 const index=new Map(entities.map(e=>[e.id,e]));
 return entities.filter(e=>projectUsesTool(book,ownerOf(e,index),moduleId));
}

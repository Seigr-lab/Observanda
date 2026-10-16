import {compareKey} from '../query-order.js';
import {calendarDate,dateInRange,compareRecordDates} from '../record-date.js';
import {timelineSource,validTimelineSource} from './timeline-source.js';

export const timelineDefaults=()=>({projects:[],books:[],descendants:true,groupBy:'book',from:'',to:'',query:'',status:'',descending:false,density:'comfortable',color:'#3b57b8'});
const queryKeys=['projects','books','descendants','from','to','query','status','descending'];
export const timelineQuery=value=>Object.fromEntries(queryKeys.map(key=>[key,value[key]]));
export function validTimelineQuery(value){
 return value&&typeof value==='object'&&Object.keys(value).length===queryKeys.length&&queryKeys.every(key=>Object.hasOwn(value,key))
  &&['projects','books'].every(key=>Array.isArray(value[key])&&value[key].length<=500&&value[key].every(validTimelineSource)&&new Set(value[key]).size===value[key].length)
  &&typeof value.descendants==='boolean'&&typeof value.descending==='boolean'
  &&['from','to'].every(key=>value[key]===''||calendarDate(value[key]))&&(!value.from||!value.to||value.from<=value.to)
  &&typeof value.query==='string'&&value.query.length<=200&&typeof value.status==='string'&&value.status.length<=80;
}
export function timelineScope(book,value){
 const local=items=>items.map(value=>timelineSource(value,book.id)).filter(source=>source?.workspaceId===book.id).map(source=>source.id);
 const projects=new Set(local(value.projects)),books=new Set(local(value.books));
 if(value.descendants){let changed=true;while(changed){changed=false;for(const p of book.projects)if(projects.has(p.parentId)&&!projects.has(p.id)){projects.add(p.id);changed=true;}}}
 const selected=value.projects.length||value.books.length;
 return new Set(book.notebooks.filter(b=>!selected||books.has(b.id)||projects.has(b.projectId)).map(b=>b.id));
}
export const timelineMatch=value=>record=>dateInRange(record.occurredOn,value.from,value.to)&&(!value.status||record.status===value.status)&&(!value.query||[record.title,...record.tags].join(' ').toLowerCase().includes(value.query.toLowerCase()));
// Cursor boundaries and browser validation must not depend on the machine's locale.
export const timelineOrder=value=>(a,b)=>compareRecordDates(a,b,{descending:value.descending})||compareKey(a.id,b.id);

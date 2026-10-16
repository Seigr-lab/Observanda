import {AppError} from '../errors.js';
import {digest} from '../storage-format.js';
import {ModuleReader} from '../modules/reader.js';
import {uuid,date} from '../modules/validation.js';
import {summaryPage} from '../summary-page.js';
import {projectUsesTool} from '../web/project-tools.js';
import {inScope} from '../web/modules/scope.js';
import {nextDate} from '../web/modules/calendar-model.js';
import {calendarWindow} from './window.js';
import {calendarScopeVersion} from './service.js';
import {calendarSourcePage} from './source-page.js';
const order=(a,b)=>a.startsAt.localeCompare(b.startsAt)||a.title.localeCompare(b.title)||a.sourceId.localeCompare(b.sourceId)||a.id.localeCompare(b.id);
const point=({id,sourceId,startsAt,title})=>({id,sourceId,startsAt,title});
const changed=()=>{throw new AppError('CALENDAR_CURSOR');};
// Streaming reducers retain one agenda page or three events per visible day.
// Counts include every matching event, including those outside the visible page.
export async function calendarPage(workspace,service,{workspaceId,from,to,timeZone='UTC',mode='agenda',projectId=null,recursive=true,scopeIds=null,hidden=[],cursor=null,limit=50,key=null,refresh=false,search='',offset=0,sourceCursor=null,sourceSearch=''},{signal,reader=new ModuleReader(workspace),collect}={}){
 if(!uuid(workspaceId)||!date(from)||!date(to)||from>=to||Date.parse(to)-Date.parse(from)>93*86400000||!['agenda','month','discovery'].includes(mode)||!Number.isSafeInteger(limit)||limit<1||limit>50||projectId!==null&&!uuid(projectId)||typeof recursive!=='boolean'||typeof refresh!=='boolean'||!Array.isArray(hidden)||hidden.length>4096||hidden.some(id=>typeof id!=='string'||id.length>256)||scopeIds!==null&&(!Array.isArray(scopeIds)||scopeIds.length>10000||!scopeIds.every(id=>id===null||uuid(id)))||cursor!==null&&(typeof cursor!=='string'||cursor.length>8192)||key!==null&&(typeof key!=='string'||key.length>8192)||typeof search!=='string'||search.length>256||!Number.isSafeInteger(offset)||offset<0||mode!=='discovery'&&offset!==0)throw new AppError('INVALID');
 try{new Intl.DateTimeFormat('en',{timeZone});}catch{throw new AppError('INVALID');}
 const queryHash=digest(JSON.stringify({workspaceId,from,to,timeZone,mode,projectId,recursive,scopeIds,hidden,limit,key,search}));
 const {book,anchor,sourcePage}=await reader.context(workspaceId,async c=>{
  let anchor;try{anchor=cursor?c.decode(cursor):{kind:'calendar',workspaceId,queryHash,offset:0};}catch{changed();}
  if(anchor?.kind!=='calendar'||anchor.workspaceId!==workspaceId||anchor.queryHash!==queryHash||!Number.isSafeInteger(anchor.offset)||anchor.offset<0||anchor.offset>0&&(!anchor.after||!['id','sourceId','startsAt','title'].every(k=>typeof anchor.after[k]==='string')))changed();
  return {book:c.book,anchor,sourcePage:calendarSourcePage(c,{workspaceId,from,to,timeZone,projectId,recursive,scopeIds},{cursor:sourceCursor,search:sourceSearch})};
 });
 const hiddenIds=new Set(hidden),scope=scopeIds&&new Set(scopeIds),allowed=e=>projectUsesTool(book,e.projectId,'planning')&&inScope(book,e.projectId,projectId,recursive)&&(!scope||scope.has(e.projectId??null));
 const page=summaryPage({...anchor,limit,order,point}),days=[],found=[];let total=0;
 if(mode==='month')for(let day=from;day<to;day=nextDate(day))days.push({date:day,total:0,events:[],matches:calendarWindow({from:day,to:nextDate(day),timeZone})});
 const result=await service.data(workspace,{from,to,timeZone},{refresh,signal,serial:mode==='discovery',eventSources:true,emitSource:source=>{if(allowed(source))sourcePage.add(source);},emit:e=>{
  signal?.throwIfAborted();if(!allowed(e)||hiddenIds.has(e.sourceId)||key&&e.sourceId+':'+e.id!==key||search&&!e.title.toLowerCase().includes(search.toLowerCase()))return;total++;collect?.(e);
  if(mode==='discovery'){if(total>offset&&found.length<limit)found.push(e);return;}
  if(mode==='agenda')page.add(e);
  else for(const day of days)if(day.matches(e)){day.total++;if(day.events.length<3||order(e,day.events.at(-1))<0){day.events.push(e);day.events.sort(order);if(day.events.length>3)day.events.pop();}}
 }});
 if(calendarScopeVersion(book)!==result.scopeVersion||cursor&&anchor.version!==result.version)changed();
 const base={...anchor,version:result.version};
 return reader.context(workspaceId,async c=>{
  const common={workspaceId,...sourcePage.finish(result.version,c.encode),sourceErrors:result.sources.filter(s=>s.error&&allowed(s)),total,version:result.version};
  if(mode==='discovery')return {...common,events:found,offset};
  if(mode==='month')return {...common,days:days.map(({matches,...day})=>day),events:[...new Map(days.flatMap(day=>day.events).map(e=>[e.sourceId+':'+e.id,e])).values()]};
  let value;try{value=page.finish();}catch{changed();}const end=anchor.offset+value.records.length;
  return {...common,events:value.records,offset:anchor.offset,cursor:c.encode(base),nextCursor:end<total?c.encode({...base,offset:end,after:value.after}):null,previousCursor:anchor.offset?c.encode({...base,offset:Math.max(0,anchor.offset-limit),after:anchor.offset>limit?value.previousAfter:null}):null};
 });
}

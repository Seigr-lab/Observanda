import {t} from '../i18n/index.js';
const token=v=>v===null||typeof v==='string'&&v.length>0&&v.length<=8192;
export function verifiedCalendarPage(value,workspaceId,{mode='agenda',limit=50}={}){
 const fail=()=>{throw Error(t('calendar','invalidPage'));};
 if(value?.workspaceId!==workspaceId||!Array.isArray(value.sources)||!Array.isArray(value.events)||!Number.isSafeInteger(value.total)||value.total<0||typeof value.version!=='string')fail();
 if(!Array.isArray(value.sourceErrors)||value.sourceErrors.length>30||value.sourceErrors.some(s=>typeof s.id!=='string'||typeof s.name!=='string'||typeof s.error!=='string'))fail();
 const ids=new Set(value.sources.map(s=>s.id));if(ids.size!==value.sources.length||value.sources.some(s=>typeof s.id!=='string'||typeof s.name!=='string'))fail();
 const sources=value.sourcePage;
 if(!sources||value.sources.length>20||!Number.isSafeInteger(sources.total)||!Number.isSafeInteger(sources.offset)||sources.offset<0||sources.offset+value.sources.length>sources.total||sources.total>0&&!value.sources.length||![sources.cursor,sources.nextCursor,sources.previousCursor].every(token)||!sources.cursor||(sources.offset>0)!==(sources.previousCursor!==null)||(sources.offset+value.sources.length<sources.total)!==(sources.nextCursor!==null))fail();
 if(value.events.some(e=>e.source?.id!==e.sourceId||typeof e.source.name!=='string'||typeof e.source.owner!=='string'||typeof e.id!=='string'||typeof e.title!=='string'||typeof e.startsAt!=='string'||typeof e.endsAt!=='string'||typeof e.allDay!=='boolean')||new Set(value.events.map(e=>e.sourceId+':'+e.id)).size!==value.events.length)fail();
 if(mode==='month'){
  if(!Array.isArray(value.days)||value.days.length>93||value.events.length>value.days.length*3||new Set(value.days.map(d=>d.date)).size!==value.days.length||value.days.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||!Number.isSafeInteger(d.total)||!Array.isArray(d.events)||d.total<d.events.length||d.events.length>3||d.events.some(e=>!value.events.some(v=>v.id===e.id&&v.sourceId===e.sourceId))))fail();
 }else if(value.events.length>limit||!Number.isSafeInteger(value.offset)||value.offset<0||value.offset+value.events.length>value.total||value.total>0&&!value.events.length||![value.cursor,value.nextCursor,value.previousCursor].every(token)||!value.cursor||(value.offset>0)!==(value.previousCursor!==null)||(value.offset+value.events.length<value.total)!==(value.nextCursor!==null))fail();
 return value;
}

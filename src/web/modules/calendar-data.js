import {calendarCollectionQuery,calendarCollectionIdentity} from './calendar-collection.js';
import {dashboardCollection} from '../dashboard-collection-client.js';
import {dashboardScope,dashboardScopeSettings,dashboardBookSettings} from '../dashboard-scope.js';
import {localDate} from './calendar-model.js';
import {scopePath} from './scope.js';
import {verifiedCalendarPage} from './calendar-page.js';
import {t} from '../i18n/index.js';
const tr=(key,values)=>t('calendar',key,values);
const range=()=>{const start=new Date(),end=new Date(start);end.setDate(end.getDate()+31);return {from:localDate(start),to:localDate(end),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone};};
function checkSources(result){const failed=result.sourceErrors?.[0]??result.sources?.find(s=>s.error);if(failed)throw Error(tr('sourceFailed',{name:failed.name,error:failed.error}));return result;}
export function registerCombinedCalendar(registry){
 registry.register({id:'calendar-agenda',label:tr('combined'),group:tr('group'),icon:'records',metadataOnly:true,pageSize:25,scoped:true,defaultFields:['owner','calendar','startsAt','endsAt','location','status'],settings:(c,options={},panel)=>[...dashboardScopeSettings(c,options,panel),...(dashboardCollection(c)?dashboardBookSettings(c,options,panel):[])],
  loadKey:(c,options)=>JSON.stringify([c.book.id,c.etag,c.legacyConfig,options,c.recordLimit,c.recordKey,c.recordCursor,range()]),
  async load({api,context:c,options={},signal}){
   if(dashboardCollection(c))return checkSources(await calendarCollectionQuery(api,c,options,range(),{},signal));
   const limit=Math.min(25,c.recordLimit??7),result=await api('/api/calendars/page',{workspaceId:c.book.id,...range(),scopeIds:[...dashboardScope(c.book,options,c.legacyConfig)],limit,key:c.recordKey??null,cursor:c.recordCursor??null},{adopt:false,signal});
   return checkSources(verifiedCalendarPage(result,c.book.id,{limit}));
  },
  async discover({api,context,search,offset,limit,signal}){
   if(dashboardCollection(context)){const result=checkSources(await calendarCollectionQuery(api,context,{},range(),{mode:'discovery',search,offset,limit,key:null,cursor:null},signal));return {...result,items:result.events.map(e=>({key:e.collectionKey,title:e.title,subtitle:[e.owner.projectTitle,e.owner.notebookTitle,e.source.name].filter(Boolean).join(' / ')}))};}
   const result=await api('/api/calendars/page',{workspaceId:context.book.id,...range(),mode:'discovery',search,offset,limit},{adopt:false,signal});
   if(result?.workspaceId!==context.book.id||!Array.isArray(result.sources)||!Array.isArray(result.events)||result.events.length>limit||result.offset!==offset||!Number.isSafeInteger(result.total)||result.total<0||result.events.some(e=>typeof e.title!=='string'||typeof e.id!=='string'||typeof e.sourceId!=='string'))throw Error(tr('invalidPage'));
   checkSources(result);return {...result,items:result.events.map(e=>({key:e.sourceId+':'+e.id,title:e.title,subtitle:e.source.name}))};
  },
  items:(c,result)=>result.events.map(e=>{const source=e.source,legacy=c.recordKey&&calendarCollectionIdentity(c.recordKey,c.book.id)?.legacy;return {key:legacy?c.recordKey:e.collectionKey??e.sourceId+':'+e.id,title:e.title,data:{owner:e.owner?.projectId?[e.owner.projectTitle,e.owner.notebookTitle].filter(Boolean).join(' / '):source.owner,calendar:source.name,startsAt:e.allDay?e.startsAt:new Date(e.startsAt).toLocaleString(),endsAt:e.allDay?e.endsAt:new Date(e.endsAt).toLocaleString(),location:e.location??'',status:tr(e.readOnly?'readOnly':'scheduledPlans')},action:e.owner?{name:'module-open-owned',data:{workspaceId:e.owner.workspaceId,projectId:e.owner.projectId??'',labBookId:e.owner.labBookId??'',moduleId:'planning',modulePath:scopePath(e.projectId,e.readOnly?'agenda':e.type+'/'+e.id)}}:{name:'module-open',data:{moduleId:'planning',modulePath:scopePath(null,'agenda')}}};})
 });
}

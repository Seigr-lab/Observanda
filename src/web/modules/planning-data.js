import {dashboardCollection,moduleCollectionQuery,moduleCollectionDiscovery,validModuleCollectionItem} from './dashboard-collection.js';
import {dashboardScope,dashboardScopeSettings,dashboardBookSettings} from '../dashboard-scope.js';
import {proseReferences} from '../prose-model.js';
import {t} from '../i18n/index.js';
const tr=key=>t('planningData',key);
const token=value=>value===null||typeof value==='string'&&value.length>0&&value.length<=8192;
export function registerPlanningCards(registry){
 for(const {id,type,fields} of [
  {id:'tasks',type:'task',fields:['owner','status','priority','dueOn','assignees','checklist']},
  {id:'calendars',type:'calendar',fields:['owner','color']},
  {id:'calendar-events',type:'event',fields:['owner','startsAt','endsAt','location','status']},
  {id:'bookings',type:'booking',fields:['resource','startsAt','endsAt','status','notes']}
 ])registry.register({id,label:tr(type),group:tr('group'),icon:'records',scoped:true,metadataOnly:true,pageSize:25,defaultFields:fields,
  references:item=>[...(item.data.links??[]),...Object.values(item.data).flatMap(proseReferences).map(r=>({workspaceId:r.workspaceId,type:r.kind,id:r.id}))],
  fieldMetadata:Object.fromEntries(['owner','status','priority','dueOn','assignees','checklist','color','startsAt','endsAt','location','resource','notes'].map(key=>[key,{label:tr(key)}])),
  settings:(c,options={},panel)=>[...dashboardScopeSettings(c,options,panel),...(dashboardCollection(c)?dashboardBookSettings(c,options,panel):[]),{key:'search',label:tr('search'),type:'text'},{key:'status',label:tr('filterStatus'),type:'text'}],
  loadKey:(c,options)=>JSON.stringify([c.book.id,c.etag,c.legacyConfig,options,c.recordLimit,c.recordKey,c.recordCursor]),
  load:async({api,context:c,options={},signal})=>{
   const limit=Math.min(25,c.recordLimit??7),result=dashboardCollection(c)?await moduleCollectionQuery(api,c,'planning',type,options,{},signal):await api('/api/modules/planning/dashboard',{workspaceId:c.book.id,type,scopeIds:[...dashboardScope(c.book,options,c.legacyConfig)],query:options.search??'',status:options.status??'',limit,key:c.recordKey??null,cursor:c.recordCursor??null},{adopt:false,signal});
   if(result?.workspaceId!==c.book.id||!Array.isArray(result.items)||result.items.length>limit||result.items.some(e=>typeof e.key!=='string'||dashboardCollection(c)&&!validModuleCollectionItem(e)||typeof e.title!=='string'||!e.data)||!Number.isSafeInteger(result.offset)||result.offset<0||!Number.isSafeInteger(result.total)||result.total<result.offset+result.items.length||![result.cursor,result.nextCursor,result.previousCursor].every(token))throw Error(tr('invalid'));
   return result;
  },
  discover:({api,context,search,offset,limit,signal})=>dashboardCollection(context)?moduleCollectionDiscovery(api,context,'planning',type,{search,offset,limit,signal}):api('/api/modules/planning/discovery',{workspaceId:context.book.id,type,search,offset,limit},{adopt:false,signal}),
  items:(c,result)=>result.items.map(item=>type==='booking'?{...item,data:{...item.data,startsAt:new Date(item.data.startsAt).toLocaleString(),endsAt:new Date(item.data.endsAt).toLocaleString()}}:item)
 });
}

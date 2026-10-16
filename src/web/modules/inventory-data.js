import {dashboardCollection,moduleCollectionQuery,moduleCollectionDiscovery,moduleResourceChoices,validModuleCollectionItem} from './dashboard-collection.js';
import {dashboardScope,dashboardScopeSettings,dashboardBookSettings} from '../dashboard-scope.js';
import {proseReferences} from '../prose-model.js';
import {researchId} from '../research-reference.js';
import {t} from '../i18n/index.js';
const tr=key=>t('inventoryData',key),token=value=>value===null||typeof value==='string'&&value.length>0&&value.length<=8192;
function verified(result,workspaceId,limit){
 if(result?.workspaceId!==workspaceId||!Array.isArray(result.items)||result.items.length>limit||result.items.some(e=>!(result.collection?validModuleCollectionItem(e):researchId(e.key))||typeof e.title!=='string'||!e.data)||new Set(result.items.map(i=>i.key)).size!==result.items.length||!Number.isSafeInteger(result.offset)||result.offset<0||!Number.isSafeInteger(result.total)||result.total<result.offset+result.items.length||result.total>0&&!result.items.length||![result.cursor,result.nextCursor,result.previousCursor].every(token)||!result.cursor||(result.offset>0)!==(result.previousCursor!==null)||(result.offset+result.items.length<result.total)!==(result.nextCursor!==null))throw Error(tr('invalid'));
 return result;
}
export function inventoryPageProvider(type){return {
 metadataOnly:true,pageSize:25,
 references:item=>[...(item.data.links??[]),...Object.values(item.data).flatMap(proseReferences).map(r=>({workspaceId:r.workspaceId,type:r.kind,id:r.id}))],
 loadKey:(c,options)=>JSON.stringify([c.book.id,c.etag,c.legacyConfig,options,c.recordLimit,c.recordKey,c.recordCursor]),
 load:async({api,context:c,options={},signal})=>{
  const limit=Math.min(25,c.recordLimit??7);
  const result=dashboardCollection(c)?await moduleCollectionQuery(api,c,'inventory',type,options,{},signal):await api('/api/modules/inventory/dashboard',{workspaceId:c.book.id,type,...(type==='category'?{}:{scopeIds:[...dashboardScope(c.book,options,c.legacyConfig)]}),query:options.search??'',status:options.status??'',...(type==='resource'?{kind:options.kind||null,keys:options.resourceMode==='selected'?options.resourceIds??[]:null}:{}),limit,key:c.recordKey??null,cursor:c.recordCursor??null},{adopt:false,signal});
  return verified(result,c.book.id,limit);
 },
 discover:({api,context,search,offset,limit,signal})=>dashboardCollection(context)?moduleCollectionDiscovery(api,context,'inventory',type,{search,offset,limit,signal}):api('/api/modules/inventory/discovery',{workspaceId:context.book.id,type,search,offset,limit},{adopt:false,signal}),
 items:(c,result)=>result.items
};}
export function registerInventoryCards(registry){
 for(const [id,type,fields] of [
  ['bills-of-materials','bom',['recordTitle','designRevision','buildCount','status']],
  ['resource-categories','category',['description','fields']],
  ['stock-movements','movement',['delta','unit','reason','updatedAt']],
  ['stock-reservations','reservation',['quantity','unit','reason','status']],
  ['stock-transfers','stock-transfer',['quantity','unit','reason','updatedAt']]
 ])registry.register({id,label:tr(type),group:tr('group'),icon:'projects',scoped:type!=='category',defaultFields:fields,
  ...inventoryPageProvider(type),settings:(c,options={},panel)=>[...(type==='category'&&!dashboardCollection(c)?[]:dashboardScopeSettings(c,options,panel)),...(dashboardCollection(c)?dashboardBookSettings(c,options,panel):[]),{key:'search',label:tr('search'),type:'text'},{key:'status',label:tr('status'),type:'text'}]
 });
}
export const inventoryItemChoices={
 key:'resourceIds',type:'lookup',multiple:true,default:[],get label(){return tr('selectedItems');},get searchLabel(){return tr('searchItems');},
 async loadChoices({api,context,panel,search,cursor,signal}){
  if(dashboardCollection(context)){const value=await moduleResourceChoices({api,context,panel,search,cursor,signal});value.selected=value.selected.map(item=>({...item,label:item.label??tr('unavailable')}));return value;}
  const ids=panel.options.resourceIds??[],result=await api('/api/modules/items',{workspaceId:context.book.id,type:'resource',query:search,cursor,limit:25},{adopt:false,signal}),selected=[];
  if(!Array.isArray(result.items)||result.items.length>25||result.workspaceId!==context.book.id||![result.cursor,result.nextCursor,result.previousCursor].every(token)||!result.cursor||!result.items.every(i=>researchId(i.id)&&i.type==='resource'&&typeof i.title==='string')||new Set(result.items.map(i=>i.id)).size!==result.items.length||!Number.isSafeInteger(result.offset)||result.offset<0||!Number.isSafeInteger(result.total)||result.total<result.offset+result.items.length||result.total>0&&!result.items.length||(result.offset>0)!==(result.previousCursor!==null)||(result.offset+result.items.length<result.total)!==(result.nextCursor!==null))throw Error(tr('invalid'));
  for(let i=0;i<ids.length;i+=25){
   const chunk=ids.slice(i,i+25),labels=await api('/api/modules/labels',{workspaceId:context.book.id,ids:chunk},{adopt:false,signal});
   if(labels.workspaceId!==context.book.id||!Array.isArray(labels.items)||!Array.isArray(labels.missing)||labels.items.some(v=>v.type!=='resource'||!chunk.includes(v.id)||typeof v.title!=='string')||labels.missing.some(id=>!chunk.includes(id))||labels.items.length+labels.missing.length!==chunk.length||new Set([...labels.items.map(i=>i.id),...labels.missing]).size!==chunk.length)throw Error(tr('invalid'));
   selected.push(...labels.items.map(i=>({value:i.id,label:i.title})),...labels.missing.map(id=>({value:id,label:tr('unavailable')})));
  }
  return {...result,items:result.items.map(i=>({value:i.id,label:i.title})),selected};
 }
};

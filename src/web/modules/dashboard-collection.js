import '../i18n/catalogues/inventoryData.js';
import {t} from '../i18n/index.js';
import {dashboardCollection,dashboardCollectionRoute,validDashboardOwner} from '../dashboard-collection-client.js';
import {defaultPanelConfig} from '../dashboard-model.js';
import {dashboardSourceIdentity,dashboardSourceKey} from '../dashboard-source-key.js';
export {dashboardCollection};
export function moduleCollectionQuery(api,context,area,type,options={},values={},signal){
 return api(dashboardCollectionRoute(context,'modules'),{workspaceId:context.book.id,area,type,config:context.legacyConfig??defaultPanelConfig(),options,mode:'page',key:context.recordKey??null,cursor:context.recordCursor??null,limit:Math.min(25,context.recordLimit??7),offset:0,keys:null,...values},{adopt:false,signal});
}
export function validModuleCollectionItem(item){const source=dashboardSourceIdentity(item?.key);return Boolean(source?.workspaceId&&source.key&&!source.key.includes(':')&&validDashboardOwner(item,item.key));}
export function moduleCollectionDiscovery(api,context,area,type,{search,offset,limit,signal}){
 return moduleCollectionQuery(api,context,area,type,{search},{mode:'discovery',offset,limit,key:null,cursor:null},signal);
}
export function moduleCollectionIdentity(key,workspaceId){const source=dashboardSourceIdentity(key);return source&&dashboardSourceKey(source.workspaceId??workspaceId,source.key);}
export async function moduleResourceChoices({api,context,panel,search,cursor,signal}){
 const options={...panel.options,resourceMode:'all',search,status:''},result=await moduleCollectionQuery(api,context,'inventory','resource',options,{mode:'choices',limit:25,key:null,cursor},signal),selected=[];
 if(result.workspaceId!==context.book.id||!Array.isArray(result.items)||result.items.length>25||!result.items.every(validModuleCollectionItem)||new Set(result.items.map(i=>i.key)).size!==result.items.length||!Number.isSafeInteger(result.offset)||result.offset<0||!Number.isSafeInteger(result.total)||result.total<result.offset+result.items.length||!result.cursor||(result.offset>0)!==(result.previousCursor!==null)||(result.offset+result.items.length<result.total)!==(result.nextCursor!==null))throw Error(t('inventoryData','invalid'));
 const ids=panel.options.resourceIds??[],retained=new Map(ids.map(key=>[moduleCollectionIdentity(key,context.book.id),key]));
 for(let i=0;i<ids.length;i+=25){
  const chunk=ids.slice(i,i+25),labels=await moduleCollectionQuery(api,context,'inventory','resource',{...options,search:''},{mode:'labels',limit:25,key:null,cursor:null,keys:chunk},signal),wanted=new Map(chunk.map(key=>[moduleCollectionIdentity(key,context.book.id),key]));
  if(labels.workspaceId!==context.book.id||!Array.isArray(labels.items)||!Array.isArray(labels.missing)||labels.items.some(item=>!validModuleCollectionItem(item)||!wanted.has(item.key))||labels.missing.some(key=>!chunk.includes(key))||new Set([...labels.items.map(item=>item.key),...labels.missing.map(key=>moduleCollectionIdentity(key,context.book.id))]).size!==chunk.length)throw Error(t('inventoryData','invalid'));
  selected.push(...labels.items.map(item=>({value:wanted.get(item.key),label:item.title})),...labels.missing.map(key=>({value:key,label:null})));
 }
 return {...result,items:result.items.map(item=>({value:retained.get(item.key)??item.key,label:[item.title,item.owner.projectTitle,item.owner.notebookTitle].filter(Boolean).join(' / ')})),selected};
}

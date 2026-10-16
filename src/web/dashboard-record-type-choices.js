import {dashboardCollection,dashboardCollectionRoute} from './dashboard-collection-client.js';
import {defaultPanelConfig} from './dashboard-model.js';
import {validViewFilter} from './record-view-model.js';
import {t} from './i18n/index.js';
const validChoice=value=>value&&validViewFilter(value.value)&&value.value!=='all'&&typeof value.label==='string'&&value.label.length<=160;
export const dashboardRecordTypeChoices={
 key:'recordType',type:'lookup',
 get searchLabel(){return t('dashboardChoices','searchRecordTypes');},
 get label(){return t('dashboardChoices','recordType');},
 get defaultChoice(){return {value:'all',label:t('dashboardChoices','allTypes')};},
 async loadChoices({api,context,panel,search,cursor,signal}){
  const limit=25,result=await api(dashboardCollection(context)?dashboardCollectionRoute(context,'types'):'/api/workspace/read/dashboard-types',{workspaceId:context.book.id,etag:context.etag,config:{...defaultPanelConfig(),...panel.config},options:panel.options,search,cursor,limit},{adopt:false,signal});
  if(result.workspaceId!==context.book.id||result.etag!==context.etag||!Array.isArray(result.items)||result.items.length>limit||!result.items.every(validChoice)||
   new Set(result.items.map(item=>item.value)).size!==result.items.length||!Number.isSafeInteger(result.total)||result.total<0||!Number.isSafeInteger(result.offset)||result.offset<0||result.offset+result.items.length>result.total||result.total>0&&!result.items.length||
   ![result.nextCursor,result.previousCursor].every(value=>value===null||typeof value==='string'&&value.length>0&&value.length<=4096)||
   (result.offset>0)!==(result.previousCursor!==null)||(result.offset+result.items.length<result.total)!==(result.nextCursor!==null)||
   result.selected!==null&&(!validChoice(result.selected)||result.selected.value!==(panel.options.recordType??panel.config.recordType)))throw Error(t('dashboardChoices','invalidPage'));
  return result;
 }
};

import {dashboardCollectionRoute} from './dashboard-collection-client.js';
import {defaultPanelConfig} from './dashboard-model.js';
import {researchId} from './research-reference.js';
import {t} from './i18n/index.js';
const validChoice=value=>value&&researchId(value.value)&&typeof value.label==='string'&&value.label.length<=4096;
export function dashboardScopeChoices(kind,{label,searchLabel,selected}){
 return {key:kind==='projects'?'projectIds':'notebookIds',type:'lookup',multiple:true,default:selected,label,searchLabel,
  async loadChoices({api,context,panel,search,cursor,signal}){
   const limit=25,result=await api(dashboardCollectionRoute(context,'choices'),{workspaceId:context.book.id,etag:context.etag,config:{...defaultPanelConfig(),...panel.config},options:panel.options,kind,search,cursor,limit},{adopt:false,signal});
   if(result.workspaceId!==context.book.id||result.etag!==context.etag||!Array.isArray(result.items)||result.items.length>limit||!result.items.every(validChoice)||new Set(result.items.map(item=>item.value)).size!==result.items.length||!Array.isArray(result.selected)||!result.selected.every(validChoice)||!Number.isSafeInteger(result.total)||!Number.isSafeInteger(result.offset)||result.offset<0||result.offset+result.items.length>result.total||result.total>0&&!result.items.length||![result.nextCursor,result.previousCursor].every(value=>value===null||typeof value==='string'&&value.length>0&&value.length<=4096)||(result.offset>0)!==(result.previousCursor!==null)||(result.offset+result.items.length<result.total)!==(result.nextCursor!==null))throw Error(t('dashboardChoices','invalidPage'));
   return result;
  }
 };
}

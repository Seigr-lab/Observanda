import {dashboardCollection,dashboardCollectionRoute,dashboardRecordIdentity,validDashboardOwner} from './dashboard-collection-client.js';
import {defaultPanelConfig} from './dashboard-model.js';
import {t} from './i18n/index.js';
// Shared transport for record and nested-item cards. Providers retain ownership
// of fields/rendering; the dashboard owns only page navigation and card state.
export function dashboardRecordClient(provider,{records=false,structure=false}={}){
 return {pageSize:100,canDiscover:c=>!structure||dashboardCollection(c),
  discover:async({api,context:c,search,offset,limit,cursor=null,signal})=>{
   const collection=dashboardCollection(c),result=await api(collection?dashboardCollectionRoute(c,'discovery'):'/api/workspace/read/discovery',{workspaceId:c.book.id,etag:c.etag,provider,search,offset,limit,...(collection?{cursor}:{})},{adopt:false,signal});
   if(result.workspaceId!==c.book.id||result.etag!==c.etag||result.provider!==provider)throw Error(t('dashboardLibrary','invalidPage'));
   return result;
  },
  loadKey:(c,options)=>JSON.stringify([Boolean(c.outline),c.book.id,c.etag,c.legacyConfig,options,c.recordLimit,c.recordKey,c.recordCursor]),
  load:async({api,context:c,options={},signal})=>{
   if(!c.outline||structure&&!dashboardCollection(c))return null;
   const limit=c.recordLimit??7,result=await api(dashboardCollection(c)?dashboardCollectionRoute(c,structure?'structure':'records'):'/api/workspace/read/dashboard',{workspaceId:c.book.id,etag:c.etag,provider,config:{...defaultPanelConfig(),...c.legacyConfig},options,limit,key:c.recordKey??null,cursor:c.recordCursor??null},{adopt:false,signal});
   const rows=records?result.records:result.items,id=row=>records?dashboardRecordIdentity(row):row.key;
   if(result.workspaceId!==c.book.id||result.etag!==c.etag||dashboardCollection(c)&&result.collection!==true||!Array.isArray(rows)||rows.length>limit||
    !Number.isSafeInteger(result.total)||result.total<rows.length||!Number.isSafeInteger(result.offset)||result.offset<0||result.offset+rows.length>result.total||result.total>0&&!rows.length||
    ![result.cursor,result.nextCursor,result.previousCursor].every((value,index)=>index>0&&value===null||typeof value==='string'&&value.length>0&&value.length<=4096)||
    (result.offset>0)!==(result.previousCursor!==null)||(result.offset+rows.length<result.total)!==(result.nextCursor!==null)||new Set(rows.map(id)).size!==rows.length||result.collection&&rows.some(row=>typeof id(row)!=='string'||provider!=='workspace'&&!validDashboardOwner(row,id(row))))throw Error(t('dashboardPaging','invalidPage'));
   return result;
  }
 };
}

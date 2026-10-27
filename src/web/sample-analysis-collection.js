import './i18n/catalogues/sampleAnalysis.js';
import {t} from './i18n/index.js';
import {dashboardCollectionRoute,validDashboardOwner} from './dashboard-collection-client.js';
import {defaultPanelConfig} from './dashboard-model.js';
import {dashboardSourceIdentity,dashboardSourceKey} from './dashboard-source-key.js';
import {validSampleRow} from './sample-analysis-pages.js';
export async function sampleCollectionQuery(api,context,view,options={},values={},signal){
 const command={workspaceId:context.book.id,view,config:context.legacyConfig??defaultPanelConfig(),options,mode:'page',limit:Math.min(25,context.recordLimit??7),offset:0,cursor:context.recordCursor??null,key:context.recordKey??null,...values};
 const result=await api(dashboardCollectionRoute(context,'samples'),command,{adopt:false,signal}),fail=()=>{throw Error(t('sampleAnalysis','invalidPage'));},token=value=>value===null||typeof value==='string'&&value.length>0&&value.length<=4096;
 if(result?.workspaceId!==context.book.id||result.collection!==true||result.view!==view||!Array.isArray(result.items)||result.items.length>command.limit||!Number.isSafeInteger(result.total)||!Number.isSafeInteger(result.offset)||result.offset<0||result.total<result.offset+result.items.length||!result.counts||!['samples','analyses','review','archive','approved','events'].every(k=>Number.isSafeInteger(result.counts[k])&&result.counts[k]>=0))fail();
 if(result.items.some(row=>typeof row.collectionKey!=='string'||!validDashboardOwner(row,row.collectionKey)||row.collectionKey!==dashboardSourceKey(row.owner.workspaceId,row.id)||!validSampleRow(row,view,{summary:command.mode==='discovery'}))||new Set(result.items.map(row=>row.collectionKey)).size!==result.items.length)fail();
 if(command.mode==='page'&&view==='events'&&result.items.some(row=>!['sample','analysis'].includes(row.recordKind)))fail();
 if(command.key){const pinned=dashboardSourceIdentity(command.key);if(!pinned||result.items.some(row=>row.collectionKey!==dashboardSourceKey(pinned.workspaceId??context.book.id,pinned.key)))fail();}
 if(command.mode==='page'&&(![result.cursor,result.previousCursor,result.nextCursor].every(token)||!result.cursor||(result.offset>0)!==(result.previousCursor!==null)||(result.offset+result.items.length<result.total)!==(result.nextCursor!==null)))fail();
 if(command.mode==='discovery'&&result.offset!==command.offset)fail();return result;
}
export function sampleCollectionAction(item,view){return {name:'laboratory-open-owned',data:{workspaceId:item.owner.workspaceId,projectId:item.owner.projectId??'',labBookId:item.owner.labBookId??'',kind:view==='samples'?'sample':view==='events'?item.recordKind:'analysis',id:view==='events'?item.recordId:item.id}};}

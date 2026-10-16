import {researchId} from '../research-reference.js';
import {validRecordOwner} from '../record-collection-client.js';
import {dashboardCollectionRoute} from '../dashboard-collection-client.js';
import {defaultPanelConfig} from '../dashboard-model.js';
import {t} from '../i18n/index.js';
export function calendarCollectionIdentity(key,workspaceId){
 if(key===null)return {workspaceId:null,key:null};if(typeof key!=='string'||!key||key.length>512)return null;
 const prefix=key.slice(0,36);if(researchId(prefix)&&key[36]==='/')return /^[a-f0-9]{64}$/.test(key.slice(37))?{workspaceId:prefix,key:key.slice(37)}:null;
 return {workspaceId,key,legacy:true};
}
export async function calendarCollectionQuery(api,context,options,range,values={},signal){
 const command={workspaceId:context.book.id,config:context.legacyConfig??defaultPanelConfig(),options,...range,mode:'agenda',limit:Math.min(25,context.recordLimit??7),key:context.recordKey??null,cursor:context.recordCursor??null,offset:0,search:'',...values};
 const result=await api(dashboardCollectionRoute(context,'calendar'),command,{adopt:false,signal});
 const fail=()=>{throw Error(t('calendar','invalidPage'));},token=value=>value===null||typeof value==='string'&&value.length>0&&value.length<=4096;
 if(result?.workspaceId!==context.book.id||result.collection!==true||!Array.isArray(result.events)||result.events.length>command.limit||!Number.isSafeInteger(result.total)||!Number.isSafeInteger(result.offset)||result.offset<0||result.total<result.offset+result.events.length||!Array.isArray(result.sourceErrors)||result.sourceErrors.length>30||result.sourceErrors.some(s=>typeof s.name!=='string'||typeof s.error!=='string'))fail();
 if(result.events.some(e=>!validRecordOwner(e.owner)||calendarCollectionIdentity(e.collectionKey,context.book.id)?.workspaceId!==e.owner.workspaceId||typeof e.id!=='string'||typeof e.title!=='string'||typeof e.startsAt!=='string'||typeof e.endsAt!=='string'||typeof e.allDay!=='boolean'||e.source?.id!==e.sourceId||typeof e.source.name!=='string'||typeof e.source.owner!=='string')||new Set(result.events.map(e=>e.collectionKey)).size!==result.events.length)fail();
 if(command.key){const pinned=calendarCollectionIdentity(command.key,context.book.id);if(!pinned||result.events.some(e=>e.owner.workspaceId!==pinned.workspaceId||(pinned.legacy?e.sourceId+':'+e.id!==command.key:e.collectionKey!==command.key)))fail();}
 if(command.mode==='agenda'&&(![result.cursor,result.nextCursor,result.previousCursor].every(token)||!result.cursor||(result.offset>0)!==(result.previousCursor!==null)||(result.offset+result.events.length<result.total)!==(result.nextCursor!==null)))fail();
 if(command.mode==='discovery'&&result.offset!==command.offset)fail();return result;
}

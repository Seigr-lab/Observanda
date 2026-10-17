import {dashboardRecordIdentity,dashboardRecordAction,dashboardRecordData} from '../dashboard-collection-client.js';
import {recordDateLabel} from '../record-date.js';
import {dashboardScopeSettings,dashboardBookSettings,dashboardBooks} from '../dashboard-scope.js';

import {configurationOf} from '../notebook-schema.js';
import {locationName} from '../workspace-structure.js';
import {laboratoryModuleId} from './catalog.js';
import {dashboardRecordClient} from '../dashboard-record-client.js';
import {labDataNotebooks,labDataRecord} from './data-scope.js';
import {recordQueryMatcher} from '../record-query.js';
import {t} from '../i18n/index.js';
// Domain providers are projections of canonical lab books and records, never another store.
export function registerLabWorkspaceData(registry,{profile=null}={}){
 const prefix=profile?laboratoryModuleId(profile.id):'lab';
 const text=key=>t('labBookData',key);
 const notebooks=(c,options)=>labDataNotebooks(dashboardBooks(c.book,options,c.legacyConfig),profile);
 for(const records of [false,true])registry.register({
  id:prefix+(records?'-records':'-spaces'),label:(profile?profile.label+' / ':'')+text(records?'records':'books'),group:profile?.label??text('books'),icon:'laboratory',metadataOnly:true,defaultFields:records?['location','notebook','recordType','occurredOn']:['location','profiles'],
  ...dashboardRecordClient(prefix+(records?'-records':'-spaces'),{records,structure:!records}),
  fieldMetadata:{occurredOn:{label:text('date'),format:(v,{esc})=>esc(recordDateLabel(v))},location:{label:text('project')},notebook:{label:text('book')},recordType:{label:text('recordType')},profiles:{label:text('types')}},
  scoped:true,settings:(c,options={},panel)=>[...dashboardScopeSettings(c,options,panel),...dashboardBookSettings(c,options,panel),{key:'search',label:text('search'),type:'text'}],
  items:(c,result,options={})=>{
   if(!records&&result?.items)return result.items.map(item=>item.data?.profilesMore?{...item,data:{...item.data,profiles:[...item.data.profiles,t('configurationEditor','moreProfileTypes')]}}:item);
   const list=c.outline?[]:notebooks(c,options),ids=new Set(list.map(n=>n.id));
   if(!records)return list.filter(n=>!options.search||n.title.toLowerCase().includes(options.search.toLowerCase())).map(n=>({key:n.id,title:n.title,data:{...n,location:locationName(c.book,n.projectId),profiles:configurationOf(n).profiles.filter(p=>p.enabled).map(p=>p.id)},action:{name:'filter-notebook',id:n.id}}));
   return (c.outline?result?.records??[]:c.book.entries).filter(e=>c.outline||ids.has(e.notebookId)&&labDataRecord(e,profile)&&recordQueryMatcher({search:options.search??''})(e)).map(e=>{
    const n=c.book.notebooks.find(n=>n.id===e.notebookId);
    return {key:dashboardRecordIdentity(e),owner:e.owner,title:e.title,data:{...dashboardRecordData(e),location:e.owner?.projectTitle??locationName(c.book,n.projectId),notebook:e.owner?.notebookTitle??n.title,recordType:e.template?.label??e.type},action:dashboardRecordAction(e)};
   });
  }
 });
}
